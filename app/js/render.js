/* DOM rendering helpers. All text goes through textContent (no HTML injection). */
import { buildHighlightRegex, encodePath } from "./util.js";

const EXCERPT_RADIUS = 70;   // characters shown around the first match

/** Create an element with optional class and text. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Append text to a node, wrapping regex matches in <mark>. */
export function appendHighlighted(parent, text, regex) {
  if (!regex) {
    parent.append(text);
    return;
  }
  let last = 0;
  regex.lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (match[0].length === 0) continue;
    parent.append(text.slice(last, match.index));
    parent.append(el("mark", "", match[0]));
    last = match.index + match[0].length;
  }
  parent.append(text.slice(last));
}

/** Cut a short excerpt around the first matching token. */
export function makeExcerpt(page, tokens) {
  let first = -1;
  for (const token of tokens) {
    const index = page.lower.indexOf(token);
    if (index !== -1 && (first === -1 || index < first)) first = index;
  }
  const start = Math.max(0, first - EXCERPT_RADIUS);
  const end = Math.min(page.text.length, start + EXCERPT_RADIUS * 2);
  return (start > 0 ? "…" : "") + page.text.slice(start, end) + (end < page.text.length ? "…" : "");
}

/** Link to the original file (PDF opens at the page). Returns null for text sources. */
function originalLink(doc, label) {
  if (doc.kind !== "pdf") return null;
  const pageNumber = parseInt(label, 10);
  const link = el("a", "btn", "원본 PDF에서 보기");
  link.href = encodePath(doc.file) + (pageNumber ? `#page=${pageNumber}` : "");
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

/** Row shown in the result list for a term card. */
export function cardRow(card) {
  const row = el("span", "row-main");
  row.append(el("span", "row-title", card.term));
  row.append(el("span", "chip", card.system));
  row.append(el("span", `badge status-${card.status === "검수 전" ? "pending" : "ok"}`, card.status));
  return row;
}

/** Row shown in the result list for a document page hit. */
export function pageRow(hit, tokens, regex) {
  const row = el("span", "row-main");
  const title = el("span", "row-title");
  title.append(`${hit.doc.title} · ${hit.page.label}`);
  row.append(title);
  const excerpt = el("span", "row-excerpt");
  appendHighlighted(excerpt, makeExcerpt(hit.page, tokens), regex);
  row.append(excerpt);
  return row;
}

/** Detail view of a term card. */
export function cardDetail(card, docs, regex, allCards = []) {
  const box = el("div", "detail-body");
  box.append(el("h2", "", card.term));
  const meta = el("div", "meta");
  meta.append(el("span", "chip", card.system));
  meta.append(el("span", `badge status-${card.status === "검수 전" ? "pending" : "ok"}`, card.status));
  meta.append(el("span", "meta-date", `기준일 ${card.basis_date}`));
  box.append(meta);

  box.append(el("h3", "", "원문"));
  const quote = el("blockquote");
  appendHighlighted(quote, card.quote, regex);
  box.append(quote);
  box.append(el("p", "source", `출처: ${card.source_title} · ${card.source.label || ""}`));
  const doc = docs.find((d) => d.id === card.source_doc_id);
  const link = doc ? originalLink(doc, card.source.label) : null;
  if (link) box.append(link);

  box.append(el("h3", "", "쉬운 풀이 (AI 작성)"));
  const gloss = el("p", "gloss");
  appendHighlighted(gloss, card.gloss, regex);
  box.append(gloss);
  box.append(el("p", "note", "풀이는 이해를 돕는 참고용이에요. 금액·비율·기준은 반드시 원문을 확인하세요."));

  // Related cards: clicking one swaps this detail for that card in place
  const related = (card.related || []).map((id) => allCards.find((c) => c.id === id)).filter(Boolean);
  if (related.length > 0) {
    box.append(el("h3", "", "같이 알아야 할 용어"));
    const chips = el("div", "related");
    related.forEach((target) => {
      const button = el("button", "related-chip", target.term);
      button.type = "button";
      button.addEventListener("click", () => {
        const next = cardDetail(target, docs, null, allCards);
        box.replaceWith(next);
        next.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      chips.append(button);
    });
    box.append(chips);
  }
  return box;
}

/** Detail view of a document page. */
export function pageDetail(hit, regex) {
  const box = el("div", "detail-body");
  box.append(el("h2", "", `${hit.doc.title}`));
  const meta = el("div", "meta");
  meta.append(el("span", "chip", hit.page.label));
  if (hit.doc.kind === "pdf") meta.append(el("span", "meta-date", "PDF 쪽 번호 (책자 인쇄 쪽수와 다를 수 있어요)"));
  box.append(meta);
  const text = el("p", "page-text");
  appendHighlighted(text, hit.page.text, regex);
  box.append(text);
  const link = originalLink(hit.doc, hit.page.label);
  if (link) box.append(link);
  return box;
}

/** Panel listing every document and the last update date. */
export function docsPanel(manifest) {
  const box = el("div", "docs-panel");
  box.append(el("h2", "", "자료 목록"));
  box.append(el("p", "note", manifest.builtAt ? `마지막 갱신: ${manifest.builtAt}` : "갱신 정보 없음"));
  if (manifest.docs.length === 0) {
    box.append(el("p", "empty", "자료가 없어요"));
    return box;
  }
  const list = el("ul", "docs-list");
  for (const doc of manifest.docs) {
    const item = el("li");
    item.append(el("strong", "", doc.title));
    item.append(el("span", "doc-meta", `${doc.kind === "pdf" ? "PDF" : "법령/문서"} · ${doc.pageCount}${doc.kind === "pdf" ? "쪽" : "개 단위"}`));
    list.append(item);
  }
  box.append(list);
  return box;
}

export { buildHighlightRegex };
