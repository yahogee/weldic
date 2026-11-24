/* Row and inline editor of one personal schedule entry ("내 일정").
   All text goes through textContent / input values (no HTML injection). */
import { el } from "./render.js";
import { parseISODate, formatDate } from "./schedule.js";
import { EVENT_COLORS, TITLE_MAX_CHARS, NOTE_MAX_CHARS, normalizeColor, isValidDateText, buildEvent } from "./event-store.js";

const NOTE_ROWS = 3;                    // 메모 입력창 높이(줄 수)
const STORAGE_NOTICE = "내 일정은 이 폰(이 브라우저)에만 저장돼요. 백업되지 않고, 앱 데이터를 지우면 사라져요. "
  + "비밀번호, 주민번호, 대상자 이름·상담 내용 등 보안이 필요한 내용은 적지 마세요.";
const SAVE_FAILED_TEXT = "이 브라우저에서는 저장할 수 없어요 (시크릿 모드이거나 저장이 막혀 있어요)";
const EMPTY_TITLE_TEXT = "일정 이름을 입력하세요";
const EMPTY_DATE_TEXT = "날짜를 선택하세요";

/** Row of a personal entry: color swatch, time and title. */
export function personalEventRow(event) {
  const row = el("span", "row-main");
  row.append(el("span", `ev-swatch ev-${event.color}`));
  if (event.time) row.append(el("span", "chip", event.time));
  row.append(el("span", "row-title", event.title));
  return row;
}

/** Four buttons (3 background colors + none); `get()` returns the chosen color id. */
function colorSelector(initialColor) {
  const node = el("div", "color-group");
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", "배경색");
  let chosen = normalizeColor(initialColor);
  const buttons = EVENT_COLORS.map((color) => {
    const button = el("button", `color-btn ev-${color.id}`, color.id === "none" ? "없음" : "");
    button.type = "button";
    button.setAttribute("aria-label", color.label);
    button.addEventListener("click", () => {
      chosen = color.id;
      refresh();
    });
    return { color, button };
  });
  /** Mark the chosen button. */
  function refresh() {
    buttons.forEach(({ color, button }) => button.setAttribute("aria-pressed", String(color.id === chosen)));
  }
  buttons.forEach(({ button }) => node.append(button));
  refresh();
  return { node, get: () => chosen };
}

/** A labelled form field. */
function field(labelText, control) {
  const wrap = el("label", "field");
  wrap.append(el("span", "field-label", labelText), control);
  return wrap;
}

/** Inline editor for a new or existing entry.
    handlers.onSave(entry) -> true when saved, handlers.onDelete(id) -> true when deleted. */
export function personalEventEditor(event, isNew, handlers) {
  const box = el("div", "detail-body event-editor");
  box.append(el("p", "note", `⚠ ${STORAGE_NOTICE}`));
  const title = el("input", "todo-input");
  title.type = "text";
  title.maxLength = TITLE_MAX_CHARS;
  title.value = event.title;
  const date = el("input", "todo-input");
  date.type = "date";
  date.value = event.rule.date;
  const time = el("input", "todo-input");
  time.type = "time";
  time.value = event.time;
  const note = el("textarea", "memo-note");
  note.rows = NOTE_ROWS;
  note.maxLength = NOTE_MAX_CHARS;
  note.value = event.note;
  const colors = colorSelector(event.color);
  const message = el("p", "note");
  const save = el("button", "btn", "저장");
  save.type = "button";
  const remove = el("button", "btn danger", isNew ? "취소" : "삭제");
  remove.type = "button";
  let deleteArmed = false;

  save.addEventListener("click", () => {
    if (!title.value.trim()) {
      message.textContent = EMPTY_TITLE_TEXT;
      return;
    }
    if (!isValidDateText(date.value)) {
      message.textContent = EMPTY_DATE_TEXT;
      return;
    }
    const entry = buildEvent({ id: event.id, title: title.value, date: date.value, time: time.value, note: note.value, color: colors.get() });
    if (!handlers.onSave(entry)) message.textContent = SAVE_FAILED_TEXT;
  });

  // 삭제는 두 번 눌러야 실행 (실수 방지, 팝업창 없이). 새 일정의 "취소"는 바로 닫힘
  remove.addEventListener("click", () => {
    if (isNew) {
      handlers.onCancel();
      return;
    }
    if (!deleteArmed) {
      deleteArmed = true;
      remove.textContent = "한 번 더 누르면 삭제돼요";
      return;
    }
    if (!handlers.onDelete(event.id)) message.textContent = SAVE_FAILED_TEXT;
  });

  const buttons = el("div", "button-row");
  buttons.append(save, remove);
  box.append(
    field("일정 이름", title), field("날짜", date), field("시간 (선택)", time),
    field("메모 (선택)", note), field("배경색", colors.node), message, buttons,
  );
  return box;
}

/** "11월 27일(금)" label for a stored date text. */
export function eventDateLabel(event) {
  return formatDate(parseISODate(event.rule.date));
}
