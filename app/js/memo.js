/* Phone-only memo pad. Memos live in this browser's localStorage and are never sent anywhere.
   A security warning is always visible and repeated every time a memo is saved. */
import { el } from "./render.js";

const STORAGE_KEY = "weldic.memos.v1";
const TITLE_MAX_CHARS = 30;      // 목록에 보여줄 제목(첫 줄)의 최대 글자 수
const TOAST_MS = 4000;           // 저장 알림이 떠 있는 시간
const MEMO_ROWS = 8;             // 메모 입력창 높이(줄 수)
const WARNING_TEXT = "이 메모는 이 폰(이 브라우저)에만 저장돼요. 백업되지 않고, 앱 데이터를 지우면 사라져요. "
  + "비밀번호, 주민번호, 대상자 이름·상담 내용 등 보안이 필요한 내용은 적지 마세요.";
const SAVE_NOTICE = "저장했어요 · 보안이 필요한 내용은 적지 마세요";

/** Read all memos; any storage problem (private mode, blocked data) results in an empty list. */
export function loadMemos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((memo) => memo && typeof memo.text === "string") : [];
  } catch (error) {
    return [];
  }
}

/** Write all memos; returns false when the browser refuses to store them. */
export function saveMemos(memos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
    return true;
  } catch (error) {
    return false;
  }
}

/** Short unique id for a new memo. */
function newMemoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** First line of a memo, shortened for the list. */
function memoTitle(memo) {
  const firstLine = memo.text.trim().split("\n")[0];
  return firstLine.length > TITLE_MAX_CHARS ? `${firstLine.slice(0, TITLE_MAX_CHARS)}…` : firstLine;
}

/** "11/2 21:05" label of the last edit. */
function memoStamp(memo) {
  const date = new Date(memo.updated);
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${minutes}`;
}

let toastTimer = null;

/** Show a short message at the bottom of the screen. */
function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = el("div", "toast");
    toast.id = "toast";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), TOAST_MS);
}

/** Build the memo screen. `list` helpers come from the shared open-in-place list. */
export function memoView({ makeItem, closeOpen }) {
  const root = el("div", "memo-view");
  // 경고문은 항상 맨 위에 고정해서 보여줌
  root.append(el("p", "warn-box", `⚠ ${WARNING_TEXT}`));
  const addButton = el("button", "btn add-memo", "+ 새 메모");
  addButton.type = "button";
  const listHolder = el("div");
  root.append(addButton, listHolder);

  let memos = loadMemos();

  /** Detail/editor of one memo (also used for a brand new memo). */
  function editor(memo, isNew) {
    const box = el("div", "detail-body");
    box.append(el("p", "note", "⚠ 보안이 필요한 내용(비밀번호, 주민번호, 대상자 정보)은 적지 마세요."));
    const area = el("textarea", "memo-input");
    area.rows = MEMO_ROWS;
    area.value = memo.text;
    area.setAttribute("aria-label", "메모 내용");
    const message = el("p", "note");
    const saveButton = el("button", "btn", "저장");
    saveButton.type = "button";
    const deleteButton = el("button", "btn danger", "삭제");
    deleteButton.type = "button";
    let deleteArmed = false;

    saveButton.addEventListener("click", () => {
      const text = area.value.trim();
      if (!text) {
        message.textContent = "내용을 입력한 뒤 저장하세요";
        return;
      }
      const saved = { id: memo.id, text, updated: Date.now() };
      const next = isNew ? [saved, ...memos] : memos.map((item) => (item.id === memo.id ? saved : item));
      if (!saveMemos(next)) {
        message.textContent = "이 브라우저에서는 저장할 수 없어요 (시크릿 모드이거나 저장이 막혀 있어요)";
        return;
      }
      memos = next;
      render();
      showToast(SAVE_NOTICE);
    });

    // 삭제는 두 번 눌러야 실행 (실수 방지, 팝업창 없이)
    deleteButton.addEventListener("click", () => {
      if (isNew) {
        render();
        return;
      }
      if (!deleteArmed) {
        deleteArmed = true;
        deleteButton.textContent = "한 번 더 누르면 삭제돼요";
        return;
      }
      memos = memos.filter((item) => item.id !== memo.id);
      saveMemos(memos);
      render();
    });

    const buttons = el("div", "button-row");
    buttons.append(saveButton, deleteButton);
    box.append(area, message, buttons);
    return box;
  }

  /** Draw the list of memos. */
  function render() {
    closeOpen();
    listHolder.replaceChildren();
    if (memos.length === 0) {
      listHolder.append(el("p", "empty", "메모가 없어요"));
      return;
    }
    const list = el("ul", "list");
    memos.forEach((memo) => {
      const row = el("span", "row-main");
      row.append(el("span", "row-title", memoTitle(memo)));
      row.append(el("span", "chip", memoStamp(memo)));
      list.append(makeItem(row, () => editor(memo, false)));
    });
    listHolder.append(list);
  }

  // 새 메모: 빈 항목을 맨 위에 만들어 바로 열어 줌 (저장해야 실제로 기록됨)
  addButton.addEventListener("click", () => {
    render();
    const draft = { id: newMemoId(), text: "", updated: Date.now() };
    let list = listHolder.querySelector("ul");
    if (!list) {
      listHolder.replaceChildren();
      list = el("ul", "list");
      listHolder.append(list);
    }
    const row = el("span", "row-main");
    row.append(el("span", "row-title", "새 메모"));
    const item = makeItem(row, () => editor(draft, true));
    list.prepend(item);
    item.querySelector("button.row").click();
  });

  render();
  return root;
}
