/* App entry: wires the search box, result list, detail view and document panel. */
import { loadStore, loadAllPages } from "./data.js";
import { searchCards, searchPages, tokenize } from "./search.js";
import { el, cardRow, pageRow, cardDetail, pageDetail, docsPanel, buildHighlightRegex } from "./render.js";

const WIDE_QUERY = "(min-width: 900px)";
const PAGE_BATCH = 20;          // page hits shown per "more" click
const SEARCH_DELAY_MS = 120;    // debounce for typing

const store = await loadStore();
const wide = window.matchMedia(WIDE_QUERY);
const input = document.getElementById("q");
const clearButton = document.getElementById("clearBtn");
const statusLine = document.getElementById("status");
const results = document.getElementById("results");
const detailPane = document.getElementById("detailPane");
const docsButton = document.getElementById("docsBtn");
const docsView = document.getElementById("docsView");
const mainView = document.getElementById("mainView");
const footerInfo = document.getElementById("footerInfo");

let current = { tokens: [], regex: null, cardMatches: [], pageResult: { hits: [], total: 0 }, shownPages: PAGE_BATCH };
let openItem = null;   // { element, render } for the currently opened result

/** Close whichever result is currently open. */
function closeOpen() {
  if (!openItem) return;
  openItem.element.classList.remove("open");
  const inline = openItem.element.querySelector(".detail");
  if (inline) inline.replaceChildren();
  detailPane.replaceChildren();
  detailPane.classList.remove("filled");
  openItem = null;
}

/** Show the detail of one result: beside the list on PC, in place on phones. */
function openResult(element, renderDetail) {
  const wasOpen = openItem && openItem.element === element;
  closeOpen();
  if (wasOpen) return;
  element.classList.add("open");
  openItem = { element, render: renderDetail };
  if (wide.matches) {
    detailPane.replaceChildren(renderDetail());
    detailPane.classList.add("filled");
  } else {
    element.querySelector(".detail").replaceChildren(renderDetail());
    element.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

/** Build one list item with a button row and an in-place detail area. */
function makeItem(rowNode, renderDetail) {
  const item = el("li", "item");
  const button = el("button", "row");
  button.type = "button";
  button.append(rowNode);
  button.addEventListener("click", () => openResult(item, renderDetail));
  item.append(button, el("div", "detail"));
  return item;
}

/** Render the list of page hits (with a "more" button). */
function renderPageHits(list, moreHolder) {
  const { hits } = current.pageResult;
  list.replaceChildren();
  hits.slice(0, current.shownPages).forEach((hit) => {
    list.append(makeItem(pageRow(hit, current.tokens, current.regex), () => pageDetail(hit, current.regex)));
  });
  moreHolder.replaceChildren();
  if (current.shownPages < hits.length) {
    const more = el("button", "btn more", "더 보기");
    more.type = "button";
    more.addEventListener("click", () => {
      current.shownPages += PAGE_BATCH;
      renderPageHits(list, moreHolder);
    });
    moreHolder.append(more);
  }
}

/** Home view (no query): list every card, or the empty state. */
function renderHome() {
  results.replaceChildren();
  if (store.cards.length === 0 && store.manifest.docs.length === 0) {
    results.append(el("p", "empty", "자료가 없어요"));
    statusLine.textContent = "";
    return;
  }
  statusLine.textContent = store.manifest.docs.length > 0
    ? `문서 ${store.manifest.docs.length}개 · 용어 카드 ${store.cards.length}개 — 단어를 입력하면 모두 함께 찾아요`
    : "";
  if (store.cards.length === 0) return;
  results.append(el("h2", "section-title", "용어 카드"));
  const list = el("ul", "list");
  [...store.cards].sort((a, b) => a.term.localeCompare(b.term, "ko")).forEach((card) => {
    list.append(makeItem(cardRow(card), () => cardDetail(card, store.manifest.docs, null, store.cards)));
  });
  results.append(list);
}

/** Run a search for the current input value and draw the results. */
function runSearch() {
  closeOpen();
  const query = input.value;
  clearButton.hidden = query.length === 0;
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    renderHome();
    return;
  }
  current = {
    tokens, regex: buildHighlightRegex(tokens),
    cardMatches: searchCards(store.cards, query),
    pageResult: searchPages(store, query), shownPages: PAGE_BATCH,
  };
  results.replaceChildren();
  const loading = store.loadedDocs < store.manifest.docs.length;
  statusLine.textContent = `용어 카드 ${current.cardMatches.length}건 · 문서 ${current.pageResult.total}쪽${loading ? " (자료 불러오는 중…)" : ""}`;
  if (current.cardMatches.length === 0 && current.pageResult.total === 0) {
    results.append(el("p", "empty", loading ? "자료를 불러오는 중이에요. 잠시 후 다시 확인하세요" : "찾는 내용이 없어요. 다른 단어로 검색해 보세요"));
    return;
  }
  if (current.cardMatches.length > 0) {
    results.append(el("h2", "section-title", "용어 카드"));
    const cardList = el("ul", "list");
    current.cardMatches.forEach((card) => {
      cardList.append(makeItem(cardRow(card), () => cardDetail(card, store.manifest.docs, current.regex, store.cards)));
    });
    results.append(cardList);
  }
  if (current.pageResult.total > 0) {
    results.append(el("h2", "section-title", "문서 속 검색 결과"));
    const pageList = el("ul", "list");
    const moreHolder = el("div", "more-holder");
    results.append(pageList, moreHolder);
    renderPageHits(pageList, moreHolder);
  }
}

/** Toggle between the search view and the document list view. */
function toggleDocs() {
  const showDocs = docsView.hidden;
  docsView.hidden = !showDocs;
  mainView.hidden = showDocs;
  docsButton.textContent = showDocs ? "← 검색으로" : "자료 목록";
  if (showDocs) docsView.replaceChildren(docsPanel(store.manifest));
}

let searchTimer = null;
input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, SEARCH_DELAY_MS);
});
clearButton.addEventListener("click", () => {
  input.value = "";
  runSearch();
  input.focus();
});
docsButton.addEventListener("click", toggleDocs);
// Re-render the open detail in the right place when the window width class changes.
wide.addEventListener("change", () => {
  if (!openItem) return;
  const { element, render } = openItem;
  closeOpen();
  openResult(element, render);
});

footerInfo.textContent = store.manifest.builtAt ? `자료 갱신 ${store.manifest.builtAt}` : "";
renderHome();
loadAllPages(store, () => {
  if (input.value.trim()) runSearch();   // refresh results as more documents arrive
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("service worker failed", error));
}
