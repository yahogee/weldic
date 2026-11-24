/* Storage of the user's own schedule entries ("내 일정").
   Each entry uses the same rule shape as the work schedule ({ type: "date", date }) so the
   schedule engine can find the entries of a day and later repeat rules can reuse it.
   Entries live only in this browser's localStorage and are never sent anywhere. */
import { pointEventsOn, daysInMonth, parseISODate } from "./schedule.js";

const STORAGE_KEY = "weldic.events.v1";
export const TITLE_MAX_CHARS = 60;       // 일정 제목 최대 글자 수
export const NOTE_MAX_CHARS = 300;       // 일정 메모 최대 글자 수
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 배경색 3개 + 색 없음. 뜻은 사용자가 스스로 정하고 기억함(앱은 설명을 붙이지 않음). 달력 칸에서는 이 순서로 위에 쌓임
export const EVENT_COLORS = [
  { id: "red", label: "빨강" },
  { id: "yellow", label: "노랑" },
  { id: "green", label: "초록" },
  { id: "none", label: "색 없음" },
];
export const DEFAULT_COLOR = "none";

/** Position of a color in the display order (unknown colors count as "none"). */
function colorOrder(colorId) {
  const index = EVENT_COLORS.findIndex((color) => color.id === colorId);
  return index === -1 ? EVENT_COLORS.length - 1 : index;
}

/** The color id itself when known, otherwise the default. */
export function normalizeColor(colorId) {
  return EVENT_COLORS.some((color) => color.id === colorId) ? colorId : DEFAULT_COLOR;
}

/** True when text is a real calendar date written as YYYY-MM-DD. */
export function isValidDateText(text) {
  if (typeof text !== "string" || !DATE_PATTERN.test(text)) return false;
  const date = parseISODate(text);
  const [year, month, day] = text.split("-").map(Number);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

/** True when a stored value looks like a valid entry. */
function isValidEvent(event) {
  return Boolean(event) && typeof event.id === "string" && typeof event.title === "string" && event.title.trim() !== ""
    && Boolean(event.rule) && event.rule.type === "date" && isValidDateText(event.rule.date);
}

/** Read all entries; any storage problem (private mode, blocked data) results in an empty list. */
export function loadEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEvent).map((event) => ({
      id: event.id,
      title: event.title,
      rule: { type: "date", date: event.rule.date },
      time: typeof event.time === "string" && TIME_PATTERN.test(event.time) ? event.time : "",
      note: typeof event.note === "string" ? event.note : "",
      color: normalizeColor(event.color),
    }));
  } catch (error) {
    return [];
  }
}

/** Write all entries; returns false when the browser refuses to store them. */
export function saveEvents(events) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    return true;
  } catch (error) {
    return false;
  }
}

/** Short unique id for a new entry. */
export function newEventId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Build an entry object from form values (text is trimmed and shortened to the maximum length). */
export function buildEvent({ id, title, date, time, note, color }) {
  return {
    id: id || newEventId(),
    title: title.trim().slice(0, TITLE_MAX_CHARS),
    rule: { type: "date", date },
    time: TIME_PATTERN.test(time || "") ? time : "",
    note: (note || "").trim().slice(0, NOTE_MAX_CHARS),
    color: normalizeColor(color),
  };
}

/** Entries of one day: no-time entries first, then by time, then by color order. */
export function personalEventsOn(events, date) {
  return pointEventsOn(events, date).sort((a, b) => a.time.localeCompare(b.time) || colorOrder(a.color) - colorOrder(b.color));
}

/** Map of day number -> entries (color order first, so red is always on top) for a whole month. */
export function monthEventMap(events, year, month) {
  const map = new Map();
  const length = daysInMonth(year, month);
  for (let day = 1; day <= length; day += 1) {
    const found = pointEventsOn(events, new Date(year, month - 1, day));
    if (found.length > 0) map.set(day, found.sort((a, b) => colorOrder(a.color) - colorOrder(b.color) || a.time.localeCompare(b.time)));
  }
  return map;
}
