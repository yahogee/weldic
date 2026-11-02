/* Shared "open in place" behaviour for every list in the app:
   a tap opens the detail right there (phones) or in the side pane (PC),
   and any other open item closes automatically. */
import { el } from "./render.js";

/** Create the open/close helpers bound to the side pane and the width media query. */
export function createOpenList(detailPane, wide) {
  // 지금 열려 있는 항목 { element, render } (없으면 null)
  let openItem = null;

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

  // 창 너비가 바뀌면(폰 <-> PC) 열려 있던 항목을 알맞은 자리에 다시 그림
  wide.addEventListener("change", () => {
    if (!openItem) return;
    const { element, render } = openItem;
    closeOpen();
    openResult(element, render);
  });

  return { makeItem, closeOpen };
}
