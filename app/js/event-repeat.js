/* Repeat rules of the user's own schedule entries ("내 일정") and the edit/delete helpers for repeating entries.
   A repeating entry is stored once as a series: rule { type: "repeat", freq, start, until }, plus a "skip" list of
   single days that were removed or changed alone. Pure functions only; nothing here touches the page. */
import { daysInMonth, parseISODate, toISO, addDays } from "./schedule.js";

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// 반복 종류 (선택 목록 순서). "none"은 한 번만 하는 일정
export const REPEAT_OPTIONS = [
  { id: "none", label: "안 함" },
  { id: "daily", label: "매일" },
  { id: "weekly", label: "매주" },
  { id: "monthly", label: "매월" },
  { id: "yearly", label: "매년" },
];
export const REPEAT_NONE = "none";
export const SCOPE_ONE = "one";          // 이 날만
export const SCOPE_FUTURE = "future";    // 이 날부터 앞으로 전부

/** True when the rule is a repeat rule with a known kind. */
export function isRepeatFreq(freq) {
  return REPEAT_OPTIONS.some((option) => option.id === freq && option.id !== REPEAT_NONE);
}

/** True when the entry repeats. */
export function isSeries(event) {
  return event.rule.type === "repeat";
}

/** The repeat kind of an entry ("none" for a one-time entry). */
export function repeatOf(event) {
  return isSeries(event) ? event.rule.freq : REPEAT_NONE;
}

/** Build the stored rule from a start date text and a repeat kind. */
export function buildRule(repeatId, dateText, until = "") {
  if (!isRepeatFreq(repeatId)) return { type: "date", date: dateText };
  return { type: "repeat", freq: repeatId, start: dateText, until: until || "" };
}

/** True when an entry happens on a date (one-time or repeating). */
export function occursOn(event, date) {
  const iso = toISO(date);
  const rule = event.rule;
  if (rule.type === "date") return rule.date === iso;
  if (rule.type !== "repeat") return false;
  if (iso < rule.start || (rule.until && iso > rule.until) || (event.skip || []).includes(iso)) return false;
  const start = parseISODate(rule.start);
  switch (rule.freq) {
    case "daily":
      return true;
    case "weekly":
      return date.getDay() === start.getDay();
    case "monthly":
      // 31일처럼 그 달에 없는 날짜는 그 달의 마지막 날로 처리
      return date.getDate() === Math.min(start.getDate(), daysInMonth(date.getFullYear(), date.getMonth() + 1));
    case "yearly":
      return date.getMonth() === start.getMonth()
        && date.getDate() === Math.min(start.getDate(), daysInMonth(date.getFullYear(), date.getMonth() + 1));
    default:
      return false;
  }
}

/** Short description of how an entry repeats ("" for a one-time entry). */
export function repeatLabel(event) {
  if (!isSeries(event)) return "";
  const start = parseISODate(event.rule.start);
  switch (event.rule.freq) {
    case "daily": return "매일";
    case "weekly": return `매주 ${WEEKDAY_NAMES[start.getDay()]}요일`;
    case "monthly": return `매월 ${start.getDate()}일`;
    case "yearly": return `매년 ${start.getMonth() + 1}월 ${start.getDate()}일`;
    default: return "";
  }
}

/** A new unique id for an entry split off from another one (the editor reuses the old id for the form values). */
function splitId(baseId, dateText) {
  return `${baseId}-${dateText}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The date text of the day before a date text. */
function dayBefore(dateText) {
  return toISO(addDays(parseISODate(dateText), -1));
}

/** True when the date text is on or before the first day of the series. */
function isFirstOccurrence(event, occurrenceISO) {
  return occurrenceISO <= event.rule.start;
}

/** New list after saving `edited` (the form values) for the entry `original` shown on `occurrenceISO`.
    scope only matters when the original repeats. */
export function applyEdit(events, original, edited, occurrenceISO, scope) {
  if (!isSeries(original)) {
    return events.some((item) => item.id === original.id)
      ? events.map((item) => (item.id === original.id ? { ...edited, id: original.id } : item))
      : [...events, edited];
  }
  if (scope === SCOPE_ONE) {
    // 이 날만: 원래 반복에서는 그날을 빼고, 바꾼 내용은 한 번만 하는 새 일정으로 만듦
    const single = { ...edited, id: splitId(original.id, occurrenceISO), rule: { type: "date", date: edited.rule.type === "date" ? edited.rule.date : edited.rule.start }, skip: [] };
    return [...events.map((item) => (item.id === original.id ? { ...item, skip: [...(item.skip || []), occurrenceISO] } : item)), single];
  }
  // 이 날부터 앞으로 전부: 처음 날이면 통째로 바꾸고, 아니면 원래 반복은 전날까지로 끝내고 새 반복을 이어서 만듦
  const keepSkip = (original.skip || []).filter((day) => day > occurrenceISO);
  if (isFirstOccurrence(original, occurrenceISO)) {
    return events.map((item) => (item.id === original.id ? { ...edited, id: original.id, skip: keepSkip } : item));
  }
  const continued = { ...edited, id: splitId(original.id, occurrenceISO), rule: continuedRule(edited, original), skip: keepSkip };
  return [...events.map((item) => (item.id === original.id ? { ...item, rule: { ...item.rule, until: dayBefore(occurrenceISO) } } : item)), continued];
}

/** The rule of the new series after "앞으로 전부" (keeps the old end date when the kind is still a repeat). */
function continuedRule(edited, original) {
  return isSeries(edited) ? { ...edited.rule, until: original.rule.until || "" } : edited.rule;
}

/** New list after deleting the entry shown on `occurrenceISO`. */
export function applyDelete(events, original, occurrenceISO, scope) {
  if (!isSeries(original)) return events.filter((item) => item.id !== original.id);
  if (scope === SCOPE_ONE) {
    return events.map((item) => (item.id === original.id ? { ...item, skip: [...(item.skip || []), occurrenceISO] } : item));
  }
  if (isFirstOccurrence(original, occurrenceISO)) return events.filter((item) => item.id !== original.id);
  return events.map((item) => (item.id === original.id ? { ...item, rule: { ...item.rule, until: dayBefore(occurrenceISO) } } : item));
}

