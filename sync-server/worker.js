/* weldic 동기화 서버 (Cloudflare Worker + KV).
   - 로그인 대신 "연결 코드"를 열쇠로 씀. 코드를 모르면 읽기/쓰기가 모두 거부됨.
   - KV에는 코드의 SHA-256 해시만 키로 저장하므로, 저장소를 봐도 코드 자체는 알 수 없음.
   - POST /sync 하나만 있음: 기기가 가진 항목을 보내면 서버가 합쳐서 결과를 돌려줌. */

const ALLOWED_ORIGIN_DEFAULT = "https://yahogee.github.io";  // 웰딕 호스팅 주소 (환경변수 ALLOWED_ORIGIN으로 바꿀 수 있음)
const CODE_PATTERN = /^[A-Za-z0-9_-]{24,64}$/;                // 연결 코드 모양 (너무 짧은 코드는 거부)
const MAX_BODY_CHARS = 200000;                               // 요청 본문 최대 글자 수
const MAX_ITEMS_PER_KIND = 2000;                             // 할일/일정 각각 최대 항목 수
const TOMBSTONE_KEEP_MS = 90 * 24 * 60 * 60 * 1000;          // 삭제 기록을 남겨 두는 기간 (90일)
const COLLECTIONS = ["todos", "events"];                     // 동기화 대상 묶음

/** CORS 헤더: 웰딕 주소에서 온 요청만 브라우저가 허용하도록 함. */
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || ALLOWED_ORIGIN_DEFAULT,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Code",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

/** JSON 응답 만들기 (CORS 헤더 포함). */
function jsonResponse(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** 연결 코드를 SHA-256 해시(16진수 문자열)로 바꿈. */
async function hashCode(code) {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 항목 묶음({id: {t, v}})이 올바른 모양인지 검사: t는 수, v는 객체 또는 null(삭제 기록). */
function isValidCollection(collection) {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) return false;
  const ids = Object.keys(collection);
  if (ids.length > MAX_ITEMS_PER_KIND) return false;
  return ids.every((id) => {
    const entry = collection[id];
    return id.length > 0 && id.length <= 64 && entry && typeof entry.t === "number"
      && (entry.v === null || (typeof entry.v === "object" && !Array.isArray(entry.v)));
  });
}

/** 두 묶음을 합침: 항목마다 t(수정 시각)가 큰 쪽이 이김. 오래된 삭제 기록은 정리함. */
export function mergeCollections(serverSide, clientSide, now) {
  const merged = { ...serverSide };
  Object.keys(clientSide).forEach((id) => {
    if (!merged[id] || clientSide[id].t > merged[id].t) merged[id] = clientSide[id];
  });
  Object.keys(merged).forEach((id) => {
    if (merged[id].v === null && now - merged[id].t > TOMBSTONE_KEEP_MS) delete merged[id];
  });
  return merged;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/sync") return jsonResponse(env, 404, { error: "not_found" });

    // 1) 열쇠(연결 코드) 확인
    const code = request.headers.get("X-Sync-Code") || "";
    if (!CODE_PATTERN.test(code)) return jsonResponse(env, 401, { error: "bad_code" });

    // 2) 본문 크기/모양 확인
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return jsonResponse(env, 413, { error: "too_large" });
    let body;
    try { body = JSON.parse(text); } catch (error) { return jsonResponse(env, 400, { error: "bad_json" }); }
    const incoming = {};
    for (const name of COLLECTIONS) {
      incoming[name] = body && body[name] !== undefined ? body[name] : {};
      if (!isValidCollection(incoming[name])) return jsonResponse(env, 400, { error: "bad_shape" });
    }

    // 3) 서버에 저장된 것과 합치기
    const key = `d:${await hashCode(code)}`;
    const savedText = await env.SYNC_KV.get(key);
    let saved = {};
    try { saved = savedText ? JSON.parse(savedText) : {}; } catch (error) { saved = {}; }
    const now = Date.now();
    const merged = {};
    for (const name of COLLECTIONS) merged[name] = mergeCollections(isValidCollection(saved[name]) ? saved[name] : {}, incoming[name], now);

    // 4) 바뀐 경우에만 저장 (무료 쓰기 한도를 아끼기 위함)
    const mergedText = JSON.stringify(merged);
    if (mergedText !== savedText) await env.SYNC_KV.put(key, mergedText);
    return jsonResponse(env, 200, { ...merged, serverTime: now });
  },
};
