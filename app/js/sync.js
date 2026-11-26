/* Device sync: copies to-dos and entries to the sync server (Cloudflare Worker) and merges what comes back.
   - Devices share one secret "connection code"; there is no login.
   - Every item carries t (last edit time). Deleted items stay as a tombstone { t, v: null } so a delete
     on one device also reaches the others. The newer t wins (last write wins).
   - The local lists stay the source for the screen: they are always saved locally first (works offline),
     and the server copy is refreshed afterwards. */
import { SYNC_URL } from "./sync-config.js";
import { loadTodos, saveTodos } from "./todo-store.js";
import { loadEvents, saveEvents } from "./event-store.js";
import { onDataChanged } from "./change-bus.js";

const CONFIG_KEY = "weldic.sync.v1";                 // 연결 코드와 "마지막으로 서버와 맞춘 상태"를 저장하는 곳
const CODE_LENGTH = 32;                              // 만들어 주는 연결 코드 길이
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // 헷갈리는 글자(0 O 1 l I) 제외
const CODE_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;       // 서버와 같은 코드 모양 규칙
const PUSH_DELAY_MS = 1500;                          // 저장 후 이만큼 기다렸다가 한 번에 올림
const TOMBSTONE_KEEP_MS = 90 * 24 * 60 * 60 * 1000;  // 삭제 기록 보관 기간 (서버와 같음)
const KINDS = [                                      // 동기화 대상: 이름, 읽기, 쓰기
  { name: "todos", load: loadTodos, save: saveTodos },
  { name: "events", load: loadEvents, save: saveEvents },
];

// ---- 화면에 알려 줄 상태 ----
export const STATES = { off: "off", syncing: "syncing", ok: "ok", offline: "offline", error: "error" };
let status = { state: STATES.off, at: null };
const statusListeners = [];
const pulledListeners = [];
let changeCount = 0;           // 사용자가 저장할 때마다 올라가는 번호 (통신 중 수정 감지용)
let pushTimer = null;
let running = false;
let again = false;

/** Subscribe to status changes (for the panel). */
export function onSyncStatus(listener) { statusListeners.push(listener); }
/** Subscribe to "data arrived from another device and changed the local lists". */
export function onSyncPulled(listener) { pulledListeners.push(listener); }
/** Current status object { state, at }. */
export function getSyncStatus() { return status; }

function setStatus(state, at = status.at) {
  status = { state, at };
  statusListeners.forEach((listener) => listener(status));
}

// ---- 설정(연결 코드와 기준 상태) 저장 ----
function readConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
    if (parsed && typeof parsed.code === "string" && CODE_PATTERN.test(parsed.code)) {
      return { code: parsed.code, base: parsed.base || { todos: {}, events: {} } };
    }
  } catch (error) { /* 저장소 문제는 "연결 안 됨"으로 취급 */ }
  return null;
}
function writeConfig(config) {
  try {
    if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    else localStorage.removeItem(CONFIG_KEY);
    return true;
  } catch (error) { return false; }
}

/** True when a server address is configured in sync-config.js. */
export function isSyncAvailable() { return SYNC_URL !== ""; }
/** True when this device has a connection code. */
export function isConnected() { return readConfig() !== null; }
/** The current connection code, or "" when not connected. */
export function getCode() { const config = readConfig(); return config ? config.code : ""; }
/** True when the text looks like a valid connection code. */
export function isValidCode(text) { return CODE_PATTERN.test(text); }

/** A new random connection code (cryptographically random). */
export function createCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("");
}

/** Text of the storage notice, chosen by whether devices are connected. */
export function storageNotice(subject) {
  if (isConnected()) return `${subject}은 연결된 기기끼리 공유돼요. 연결 코드를 아는 사람은 볼 수 있어요.`;
  return `${subject}은 이 폰(이 브라우저)에만 저장돼요. 백업되지 않고, 앱 데이터를 지우면 사라져요. 여러 기기에서 쓰려면 아래 "기기 연결"을 이용하세요.`;
}

// ---- 합치기 ----
/** Build the document to send for one kind: unchanged items keep their old t, changed or new items get `now`,
    items that disappeared become tombstones. Returns { doc, } where doc is { id: { t, v } }. */
