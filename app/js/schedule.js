/* Schedule engine: turns repeat rules (every month, last Friday, a period ...)
   into concrete dates. Pure functions only; nothing here touches the page. */

// 요일 이름 목록 (JS의 getDay() 값 0~6과 순서가 같음: 일=0 ... 토=6)
const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const NTH_NAMES = ["", "첫째", "둘째", "셋째", "넷째"];
const WEEK_AHEAD_DAYS = 7;       // "앞으로 7일" 구간의 길이
const MAX_LEAD_DAYS = 60;        // 미리 알림을 계산하는 최대 일수
const DAYS_PER_WEEK = 7;
const KEY_MONTH_FACTOR = 100;    // 월/일을 하나의 숫자(예: 1205)로 만들 때 쓰는 자릿수
const MS_PER_DAY = 86400000;     // 하루의 밀리초 (남은 일수 계산용)

/** Index (0=Sun..6=Sat) of a Korean weekday name, or -1 when unknown. */
export function weekdayIndex(name) {
  return WEEKDAY_NAMES.indexOf(name);
}

/** Number of days in a month (month is 1-12). */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** A new Date moved by a number of days (time of day is dropped). */
export function addDays(date, count) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

/** The same calendar day at 00:00 local time. */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** True when both dates fall on the same calendar day. */
export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "YYYY-MM-DD" text for a date (local time). */
export function toISO(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parse "YYYY-MM-DD" into a local Date. */
export function parseISODate(text) {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** "11월 27일(금)" style label. */
export function formatDate(date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일(${WEEKDAY_NAMES[date.getDay()]})`;
}

/** Month/day packed into one number so ranges can be compared (Dec 1 -> 1201). */
function monthDayKey(month, day) {
  return month * KEY_MONTH_FACTOR + day;
}

/** True for rules that happen on one specific day (not a period or "sometime this month"). */
export function isPointRule(rule) {
  return rule.type !== "period" && rule.type !== "monthly_any";
}

/** True when the optional "months" filter of a rule allows this date's month. */
function monthAllowed(rule, date) {
  return !rule.months || rule.months.includes(date.getMonth() + 1);
}

/** True when a date falls inside a yearly period (periods may wrap over New Year). */
function inPeriod(rule, date) {
  const from = monthDayKey(rule.from_month, rule.from_day);
  const to = monthDayKey(rule.to_month, rule.to_day);
  const current = monthDayKey(date.getMonth() + 1, date.getDate());
  return from <= to ? current >= from && current <= to : current >= from || current <= to;
}

/** End date of the period occurrence that contains the given date. */
export function periodEnd(rule, date) {
  const from = monthDayKey(rule.from_month, rule.from_day);
  const to = monthDayKey(rule.to_month, rule.to_day);
  const current = monthDayKey(date.getMonth() + 1, date.getDate());
  const wraps = from > to;
  const endYear = wraps && current >= from ? date.getFullYear() + 1 : date.getFullYear();
  return new Date(endYear, rule.to_month - 1, rule.to_day);
}

/** True when a point rule happens on this date. Period / "any day this month" rules return false. */
export function matchesDate(rule, date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const length = daysInMonth(date.getFullYear(), month);
  switch (rule.type) {
    case "date":
      return toISO(date) === rule.date;
    case "yearly_date":
      return month === rule.month && day === rule.day;
    case "monthly_day":
      // 31일처럼 그 달에 없는 날짜는 그 달의 마지막 날로 처리
      return monthAllowed(rule, date) && day === Math.min(rule.day, length);
    case "monthly_nth_weekday":
      return monthAllowed(rule, date) && date.getDay() === weekdayIndex(rule.weekday)
        && Math.ceil(day / DAYS_PER_WEEK) === rule.nth;
    case "monthly_last_weekday":
      return monthAllowed(rule, date) && date.getDay() === weekdayIndex(rule.weekday)
        && day + DAYS_PER_WEEK > length;
    default:
      return false;
  }
}

/** Human readable description of a rule, e.g. "매월 마지막 금요일". */
export function ruleLabel(rule) {
  const monthsPrefix = rule.months ? `${rule.months.join("·")}월 ` : "매월 ";
  switch (rule.type) {
    case "date":
      return formatDate(parseISODate(rule.date)).replace(/\(.\)$/, "");
    case "yearly_date":
      return `매년 ${rule.month}월 ${rule.day}일`;
    case "monthly_day":
      return `${monthsPrefix}${rule.day}일`;
    case "monthly_nth_weekday":
      return `${monthsPrefix}${NTH_NAMES[rule.nth]} 주 ${rule.weekday}요일`;
    case "monthly_last_weekday":
      return `${monthsPrefix}마지막 ${rule.weekday}요일`;
    case "monthly_any":
      return rule.months ? `${rule.months.join("·")}월 중 (날짜 정해지지 않음)` : "매월 (날짜 정해지지 않음)";
    case "period":
      return `${rule.from_month}월 ${rule.from_day}일 ~ ${rule.to_month}월 ${rule.to_day}일`;
    default:
      return "";
  }
}

/** Point events (with their rule) that happen on a date. */
export function pointEventsOn(events, date) {
  return events.filter((event) => isPointRule(event.rule) && matchesDate(event.rule, date));
}

/** Period events that are running on a date. */
export function periodEventsOn(events, date) {
  return events.filter((event) => event.rule.type === "period" && inPeriod(event.rule, date));
}

/** "Do it sometime this month" events that apply to the month of the date. */
export function monthlyAnyEventsOn(events, date) {
  return events.filter((event) => event.rule.type === "monthly_any" && monthAllowed(event.rule, date));
}

/** Days of a month (1-31) that have at least one point event, as a Set. */
export function monthDotDays(events, year, month) {
  const days = new Set();
  const length = daysInMonth(year, month);
  for (let day = 1; day <= length; day += 1) {
    if (pointEventsOn(events, new Date(year, month - 1, day)).length > 0) days.add(day);
  }
  return days;
}

/** Calendar grid for a month: array of weeks, each with 7 cells (Date or null). Sunday first. */
export function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const length = daysInMonth(year, month);
  const cells = Array(first.getDay()).fill(null);
  for (let day = 1; day <= length; day += 1) cells.push(new Date(year, month - 1, day));
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);
  const weeks = [];
  for (let index = 0; index < cells.length; index += DAYS_PER_WEEK) weeks.push(cells.slice(index, index + DAYS_PER_WEEK));
  return weeks;
}

/** Everything the "today" screen needs, computed from the events and today's date. */
export function buildTodayModel(events, todayInput) {
  const today = startOfDay(todayInput);
  const model = { today: [], week: [], month: [], prep: [], periods: [], anytime: [] };
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const horizon = Math.max(Math.round((monthEnd - today) / MS_PER_DAY), MAX_LEAD_DAYS);
  const prepSeen = new Set();
  for (let offset = 0; offset <= horizon; offset += 1) {
    const date = addDays(today, offset);
    for (const event of pointEventsOn(events, date)) {
      const entry = { event, date, offset };
      if (offset === 0) model.today.push(entry);
      else if (offset <= WEEK_AHEAD_DAYS) model.week.push(entry);
      else if (date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()) model.month.push(entry);
      // 미리 알림: 준비 기간(lead_days) 안에 들어온 가장 가까운 날짜 하나만 보여 줌
      if (offset > 0 && event.lead_days > 0 && offset <= event.lead_days && !prepSeen.has(event.id)) {
        prepSeen.add(event.id);
        model.prep.push(entry);
      }
    }
  }
  model.periods = periodEventsOn(events, today).map((event) => ({ event, end: periodEnd(event.rule, today) }));
  model.anytime = monthlyAnyEventsOn(events, today).map((event) => ({ event }));
  return model;
}
