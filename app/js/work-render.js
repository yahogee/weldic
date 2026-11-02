/* Screens for the work manual: task cards, "today" overview and the month calendar.
   All text goes through textContent (no HTML injection). */
import { el, appendHighlighted, cardDetail, pageDetail } from "./render.js";
import { findTask, findDocByFile, findPage } from "./work-data.js";
import {
  buildTodayModel, formatDate, ruleLabel, monthGrid, monthDotDays,
  pointEventsOn, periodEventsOn, isSameDay, periodEnd, startOfDay,
} from "./schedule.js";

const SUNDAY_COLUMN = 0;                 // 달력에서 일요일 칸의 번호
const WEEKDAY_HEADERS = ["일", "월", "화", "수", "목", "금", "토"];
const SAMPLE_BADGE_TEXT = "예시";

/** Create an element whose text can be highlighted for search matches. */
function textElement(tag, className, text, regex) {
  const node = el(tag, className);
  appendHighlighted(node, text, regex);
  return node;
}

/** Small "예시" badge shown on sample data. */
function sampleBadge() {
  return el("span", "badge status-pending", SAMPLE_BADGE_TEXT);
}

/** Replace a detail with a linked one (term card, law article, task card) and a back button. */
function showLinked(box, linkedNode) {
  const wrapper = el("div", "linked");
  // 이미 연결 화면 안에서 또 연결로 들어가면, 바깥쪽 돌아가기 버튼은 잠시 숨겨서 버튼이 겹쳐 보이지 않게 함
  const parent = box.closest(".linked");
  if (parent) parent.classList.add("has-child");
  const back = el("button", "btn back", "← 돌아가기");
  back.type = "button";
  back.addEventListener("click", () => {
    wrapper.replaceWith(box);
    if (parent) parent.classList.remove("has-child");
    box.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  wrapper.append(back, linkedNode);
  box.replaceWith(wrapper);
  wrapper.scrollIntoView({ block: "start", behavior: "smooth" });
}

/** "D-3" / "오늘" label. */
function dayLabel(offset) {
  return offset === 0 ? "오늘" : `D-${offset}`;
}

/** Row shown in lists for a task card. */
export function taskRow(task) {
  const row = el("span", "row-main");
  row.append(el("span", "row-title", task.title));
  row.append(el("span", "chip", task.category));
  if (task.sample) row.append(sampleBadge());
  return row;
}

/** Buttons that jump to the term cards and law articles linked from a task card. */
function linkedChips(task, store, box) {
  const chips = el("div", "related");
  const hint = el("p", "note");
  for (const id of task.terms || []) {
    const card = store.cards.find((c) => c.id === id);
    if (!card) continue;
    const button = el("button", "related-chip", `용어 · ${card.term}`);
    button.type = "button";
    button.addEventListener("click", () => showLinked(box, cardDetail(card, store.manifest.docs, null, store.cards)));
    chips.append(button);
  }
  for (const law of task.laws || []) {
    const doc = findDocByFile(store.manifest.docs, law.doc);
    if (!doc) continue;
    const button = el("button", "related-chip", `법령 · ${doc.title} ${law.label}`);
    button.type = "button";
    button.addEventListener("click", () => {
      const page = findPage(store, doc, law.label);
      // 법령 본문은 백그라운드에서 불러오므로 아직 안 왔으면 안내만 보여 줌
      if (!page) {
        hint.textContent = "법령 자료를 불러오는 중이에요. 잠시 후 다시 눌러 주세요.";
        return;
      }
      showLinked(box, pageDetail({ doc, page }, null));
    });
    chips.append(button);
  }
  return chips.children.length > 0 ? [chips, hint] : [];
}

/** Detail view of a task card. */
export function taskDetail(task, store, regex = null) {
  const box = el("div", "detail-body");
  box.append(el("h2", "", task.title));
  const meta = el("div", "meta");
  meta.append(el("span", "chip", task.category));
  if (task.sample) meta.append(sampleBadge());
  meta.append(el("span", "meta-date", `기준일 ${task.basis_date}`));
  box.append(meta);

  if (task.when) {
    box.append(el("h3", "", "언제"));
    box.append(textElement("p", "gloss", task.when, regex));
  }
  // steps_title: 순서가 아닌 비교·정리 카드는 제목을 바꿔 쓸 수 있음 (기본값 "하는 순서")
  box.append(el("h3", "", task.steps_title || "하는 순서"));
  const steps = el("ol", "steps");
  task.steps.forEach((step) => steps.append(textElement("li", "", step, regex)));
  box.append(steps);

  if ((task.menu_paths || []).length > 0) {
    box.append(el("h3", "", "메뉴 경로"));
    const paths = el("ul", "plain-list");
    task.menu_paths.forEach((path) => paths.append(textElement("li", "", path, regex)));
    box.append(paths);
  }
  if ((task.cautions || []).length > 0) {
    box.append(el("h3", "", "헷갈리는 점"));
    const cautions = el("ul", "plain-list");
    task.cautions.forEach((text) => cautions.append(textElement("li", "", text, regex)));
    box.append(cautions);
  }
  const linked = linkedChips(task, store, box);
  if (linked.length > 0) {
    box.append(el("h3", "", "같이 볼 용어·법령"), ...linked);
  }
  box.append(el("p", "source", `출처: ${task.source || "업무 매뉴얼"}`));
  box.append(el("p", "note", "업무 매뉴얼을 정리한 참고용이에요. 금액·기준은 해마다 바뀔 수 있으니 기준일을 보고, 최신 공문과 담당자 안내로 확인하세요."));
  return box;
}

/** Detail view of a schedule event. */
function eventDetail(event, store) {
  const box = el("div", "detail-body");
  box.append(el("h2", "", event.title));
  const meta = el("div", "meta");
  meta.append(el("span", "chip", ruleLabel(event.rule)));
  if (event.sample) meta.append(sampleBadge());
  box.append(meta);
  if (event.prep) {
    box.append(el("h3", "", "미리 준비할 것"));
    box.append(el("p", "gloss", event.prep));
  }
  if (event.note) {
    box.append(el("h3", "", "참고"));
    box.append(el("p", "gloss", event.note));
  }
  const task = event.task ? findTask(store.work.tasks, event.task) : null;
  if (task) {
    const open = el("button", "btn", "업무 카드 보기 →");
    open.type = "button";
    open.addEventListener("click", () => showLinked(box, taskDetail(task, store)));
    box.append(open);
  }
  return box;
}

/** Row for a schedule event; `label` is a small chip (date, D-day, period end ...). */
function eventRow(event, label, accent) {
  const row = el("span", "row-main");
  if (label) row.append(el("span", accent ? "chip dday" : "chip", label));
  row.append(el("span", "row-title", event.title));
  if (event.sample) row.append(sampleBadge());
  return row;
}

/** Append a titled list of items to a container. */
function appendSection(root, title, items) {
  root.append(el("h2", "section-title", title));
  const list = el("ul", "list");
  items.forEach((item) => list.append(item));
  root.append(list);
}

/** The "today" screen: prep reminders, today, next 7 days, rest of the month, running periods. */
export function todayView(store, today, makeItem) {
  const root = el("div", "today-view");
  const events = store.work.events;
  root.append(el("h2", "today-date", `${formatDate(today)} 오늘`));
  if (events.length === 0) {
    root.append(el("p", "empty", "등록된 일정이 없어요"));
    return root;
  }
  const model = buildTodayModel(events, today);
  const open = (event) => () => eventDetail(event, store);

  if (model.prep.length > 0) {
    const prepBox = el("div", "prep-box");
    prepBox.append(el("h3", "", "미리 준비하세요"));
    const list = el("ul", "list");
    model.prep.forEach(({ event, date, offset }) => {
      list.append(makeItem(eventRow(event, `${dayLabel(offset)} · ${formatDate(date)}`, true), open(event)));
    });
    prepBox.append(list);
    root.append(prepBox);
  }

  root.append(el("h2", "section-title", "오늘"));
  if (model.today.length === 0) {
    root.append(el("p", "note", "오늘 예정된 일이 없어요"));
  } else {
    const list = el("ul", "list");
    model.today.forEach(({ event }) => list.append(makeItem(eventRow(event, "오늘", true), open(event))));
    root.append(list);
  }
  const dated = (entries) => entries.map(({ event, date }) => makeItem(eventRow(event, formatDate(date)), open(event)));
  if (model.week.length > 0) appendSection(root, "앞으로 7일", dated(model.week));
  if (model.month.length > 0) appendSection(root, "이번 달 남은 일", dated(model.month));
  if (model.anytime.length > 0) {
    appendSection(root, "이번 달 안에 하면 되는 일", model.anytime.map(({ event }) => makeItem(eventRow(event, "이번 달 중"), open(event))));
  }
  if (model.periods.length > 0) {
    appendSection(root, "진행 중인 기간", model.periods.map(({ event, end }) => makeItem(eventRow(event, `~ ${formatDate(end)}`), open(event))));
  }
  root.append(el("p", "note", "일정은 업무 매뉴얼을 정리한 참고용이에요. 정확한 날짜는 공문과 담당자 안내를 확인하세요."));
  return root;
}

/** The month calendar: dots on days with events; tapping a day lists its events right below. */
export function calendarView(store, today, makeItem, closeOpen) {
  const root = el("div", "calendar-view");
  const events = store.work.events;
  const state = { year: today.getFullYear(), month: today.getMonth() + 1, selected: startOfDay(today) };
  const holder = el("div");
  root.append(holder);

  /** Move to another month and select a sensible day in it. */
  function moveMonth(step) {
    const moved = new Date(state.year, state.month - 1 + step, 1);
    state.year = moved.getFullYear();
    state.month = moved.getMonth() + 1;
    state.selected = isSameDay(new Date(today.getFullYear(), today.getMonth(), 1), moved) ? startOfDay(today) : moved;
    draw();
  }

  /** Header with the month title and previous/next/today buttons. */
  function header() {
    const head = el("div", "cal-head");
    const prev = el("button", "cal-nav", "‹");
    prev.type = "button";
    prev.setAttribute("aria-label", "이전 달");
    prev.addEventListener("click", () => moveMonth(-1));
    const next = el("button", "cal-nav", "›");
    next.type = "button";
    next.setAttribute("aria-label", "다음 달");
    next.addEventListener("click", () => moveMonth(1));
    const goToday = el("button", "link-btn", "오늘");
    goToday.type = "button";
    goToday.addEventListener("click", () => {
      state.year = today.getFullYear();
      state.month = today.getMonth() + 1;
      state.selected = startOfDay(today);
      draw();
    });
    head.append(prev, el("strong", "cal-title", `${state.year}년 ${state.month}월`), next, goToday);
    return head;
  }

  /** The weekday header row plus one button per day. */
  function grid() {
    const dots = monthDotDays(events, state.year, state.month);
    const table = el("div", "cal-grid");
    WEEKDAY_HEADERS.forEach((name, column) => table.append(el("span", column === SUNDAY_COLUMN ? "cal-wd sun" : "cal-wd", name)));
    for (const week of monthGrid(state.year, state.month)) {
      week.forEach((date, column) => {
        if (!date) {
          table.append(el("span", "day-empty"));
          return;
        }
        const classes = ["day"];
        if (column === SUNDAY_COLUMN) classes.push("sun");
        if (isSameDay(date, today)) classes.push("today");
        if (isSameDay(date, state.selected)) classes.push("selected");
        const button = el("button", classes.join(" "), String(date.getDate()));
        button.type = "button";
        button.setAttribute("aria-label", `${state.month}월 ${date.getDate()}일${dots.has(date.getDate()) ? ", 일정 있음" : ""}`);
        if (dots.has(date.getDate())) button.append(el("span", "dot"));
        button.addEventListener("click", () => {
          state.selected = date;
          draw();
        });
        table.append(button);
      });
    }
    return table;
  }

  /** The list of events of the selected day, shown directly under the grid. */
  function dayList() {
    const box = el("div", "day-list");
    box.append(el("h2", "section-title", formatDate(state.selected)));
    const points = pointEventsOn(events, state.selected);
    const periods = periodEventsOn(events, state.selected);
    if (points.length + periods.length === 0) {
      box.append(el("p", "note", "이 날은 일정이 없어요"));
      return box;
    }
    const list = el("ul", "list");
    points.forEach((event) => list.append(makeItem(eventRow(event, ruleLabel(event.rule)), () => eventDetail(event, store))));
    periods.forEach((event) => {
      const end = periodEnd(event.rule, state.selected);
      list.append(makeItem(eventRow(event, `~ ${formatDate(end)}`), () => eventDetail(event, store)));
    });
    box.append(list);
    return box;
  }

  /** Redraw everything (called after any change of month or selected day). */
  function draw() {
    closeOpen();
    holder.replaceChildren(header(), grid(), dayList());
  }

  draw();
  return root;
}

/** The task list screen, grouped by category. */
export function tasksView(store, makeItem) {
  const root = el("div", "tasks-view");
  const tasks = store.work.tasks;
  if (tasks.length === 0) {
    root.append(el("p", "empty", "업무 카드가 없어요"));
    return root;
  }
  const groups = new Map();
  tasks.forEach((task) => {
    if (!groups.has(task.category)) groups.set(task.category, []);
    groups.get(task.category).push(task);
  });
  [...groups.keys()].sort((a, b) => a.localeCompare(b, "ko")).forEach((category) => {
    const items = groups.get(category)
      .sort((a, b) => a.title.localeCompare(b.title, "ko"))
      .map((task) => makeItem(taskRow(task), () => taskDetail(task, store)));
    appendSection(root, category, items);
  });
  return root;
}
