# weldic 동기화 서버

폰과 PC의 할일·내 일정을 맞추는 Cloudflare Worker (파일 1개: `worker.js`).

## 올리는 순서 (Cloudflare 대시보드)
1. Workers & Pages → KV → "Create a namespace" → 이름 `weldic-sync-kv`
2. Workers & Pages → Create → Worker → 이름 `weldic-sync` → Deploy → "Edit code"에서 `worker.js` 내용 전체를 붙여넣고 Deploy
3. 그 Worker의 Settings → Bindings → Add → KV namespace → 변수 이름 `SYNC_KV`, 네임스페이스 `weldic-sync-kv`
4. Worker 주소(`https://weldic-sync.○○○.workers.dev`)를 `app/js/sync-config.js`의 `SYNC_URL`에 넣고 push

## 동작 요약
- `POST /sync` 하나뿐. 헤더 `X-Sync-Code`(연결 코드)가 열쇠. KV에는 코드의 해시만 키로 저장.
- 허용 주소는 `https://yahogee.github.io` (환경변수 `ALLOWED_ORIGIN`으로 변경 가능).
- 항목마다 수정 시각 `t`가 큰 쪽이 이김. 삭제는 `v: null` 기록으로 남기고 90일 뒤 정리.
- 본문 200KB, 종류별 2000개 상한. 바뀐 경우에만 KV에 씀.
