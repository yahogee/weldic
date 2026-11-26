/* Storage and ordering of the to-do list ("할일").
   To-dos have no date: they stay on the list until the user finishes (deletes) them.
   They live in this browser's localStorage; the sync module (sync.js) copies them to the
   sync server only when the user has connected devices. */
import { notifyDataChanged } from "./change-bus.js";

const STORAGE_KEY = "weldic.todos.v1";

// 우선순위 3단계: rank가 클수록 목록 위쪽에 나옴
export const PRIORITIES = [
  { id: "high", label: "높음", rank: 3 },
  { id: "normal", label: "보통", rank: 2 },
  { id: "low", label: "낮음", rank: 1 },
];
export const DEFAULT_PRIORITY = "normal";
export const TITLE_MAX_CHARS = 100;      // 할일 한 줄의 최대 글자 수

/** The priority object for an id (falls back to the default priority). */
export function priorityOf(id) {
  return PRIORITIES.find((priority) => priority.id === id) || PRIORITIES.find((priority) => priority.id === DEFAULT_PRIORITY);
}

/** True when a stored value looks like a valid to-do. */
function isValidTodo(todo) {
  return Boolean(todo) && typeof todo.id === "string" && typeof todo.title === "string"
    && todo.title.trim() !== "" && typeof todo.created === "number";
}

/** Read all to-dos; any storage problem (private mode, blocked data) results in an empty list. */
export function loadTodos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTodo).map((todo) => ({ ...todo, priority: priorityOf(todo.priority).id }));
  } catch (error) {
    return [];
  }
}

/** Write all to-dos; returns false when the browser refuses to store them.
    silent = true is used by the sync module itself so that it does not trigger another sync. */
export function saveTodos(todos, silent = false) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    if (!silent) notifyDataChanged();
    return true;
  } catch (error) {
    return false;
  }
}

/** Short unique id for a new to-do. */
export function newTodoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** A new to-do object (title is trimmed and shortened to the maximum length). */
export function createTodo(title, priorityId) {
  return {
    id: newTodoId(),
    title: title.trim().slice(0, TITLE_MAX_CHARS),
    priority: priorityOf(priorityId).id,
    created: Date.now(),
  };
}

/** Copy of the list sorted by priority (high first); same priority keeps the oldest on top. */
export function sortTodos(todos) {
  return [...todos].sort((a, b) => priorityOf(b.priority).rank - priorityOf(a.priority).rank || a.created - b.created);
}
