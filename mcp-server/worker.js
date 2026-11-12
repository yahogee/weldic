// ============================================================
// data.go.kr MCP server (Cloudflare Workers, single file, no dependencies)
// 공공데이터포털 API를 Claude가 직접 호출할 수 있게 해 주는 "중간 창구" 프로그램이다.
// 인증키와 접근 토큰은 코드에 쓰지 않고, Cloudflare의 비밀값(Secret)으로만 보관한다.
// ============================================================

// ---- 설정값 (상수) ----
const SERVER_NAME = "datagokr-mcp";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26"; // 클라이언트가 버전을 안 알려줄 때 쓰는 기본값
const ALLOWED_HOST = "apis.data.go.kr"; // 이 주소 외의 곳으로는 절대 호출하지 않는다(안전장치)
const MAX_RESPONSE_CHARS = 150000; // Claude에게 돌려줄 응답의 최대 글자 수(너무 길면 자른다)
const UPSTREAM_TIMEOUT_MS = 25000; // 공공데이터 서버를 기다려 주는 최대 시간
const SECRET_PATH_PREFIX = "/mcp/"; // 접속 주소 형태: https://.../mcp/<비밀토큰>

// 지자체/중앙부처 복지서비스 API의 기본 주소와 경로
const LOCAL_WELFARE_BASE = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations";
const CENTRAL_WELFARE_BASE = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001";

// ---- 도구(Tool) 목록: Claude에게 "이런 일을 시킬 수 있어요"라고 알려 주는 명세 ----
const TOOLS = [
  {
    name: "data_go_kr_call",
    description:
      "공공데이터포털(apis.data.go.kr) 오픈API를 호출한다. url은 https://apis.data.go.kr/ 로 시작하는 '기본주소+경로'이고, params에 요청변수(serviceKey 제외)를 넣는다. 인증키는 서버가 자동으로 붙인다. 응답 원문(XML/JSON)을 돌려준다.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "예: https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001" },
        params: { type: "object", description: "요청변수. 예: {\"callTp\":\"L\",\"pageNo\":\"1\",\"numOfRows\":\"10\"}" },
      },
      required: ["url"],
    },
  },
  {
    name: "welfare_local_list",
    description: "지자체복지서비스 목록조회. 시도(ctpvNm)·시군구(sggNm)·검색어(searchWrd) 등으로 조회한다. 일일 한도 1000건.",
    inputSchema: {
      type: "object",
      properties: {
        ctpvNm: { type: "string", description: "시도명. 예: 경상북도" },
        sggNm: { type: "string", description: "시군구명. 예: 경산시" },
        searchWrd: { type: "string", description: "검색어" },
        srchKeyCode: { type: "string", description: "001 제목, 002 내용, 003 제목+내용" },
        pageNo: { type: "string", description: "페이지 번호(기본 1)" },
        numOfRows: { type: "string", description: "한 페이지 건수(기본 10)" },
      },
    },
  },
  {
    name: "welfare_local_detail",
    description: "지자체복지서비스 상세조회. servId(예: WLF00001138)를 넣는다.",
    inputSchema: {
      type: "object",
      properties: { servId: { type: "string", description: "서비스ID" } },
      required: ["servId"],
    },
  },
  {
    name: "welfare_central_list",
    description:
      "중앙부처복지서비스 목록조회. 생애주기(lifeArray)·가구유형(trgterIndvdlArray)·관심주제(intrsThemaArray)·나이(age)·검색어(searchWrd)로 조회한다. 일일 한도 100건이므로 numOfRows를 크게(최대 500) 쓰는 것이 좋다.",
    inputSchema: {
      type: "object",
      properties: {
        searchWrd: { type: "string", description: "검색어" },
        srchKeyCode: { type: "string", description: "001 제목, 002 내용, 003 제목+내용" },
        lifeArray: { type: "string", description: "생애주기 코드" },
        trgterIndvdlArray: { type: "string", description: "가구유형 코드" },
        intrsThemaArray: { type: "string", description: "관심주제 코드" },
        age: { type: "string", description: "나이" },
        onapPsbltYn: { type: "string", description: "온라인신청 가능여부 Y/N" },
        orderBy: { type: "string", description: "date 조회순 / popular 인기순" },
        pageNo: { type: "string", description: "페이지 번호(기본 1)" },
        numOfRows: { type: "string", description: "한 페이지 건수(기본 10, 최대 500)" },
      },
    },
  },
  {
    name: "welfare_central_detail",
    description: "중앙부처복지서비스 상세조회. servId(예: WLF00001138)를 넣는다. 일일 한도 100건.",
    inputSchema: {
      type: "object",
      properties: { servId: { type: "string", description: "서비스ID" } },
      required: ["servId"],
    },
  },
];

