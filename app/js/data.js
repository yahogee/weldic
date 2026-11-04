/* Data loading. The UI knows nothing about specific documents:
   everything is discovered through data/manifest.json. */
import { normalizeText } from "./util.js";

const MANIFEST_URL = "data/manifest.json";
const CARDS_URL = "data/cards.json";
const WORK_URL = "data/work.json";

/** Fetch a JSON file and fail loudly on HTTP errors. */
async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

/** Load manifest, cards and work data; a missing file results in an empty store. */
export async function loadStore() {
  const store = {
    manifest: { docs: [], builtAt: "", buildId: "" }, cards: [],
    work: { tasks: [], events: [], calls: { frame: null, types: [], cases: [] } },   // 업무 카드·일정·전화 응대 (work/ 폴더에서 빌드됨)
    pages: new Map(), loadedDocs: 0,
  };
  try {
    store.manifest = await fetchJson(MANIFEST_URL);
  } catch (error) {
    console.warn("manifest not available", error);
  }
  try {
    store.cards = await fetchJson(CARDS_URL);
  } catch (error) {
    console.warn("cards not available", error);
  }
  try {
    store.work = await fetchJson(WORK_URL);
    // 전화 응대 데이터가 없는 예전 work.json도 깨지지 않게 기본값을 채움
    store.work.calls = store.work.calls || { frame: null, types: [], cases: [] };
  } catch (error) {
    console.warn("work data not available", error);
  }
  return store;
}

/** Load page text of every document in the background (calls onProgress per document). */
export async function loadAllPages(store, onProgress) {
  const jobs = store.manifest.docs.map(async (doc) => {
    try {
      const payload = await fetchJson(`data/docs/${doc.id}.json`);
      store.pages.set(doc.id, payload.pages.map((p) => ({ label: p.l, text: p.t, lower: normalizeText(p.t) })));
    } catch (error) {
      console.warn("document not available", doc.id, error);
      store.pages.set(doc.id, []);
    }
    store.loadedDocs += 1;
    onProgress(store.loadedDocs, store.manifest.docs.length);
  });
  await Promise.all(jobs);
}
