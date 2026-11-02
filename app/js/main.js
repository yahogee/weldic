/* App entry: wires the search box, tabs, result lists, detail view and document panel. */
import { loadStore, loadAllPages } from "./data.js";
import { searchCards, searchPages, tokenize } from "./search.js";
import { el, cardRow, pageRow, cardDetail, pageDetail, docsPanel, buildHighlightRegex } from "./render.js";
import { createOpenList } from "./openlist.js";
import { toSearchShapes } from "./work-data.js";
import { taskRow, taskDetail, todayView, calendarView, tasksView } from "./work-render.js";
import { memoView } from "./memo.js";

const WIDE_QUERY = "(min-width: 900px)";
const PAGE_BATCH = 20;          // page hits shown per "more" click
const SEARCH_DELAY_MS = 120;    // debounce for typing
// 검색창 아래에 보이는 탭 목록: 앱을 처음 열면 맨 앞의 "오늘"이 보임
const TABS = [
  { id: "today", label: "오늘" },
  { id: "calendar", label: "달력" },
  { id: "tasks", label: "업무" },
  { id: "terms", label: "용어" },
  { id: "memo", label: "메모" },
];
const DEFAULT_TAB = TABS[0].id;

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
const tabBar = document.getElementById("tabs");

// 목록 항목을 "그 자리에서 열고 다른 건 닫는" 공통 기능 (모든 탭이 같이 씀)
const { makeItem, closeOpen } = createOpenList(detailPane, wide);
// 업무 카드를 기존 검색 엔진이 이해하는 모양으로 한 번만 변환해 둠
const taskShapes = toSearchShapes(store.work.tasks);

let activeTab = DEFAULT_TAB;
let current = { tokens: [], regex: null, taskMatches: [], cardMatches: [], pageResult: { hits: [], total: 0 }, shownPages: PAGE_BATCH };

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

/** "용어" tab: list every card, or the empty state. */
function renderTerms() {
  if (store.cards.length === 0 && store.manifest.docs.length === 0) {
    results.append(el("p", "empty", "자료가 없어요"));
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

/** Draw the screen of one tab (called when no search text is typed). */
function renderTab(tabId) {
  closeOpen();
  activeTab = tabId;
  results.replaceChildren();
  statusLine.textContent = "";
  tabBar.classList.remove("searching");
  tabBar.querySelectorAll(".tab").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === tabId)));
  const today = new Date();
  if (tabId === "today") results.append(todayView(store, today, makeItem));
  else if (tabId === "calendar") results.append(calendarView(store, today, makeItem, closeOpen));
  else if (tabId === "tasks") results.append(tasksView(store, makeItem));
  else if (tabId === "terms") renderTerms();
  else if (tabId === "memo") results.append(memoView({ makeItem, closeOpen }));
}

/** Run a search for the current input value and draw the results. */
function runSearch() {
  closeOpen();
  const query = input.value;
  clearButton.hidden = query.length === 0;
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    renderTab(activeTab);
    return;
  }
  current = {
    tokens, regex: buildHighlightRegex(tokens),
    taskMatches: searchCards(taskShapes, query).map((shape) => shape.ref),
    cardMatches: searchCards(store.cards, query),
    pageResult: searchPages(store, query), shownPages: PAGE_BATCH,
  };
  results.replaceChildren();
  tabBar.classList.add("searching");
  const loading = store.loadedDocs < store.manifest.docs.length;
  const total = current.taskMatches.length + current.cardMatches.length + current.pageResult.total;
  statusLine.textContent = `업무 카드 ${current.taskMatches.length}건 · 용어 카드 ${current.cardMatches.length}건 · 문서 ${current.pageResult.total}쪽${loading ? " (자료 불러오는 중…)" : ""}`;
  if (total === 0) {
    results.append(el("p", "empty", loading ? "자료를 불러오는 중이에요. 잠시 후 다시 확인하세요" : "찾는 내용이 없어요. 다른 단어로 검색해 보세요"));
    return;
  }
  if (current.taskMatches.length > 0) {
    results.append(el("h2", "section-title", "업무 카드"));
    const taskList = el("ul", "list");
    current.taskMatches.forEach((task) => {
      taskList.append(makeItem(taskRow(task), () => taskDetail(task, store, current.regex)));
    });
    results.append(taskList);
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

/** Build the tab buttons. Tapping a tab clears the search and shows that tab. */
function buildTabs() {
  TABS.forEach((tab) => {
    const button = el("button", "tab", tab.label);
    button.type = "button";
    button.dataset.tab = tab.id;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => {
      input.value = "";
      clearButton.hidden = true;
      renderTab(tab.id);
    });
    tabBar.append(button);
  });
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

footerInfo.textContent = store.manifest.builtAt ? `자료 갱신 ${store.manifest.builtAt}` : "";
buildTabs();
renderTab(DEFAULT_TAB);
loadAllPages(store, () => {
  if (input.value.trim()) runSearch();   // refresh results as more documents arrive
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("service worker failed", error));
}
