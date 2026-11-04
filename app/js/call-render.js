/* Phone-call screens: the common answering frame, call types, real cases.
   All text goes through textContent (no HTML injection). */
import { el } from "./render.js";
import { findTask, findCallType } from "./work-data.js";
import { textElement, showLinked, linkedChips, taskDetail } from "./work-render.js";

const GAP_CHIP_TEXT = "자료 일부 없음";

/** Row shown in lists and search results for a call type or a real case. */
export function callRow(ref) {
  const row = el("span", "row-main");
  const { kind, item } = ref;
  row.append(el("span", "row-title", item.title));
  row.append(el("span", "chip", kind === "case" ? "전화 사례" : item.category));
  if (kind === "type" && item.gap) row.append(el("span", "badge status-pending", GAP_CHIP_TEXT));
  return row;
}

/** Add a titled bullet list to a detail box (skipped when the list is empty). */
function addList(box, title, items, regex, className = "plain-list", tag = "ul") {
  if (!items || items.length === 0) return;
  box.append(el("h3", "", title));
  const list = el(tag, className);
  items.forEach((text) => list.append(textElement("li", "", text, regex)));
  box.append(list);
}

/** Buttons that jump to the task cards, term cards, laws and cases linked from a call type. */
function typeLinks(type, store, box) {
  const chips = el("div", "related");
  for (const id of type.tasks || []) {
    const task = findTask(store.work.tasks, id);
    if (!task) continue;
    const button = el("button", "related-chip", `업무 카드 · ${task.title}`);
    button.type = "button";
    button.addEventListener("click", () => showLinked(box, taskDetail(task, store)));
    chips.append(button);
  }
  for (const entry of store.work.calls.cases.filter((c) => c.call_type === type.id)) {
    const button = el("button", "related-chip", `사례 · ${entry.title}`);
    button.type = "button";
    button.addEventListener("click", () => showLinked(box, caseDetail(entry, store)));
    chips.append(button);
  }
  const termsAndLaws = linkedChips({ terms: type.terms, laws: [] }, store, box);
  return [chips, ...termsAndLaws].filter((node) => node.children.length > 0 || node.textContent !== "");
}

/** Detail view of a call type. */
export function callDetail(type, store, regex = null) {
  const box = el("div", "detail-body");
  box.append(el("h2", "", type.title));
  const meta = el("div", "meta");
  meta.append(el("span", "chip", type.category));
  meta.append(el("span", "meta-date", `기준일 ${type.basis_date}`));
  box.append(meta);

  addList(box, "이렇게 말씀하실 수 있어요 (예시)", type.heard.map((text) => `“${text}”`), regex);
  box.append(el("h3", "", "사실은 이런 요청이에요"));
  box.append(textElement("p", "gloss", type.real_need, regex));
  addList(box, "이렇게 되물어 보세요", type.ask, regex, "steps", "ol");
  addList(box, "확인할 것 (업무 매뉴얼 기준)", type.check, regex);
  if (type.gap) box.append(el("p", "warn-box", `⚠ 자료에 없는 부분: ${type.gap}`));
  addList(box, "이렇게 말씀드리세요", type.say, regex);
  addList(box, "팀장님·담당자에게 넘길 때 적을 것", type.handoff, regex);
  addList(box, "주의", type.cautions, regex);
  const links = typeLinks(type, store, box);
  if (links.length > 0) box.append(el("h3", "", "같이 볼 업무·용어·사례"), ...links);
  box.append(el("p", "source", `출처: ${type.source}`));
  box.append(el("p", "note", "'예시' 말투는 실제로 들을 수 있는 표현을 가정해 만든 것이에요. 전화로 대상 여부나 금액을 단정하지 말고, 모르면 확인 후 회신하세요."));
  return box;
}

/** Detail view of a real (anonymised) case from the notebook. */
export function caseDetail(entry, store, regex = null) {
  const box = el("div", "detail-body");
  box.append(el("h2", "", entry.title));
  const meta = el("div", "meta");
  meta.append(el("span", "chip", "전화 사례"));
  meta.append(el("span", "meta-date", `기준일 ${entry.basis_date}`));
  box.append(meta);
  box.append(el("h3", "", "민원인이 한 말"));
  box.append(textElement("p", "gloss", entry.heard, regex));
  box.append(el("h3", "", "사실은 이런 요청이었어요"));
  box.append(textElement("p", "gloss", entry.real_need, regex));
  if (entry.what_happened) {
    box.append(el("h3", "", "그날 있었던 일"));
    box.append(textElement("p", "gloss", entry.what_happened, regex));
  }
  box.append(el("h3", "", "다음에 같은 전화가 오면"));
  box.append(textElement("p", "gloss", entry.lesson, regex));
  const type = entry.call_type ? findCallType(store.work.calls.types, entry.call_type) : null;
  if (type) {
    const open = el("button", "btn", "관련 응대 카드 보기 →");
    open.type = "button";
    open.addEventListener("click", () => showLinked(box, callDetail(type, store)));
    box.append(open);
  }
  box.append(el("p", "source", `출처: ${entry.source || "전화 노트"}`));
  return box;
}

/** The common answering frame: always-visible quick list plus the full card. */
function frameBlock(frame, makeItem) {
  const root = el("div");
  const quick = el("div", "prep-box");
  quick.append(el("h3", "", "전화 받으면 먼저 받아 적기"));
  const list = el("ul", "plain-list");
  (frame.quick || []).forEach((text) => list.append(el("li", "", text)));
  quick.append(list, el("p", "note", "바로 답을 못 줘도 괜찮아요. \"확인해서 오늘 안에 다시 전화드리겠습니다\"라고 하면 돼요."));
  const full = el("ul", "list");
  full.append(makeItem(callRow({ kind: "type", item: { title: frame.title, category: "공통" } }), () => frameDetail(frame)));
  root.append(quick, full);
  return root;
}

/** Detail of the common frame card. */
function frameDetail(frame) {
  const box = el("div", "detail-body");
  box.append(el("h2", "", frame.title));
  frame.sections.forEach((section) => {
    box.append(el("h3", "", section.title));
    const list = el("ul", "plain-list");
    section.items.forEach((text) => list.append(el("li", "", text)));
    box.append(list);
  });
  box.append(el("p", "source", `출처: ${frame.source || "업무 매뉴얼"}`));
  return box;
}

/** The "전화" tab. `onPractice` starts the practice mode (provided by main.js). */
export function callsView(store, makeItem, onPractice) {
  const root = el("div", "calls-view");
  const { frame, types, cases } = store.work.calls;
  if (!frame && types.length === 0) {
    root.append(el("p", "empty", "전화 응대 자료가 없어요"));
    return root;
  }
  if (frame) root.append(frameBlock(frame, makeItem));
  const practice = el("button", "btn practice-start", "연습하기 (10문제)");
  practice.type = "button";
  practice.addEventListener("click", onPractice);
  root.append(practice);

  const typeList = el("ul", "list");
  [...types].sort((a, b) => a.title.localeCompare(b.title, "ko")).forEach((type) => {
    const ref = { kind: "type", item: type };
    typeList.append(makeItem(callRow(ref), () => callDetail(type, store)));
  });
  root.append(el("h2", "section-title", `민원 유형 ${types.length}개 (민원인이 한 말로 검색할 수도 있어요)`), typeList);

  if (cases.length > 0) {
    const caseList = el("ul", "list");
    cases.forEach((entry) => caseList.append(makeItem(callRow({ kind: "case", item: entry }), () => caseDetail(entry, store))));
    root.append(el("h2", "section-title", "전화 사례 노트"), caseList);
  }
  return root;
}