function buildDoc(items, base, now) {
  const doc = {};
  items.forEach((item) => {
    const previous = base[item.id];
    const unchanged = previous && previous.s === JSON.stringify(item);
    doc[item.id] = { t: unchanged ? previous.t : now, v: item };
  });
  Object.keys(base).forEach((id) => {
    if (doc[id]) return;                                   // 아직 있는 항목
    const previous = base[id];
    if (previous.s === null) {                             // 이미 삭제 기록인 항목: 기간이 지나면 정리
      if (now - previous.t <= TOMBSTONE_KEEP_MS) doc[id] = { t: previous.t, v: null };
    } else {
      doc[id] = { t: now, v: null };                       // 방금 지워진 항목: 삭제 기록으로 바꿈
    }
  });
  return doc;
}

/** Apply a merged document to local storage; returns the new base and whether the visible list changed. */
function applyMerged(kind, merged) {
  const before = JSON.stringify(kind.load());
  const liveItems = Object.keys(merged).filter((id) => merged[id].v !== null).map((id) => merged[id].v);
  kind.save(liveItems, true);                              // silent: 다시 동기화를 부르지 않음
  const stored = kind.load();                              // 저장소가 걸러 낸 최종 모양
  const base = {};
  stored.forEach((item) => { base[item.id] = { t: merged[item.id].t, s: JSON.stringify(item) }; });
  Object.keys(merged).forEach((id) => {
    if (merged[id].v === null) base[id] = { t: merged[id].t, s: null };
  });
  return { base, changed: before !== JSON.stringify(stored) };
}

/** Send local data, merge with the server's, and store the result. Safe to call at any time. */
export async function syncNow() {
  const config = readConfig();
  if (!config || !isSyncAvailable()) return;
  if (running) { again = true; return; }
  running = true;
  setStatus(STATES.syncing);
  const startedAt = changeCount;
  try {
    const now = Date.now();
    const body = {};
    KINDS.forEach((kind) => { body[kind.name] = buildDoc(kind.load(), config.base[kind.name] || {}, now); });
    const response = await fetch(`${SYNC_URL}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sync-Code": config.code },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`server ${response.status}`);
    const merged = await response.json();
    if (changeCount !== startedAt) {
      again = true;                                        // 통신 중에 새로 저장했으면 이번 결과는 버리고 다시 함
    } else {
      const nextBase = {};
      let changed = false;
      KINDS.forEach((kind) => {
        const result = applyMerged(kind, merged[kind.name] || {});
        nextBase[kind.name] = result.base;
        changed = changed || result.changed;
      });
      writeConfig({ code: config.code, base: nextBase });
      setStatus(STATES.ok, new Date());
      if (changed) pulledListeners.forEach((listener) => listener());
    }
  } catch (error) {
    setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? STATES.offline : STATES.error);
  } finally {
    running = false;
    if (again) { again = false; schedulePush(); }
  }
}

/** Sync shortly after the last save (several quick saves become one upload). */
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DELAY_MS);
}

/** Connect this device with a code (new or typed) and run the first sync, which uploads local data too.
    Returns false when the code is invalid or the browser cannot store it. */
export function connectWithCode(code) {
  if (!isSyncAvailable() || !isValidCode(code)) return false;
  if (!writeConfig({ code, base: { todos: {}, events: {} } })) return false;
  syncNow();
  return true;
}

/** Disconnect: forget the code (local data stays on this device, the server copy is kept). */
export function disconnect() {
  clearTimeout(pushTimer);
  writeConfig(null);
  setStatus(STATES.off);
}

/** Start listening: sync after local saves, when the app is opened, and when it becomes visible/online again. */
export function startSync() {
  onDataChanged(() => {
    changeCount += 1;
    if (isConnected()) schedulePush();
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  window.addEventListener("online", syncNow);
  if (isConnected()) syncNow(); else setStatus(STATES.off);
}

/** If the page address is a connect link (#sync=CODE), connect with it and clean the address. */
export function connectFromLink() {
  const match = /[#&]sync=([A-Za-z0-9_-]+)/.exec(location.hash || "");
  if (!match) return false;
  history.replaceState(null, "", location.pathname + location.search);   // 코드가 주소창에 남지 않게 지움
  if (isConnected()) return false;
  return connectWithCode(match[1]);
}
