/* The "할일" section shown under today's schedule.
   Finished to-dos are deleted (with a short "undo" line); unfinished ones simply stay on the list,
   so they appear again every day. All text goes through textContent (no HTML injection). */
import { el } from "./render.js";
import {
  PRIORITIES, DEFAULT_PRIORITY, TITLE_MAX_CHARS, priorityOf,
  loadTodos, saveTodos, createTodo, sortTodos,
} from "./todo-store.js";

const UNDO_VISIBLE_MS = 6000;            // "되돌리기" 줄이 떠 있는 시간
const STORAGE_NOTICE = "할일은 이 폰(이 브라우저)에만 저장돼요. 백업되지 않고, 앱 데이터를 지우면 사라져요. "
  + "비밀번호, 주민번호, 대상자 이름·상담 내용 등 보안이 필요한 내용은 적지 마세요.";
const SAVE_FAILED_TEXT = "이 브라우저에서는 저장할 수 없어요 (시크릿 모드이거나 저장이 막혀 있어요)";
const EMPTY_TITLE_TEXT = "할일을 입력하세요";

/** A row of three buttons to choose a priority; `get()` returns the chosen priority id. */
function prioritySelector(initialId) {
  const node = el("div", "prio-group");
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", "우선순위");
  let chosen = priorityOf(initialId).id;
  const buttons = PRIORITIES.map((priority) => {
    const button = el("button", `prio prio-${priority.id}`, priority.label);
    button.type = "button";
    button.addEventListener("click", () => {
      chosen = priority.id;
      refresh();
    });
    return { priority, button };
  });
  /** Mark the chosen button. */
  function refresh() {
    buttons.forEach(({ priority, button }) => button.setAttribute("aria-pressed", String(priority.id === chosen)));
  }
  buttons.forEach(({ button }) => node.append(button));
  refresh();
  return { node, get: () => chosen };
}

/** Build the whole to-do section (add form, list, undo line). */
export function todoSection() {
  const root = el("div", "todo-box");
  root.append(el("h3", "day-sub", "할일"));
  root.append(el("p", "note", STORAGE_NOTICE));

  let todos = sortTodos(loadTodos());
  let editingId = null;                  // 지금 수정창이 열려 있는 할일의 id
  let undoTimer = null;
  const message = el("p", "note todo-message");
  const listHolder = el("div");
  const undoHolder = el("div");

  /** Save a new list; shows an error line and returns false when the browser refuses. */
  function persist(next) {
    if (!saveTodos(next)) {
      message.textContent = SAVE_FAILED_TEXT;
      return false;
    }
    message.textContent = "";
    todos = sortTodos(next);
    return true;
  }

  /** Show "finished" line with an undo button for a few seconds. */
  function showUndo(removed) {
    clearTimeout(undoTimer);
    undoHolder.replaceChildren();
    const line = el("p", "note todo-undo");
    line.append(`'${removed.title}' 완료했어요 `);
    const undo = el("button", "link-btn", "되돌리기");
    undo.type = "button";
    undo.addEventListener("click", () => {
      if (persist([...todos, removed])) renderList();
      undoHolder.replaceChildren();
    });
    line.append(undo);
    undoHolder.append(line);
    undoTimer = setTimeout(() => undoHolder.replaceChildren(), UNDO_VISIBLE_MS);
  }

  /** Inline editor of one to-do (title and priority). */
  function editor(todo) {
    const box = el("div", "todo-editor");
    const input = el("input", "todo-input");
    input.type = "text";
    input.maxLength = TITLE_MAX_CHARS;
    input.value = todo.title;
    input.setAttribute("aria-label", "할일 내용");
    const selector = prioritySelector(todo.priority);
    const save = el("button", "btn", "저장");
    save.type = "button";
    const cancel = el("button", "btn", "취소");
    cancel.type = "button";
    save.addEventListener("click", () => {
      const title = input.value.trim().slice(0, TITLE_MAX_CHARS);
      if (!title) {
        message.textContent = EMPTY_TITLE_TEXT;
        return;
      }
      const next = todos.map((item) => (item.id === todo.id ? { ...item, title, priority: selector.get() } : item));
      if (persist(next)) {
        editingId = null;
        renderList();
      }
    });
    cancel.addEventListener("click", () => {
      editingId = null;
      renderList();
    });
    const buttons = el("div", "button-row");
    buttons.append(save, cancel);
    box.append(input, selector.node, buttons);
    return box;
  }

  /** One row: finish button, priority chip and title (tap the title to edit). */
  function todoItem(todo) {
    const item = el("li", "item todo-item");
    const row = el("div", "todo-row");
    const done = el("button", "todo-done", "완료");
    done.type = "button";
    done.setAttribute("aria-label", `${todo.title} 완료 (목록에서 삭제)`);
    done.addEventListener("click", () => {
      if (persist(todos.filter((entry) => entry.id !== todo.id))) {
        editingId = null;
        renderList();
        showUndo(todo);
      }
    });
    const titleButton = el("button", "todo-title");
    titleButton.type = "button";
    titleButton.append(el("span", `chip prio-chip prio-${todo.priority}`, priorityOf(todo.priority).label));
    titleButton.append(el("span", "row-title", todo.title));
    titleButton.addEventListener("click", () => {
      editingId = editingId === todo.id ? null : todo.id;
      renderList();
    });
    row.append(done, titleButton);
    item.append(row);
    if (editingId === todo.id) item.append(editor(todo));
    return item;
  }

  /** Draw the list (or the empty line). */
  function renderList() {
    listHolder.replaceChildren();
    if (todos.length === 0) {
      listHolder.append(el("p", "empty", "할일이 없어요"));
      return;
    }
    const list = el("ul", "list todo-list");
    todos.forEach((todo) => list.append(todoItem(todo)));
    listHolder.append(list);
  }

  // 새 할일 입력: 내용 + 우선순위(기본 보통) + 추가 (Enter 키로도 추가)
  const form = el("form", "todo-add");
  const input = el("input", "todo-input");
  input.type = "text";
  input.maxLength = TITLE_MAX_CHARS;
  input.placeholder = "할일을 입력하세요";
  input.setAttribute("aria-label", "새 할일");
  const selector = prioritySelector(DEFAULT_PRIORITY);
  const addButton = el("button", "btn", "추가");
  addButton.type = "submit";
  form.append(input, selector.node, addButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input.value.trim()) {
      message.textContent = EMPTY_TITLE_TEXT;
      return;
    }
    if (persist([...todos, createTodo(input.value, selector.get())])) {
      input.value = "";
      renderList();
    }
  });

  root.append(form, message, listHolder, undoHolder);
  renderList();
  return root;
}
