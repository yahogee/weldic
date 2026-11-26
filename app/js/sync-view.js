/* The "기기 연결" panel shown at the bottom of the 오늘 tab: connect, see the status, show the code, disconnect. */
import { el } from "./render.js";
import {
  STATES, onSyncStatus, getSyncStatus, isSyncAvailable, isConnected, getCode, isValidCode,
  createCode, connectWithCode, disconnect, syncNow,
} from "./sync.js";

const UNAVAILABLE_TEXT = "기기 연결 서버가 아직 준비되지 않았어요.";
const OFF_TEXT = "지금은 이 폰(이 브라우저)에만 저장돼요. 폰과 PC를 연결하면 같은 할일·일정을 볼 수 있어요.";
const CODE_HELP = "이 코드를 아는 사람은 할일과 일정을 볼 수 있고 고칠 수도 있어요. 연결할 기기에서 이 링크를 열거나 코드를 입력하세요.";
const BAD_CODE_TEXT = "코드가 올바르지 않아요. 24~64자의 영문·숫자여야 해요.";
const DISCONNECT_CONFIRM_MS = 4000;     // "연결 끊기"를 한 번 더 눌러야 하는 시간

/** "14:02" style time text. */
function clockText(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Status sentence for the connected state. */
function statusText(status) {
  if (status.state === STATES.syncing) return "동기화 중…";
  if (status.state === STATES.offline) return "인터넷이 안 돼서 이 기기에만 저장했어요. 연결되면 다시 올려요.";
  if (status.state === STATES.error) return "서버와 연결하지 못했어요. 이 기기에는 저장돼 있고, 잠시 후 다시 시도해요.";
  return status.at ? `동기화됨 ${clockText(status.at)}` : "연결됨";
}

/** Small button helper. */
function button(text, onClick, extraClass = "") {
  const node = el("button", `btn ${extraClass}`.trim(), text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

/** Link that connects another device: the app address plus #sync=CODE. */
function connectLink(code) {
  return `${location.origin}${location.pathname}#sync=${code}`;
}

/** Build the panel. It redraws itself whenever the sync status changes. */
export function syncPanel() {
  const root = el("div", "sync-box");
  let showCode = false;
  let entering = false;
  let confirming = false;
  let message = "";

  function draw() {
    root.replaceChildren();
    root.append(el("h3", "day-sub", "기기 연결"));
    if (!isSyncAvailable()) {
      root.append(el("p", "note", UNAVAILABLE_TEXT));
      return;
    }
    if (!isConnected()) drawDisconnected(); else drawConnected();
    if (message) root.append(el("p", "note", message));
  }

  function drawDisconnected() {
    root.append(el("p", "note", OFF_TEXT));
    const row = el("div", "button-row");
    row.append(button("코드 만들기", () => {
      connectWithCode(createCode());
      showCode = true; message = ""; draw();
    }));
    row.append(button("코드 입력", () => { entering = !entering; message = ""; draw(); }));
    root.append(row);
    if (!entering) return;
    const input = el("input", "todo-input");
    input.type = "text";
    input.placeholder = "연결 코드";
    input.autocomplete = "off";
    const go = button("연결", () => {
      const code = input.value.trim();
      if (!isValidCode(code)) { message = BAD_CODE_TEXT; draw(); return; }
      connectWithCode(code);
      entering = false; message = ""; draw();
    });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") go.click(); });
    root.append(input, go);
  }

  function drawConnected() {
    root.append(el("p", "note sync-status", statusText(getSyncStatus())));
    const row = el("div", "button-row");
    row.append(button("지금 동기화", () => syncNow()));
    row.append(button(showCode ? "코드 숨기기" : "코드 보기", () => { showCode = !showCode; draw(); }));
    row.append(button(confirming ? "정말 끊기" : "연결 끊기", onDisconnect, "danger"));
    root.append(row);
    if (showCode) {
      const code = getCode();
      root.append(el("p", "note", CODE_HELP));
      root.append(el("p", "sync-code", code));
      root.append(el("p", "note sync-link", connectLink(code)));
      if (navigator.clipboard) {
        root.append(button("링크 복사", async () => {
          try { await navigator.clipboard.writeText(connectLink(code)); message = "링크를 복사했어요."; } catch (error) { message = "복사하지 못했어요. 위 링크를 길게 눌러 복사하세요."; }
          draw();
        }));
      }
    }
  }

  function onDisconnect() {
    if (!confirming) {
      confirming = true; draw();
      setTimeout(() => { confirming = false; if (root.isConnected) draw(); }, DISCONNECT_CONFIRM_MS);
      return;
    }
    confirming = false; showCode = false;
    disconnect();
    message = "연결을 끊었어요. 이 기기의 할일·일정은 그대로 남아 있어요.";
    draw();
  }

  onSyncStatus(() => { if (root.isConnected) draw(); });
  draw();
  return root;
}
