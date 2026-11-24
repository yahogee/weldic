/* Row and inline editor of one personal schedule entry ("내 일정").
   All text goes through textContent / input values (no HTML injection). */
import { el } from "./render.js";
import { REPEAT_OPTIONS, SCOPE_ONE, SCOPE_FUTURE, isSeries, repeatOf, repeatLabel } from "./event-repeat.js";
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
  if (isSeries(event)) row.append(el("span", "chip", `↻ ${repeatLabel(event)}`));
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

/** Inline editor for a new or existing entry shown on the day `occurrenceISO`.
    handlers.onSave(entry, scope) -> true when saved, handlers.onDelete(scope) -> true when deleted.
    For a repeating entry the user is asked "이 날만 / 앞으로 전부" before saving or deleting. */
export function personalEventEditor(event, isNew, handlers, occurrenceISO) {
  const box = el("div", "detail-body event-editor");
  box.append(el("p", "note", `⚠ ${STORAGE_NOTICE}`));
  const title = el("input", "todo-input");
  title.type = "text";
  title.maxLength = TITLE_MAX_CHARS;
  title.value = event.title;
  const date = el("input", "todo-input");
  date.type = "date";
  date.value = occurrenceISO;
  const time = el("input", "todo-input");
  time.type = "time";
  time.value = event.time;
  const note = el("textarea", "memo-note");
  note.rows = NOTE_ROWS;
  note.maxLength = NOTE_MAX_CHARS;
  note.value = event.note;
  const repeat = el("select", "todo-input");
  REPEAT_OPTIONS.forEach((option) => {
    const choice = el("option", "", option.label);
    choice.value = option.id;
    repeat.append(choice);
  });
  repeat.value = repeatOf(event);
  const colors = colorSelector(event.color);
  const message = el("p", "note");
  const save = el("button", "btn", "저장");
  save.type = "button";
  const remove = el("button", "btn danger", isNew ? "취소" : "삭제");
  remove.type = "button";
  let deleteArmed = false;

  const buttons = el("div", "button-row");
  const series = isSeries(event) && !isNew;

  /** Replace the buttons by "이 날만 / 앞으로 전부 / 취소" so the user picks how far the change goes. */
  function askScope(actionText, run) {
    message.textContent = `반복 일정이에요. ${actionText} 범위를 고르세요`;
    const one = el("button", "btn", "이 날만");
    one.type = "button";
    const future = el("button", "btn", "앞으로 전부");
    future.type = "button";
    const back = el("button", "btn", "돌아가기");
    back.type = "button";
    one.addEventListener("click", () => run(SCOPE_ONE));
    future.addEventListener("click", () => run(SCOPE_FUTURE));
    back.addEventListener("click", () => {
      message.textContent = "";
      buttons.replaceChildren(save, remove);
    });
    buttons.replaceChildren(one, future, back);
  }

  save.addEventListener("click", () => {
    if (!title.value.trim()) {
      message.textContent = EMPTY_TITLE_TEXT;
      return;
    }
    if (!isValidDateText(date.value)) {
      message.textContent = EMPTY_DATE_TEXT;
      return;
    }
    const entry = buildEvent({
      id: event.id, title: title.value, date: date.value, time: time.value, note: note.value,
      color: colors.get(), repeat: repeat.value,
    });
    const run = (scope) => {
      if (!handlers.onSave(entry, scope)) message.textContent = SAVE_FAILED_TEXT;
    };
    if (series) askScope("바꿀", run);
    else run(undefined);
  });

  // 삭제: 한 번만 하는 일정은 두 번 눌러야 실행 (실수 방지, 팝업창 없이). 반복 일정은 범위를 고르게 함. 새 일정의 "취소"는 바로 닫힘
  remove.addEventListener("click", () => {
    if (isNew) {
      handlers.onCancel();
      return;
    }
    const run = (scope) => {
      if (!handlers.onDelete(scope)) message.textContent = SAVE_FAILED_TEXT;
    };
    if (series) {
      askScope("삭제할", run);
      return;
    }
    if (!deleteArmed) {
      deleteArmed = true;
      remove.textContent = "한 번 더 누르면 삭제돼요";
      return;
    }
    run(undefined);
  });

  buttons.append(save, remove);
  box.append(
    field("일정 이름", title), field("날짜", date), field("시간 (선택)", time), field("반복", repeat),
    field("메모 (선택)", note), field("배경색", colors.node), message, buttons,
  );
  return box;
}