// ---- 도구별 "어떤 주소로 어떤 변수를 보낼지" 변환표 ----
// 반환값: { url, params } (인증키는 나중에 callUpstream에서 붙인다)
const TOOL_BUILDERS = {
  data_go_kr_call: (args) => ({ url: args.url, params: args.params || {} }),
  welfare_local_list: (args) => ({ url: LOCAL_WELFARE_BASE + "/LcgvWelfarelist", params: args }),
  welfare_local_detail: (args) => ({ url: LOCAL_WELFARE_BASE + "/LcgvWelfaredetailed", params: { servId: args.servId } }),
  welfare_central_list: (args) => ({ url: CENTRAL_WELFARE_BASE + "/NationalWelfarelistV001", params: { callTp: "L", ...args } }),
  welfare_central_detail: (args) => ({ url: CENTRAL_WELFARE_BASE + "/NationalWelfaredetailedV001", params: { callTp: "D", servId: args.servId } }),
};

// ---- 공공데이터 서버에 실제로 전화(HTTP 요청)를 거는 함수 ----
async function callUpstream(env, url, params) {
  const target = new URL(url);
  // 안전장치: 허용된 주소(apis.data.go.kr, https)가 아니면 거부한다
  if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST) {
    throw new Error("허용되지 않는 주소입니다. https://" + ALLOWED_HOST + "/ 로 시작해야 합니다.");
  }
  // 요청변수를 주소 뒤에 붙인다(값이 비어 있으면 건너뜀). 인증키는 서버 비밀값에서 꺼내 붙인다.
  for (const [key, value] of Object.entries(params || {})) {
    if (key === "serviceKey") continue; // 사용자가 키를 넣어도 무시(서버 키만 사용)
    if (value !== undefined && value !== null && String(value) !== "") target.searchParams.set(key, String(value));
  }
  target.searchParams.set("serviceKey", decodeKey(env.DATA_GO_KR_KEY));

  const response = await fetch(target.toString(), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  let text = await response.text();
  const prefix = "HTTP " + response.status + "\n";
  if (text.length > MAX_RESPONSE_CHARS) {
    text = text.slice(0, MAX_RESPONSE_CHARS) + "\n...[응답이 길어 " + MAX_RESPONSE_CHARS + "자에서 잘랐습니다. pageNo/numOfRows로 나눠 조회하세요]";
  }
  return prefix + text;
}

// 인증키가 '%'로 인코딩된 형태(Encoding 키)로 들어와도 한 번만 풀어서, 이중 인코딩을 막는다
function decodeKey(rawKey) {
  const key = (rawKey || "").trim();
  if (!key) throw new Error("서버에 DATA_GO_KR_KEY 비밀값이 설정되어 있지 않습니다.");
  try { return decodeURIComponent(key); } catch { return key; }
}

// ---- MCP 규격(JSON-RPC) 메시지 하나를 처리하는 함수 ----
async function handleRpc(env, message) {
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: (params && params.protocolVersion) || DEFAULT_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params && params.name;
    const builder = TOOL_BUILDERS[name];
    if (!builder) return rpcError(id, -32602, "알 수 없는 도구: " + name);
    try {
      const { url, params: query } = builder((params && params.arguments) || {});
      const text = await callUpstream(env, url, query);
      return rpcResult(id, { content: [{ type: "text", text }] });
    } catch (error) {
      // 도구 실행 실패는 Claude가 읽을 수 있게 결과 안에 오류 문장으로 돌려준다
      return rpcResult(id, { content: [{ type: "text", text: "오류: " + error.message }], isError: true });
    }
  }
  if (isNotification) return null; // 알림(notifications/...)은 답장이 필요 없다
  return rpcError(id, -32601, "지원하지 않는 메서드: " + method);
}

function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

// ---- 서버의 입구: 요청이 들어오면 가장 먼저 실행되는 부분 ----
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1) 접근 보호: 주소가 /mcp/<비밀토큰> 이 아니면 존재하지 않는 것처럼 404
    const expectedPath = SECRET_PATH_PREFIX + (env.MCP_PATH_TOKEN || "");
    if (!env.MCP_PATH_TOKEN || url.pathname !== expectedPath) {
      return new Response("Not found", { status: 404 });
    }
    // 2) 이 서버는 POST(JSON-RPC)만 받는다
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }

    // 3) 본문을 읽어 처리(여러 메시지가 배열로 와도 처리)
    let body;
    try { body = await request.json(); } catch { return jsonResponse(rpcError(null, -32700, "JSON 형식 오류"), 400); }
    const messages = Array.isArray(body) ? body : [body];
    const replies = [];
    for (const message of messages) {
      const reply = await handleRpc(env, message);
      if (reply) replies.push(reply);
    }
    if (replies.length === 0) return new Response(null, { status: 202 }); // 알림만 온 경우
    return jsonResponse(Array.isArray(body) ? replies : replies[0], 200);
  },
};

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}
