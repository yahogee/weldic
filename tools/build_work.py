"""Collect and validate the work manual data (task cards and schedule events).

Reads work/tasks/*.json and work/schedule/*.json.  Broken items never crash the
build: an item with a structural problem is skipped, a broken link (term, law,
task) is dropped, and every problem is printed so it shows in the Actions log.
"""
import calendar
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK_DIR = ROOT / "work"
TASKS_DIR = WORK_DIR / "tasks"
SCHEDULE_DIR = WORK_DIR / "schedule"

WEEKDAYS = "일월화수목금토"
MAX_LEAD_DAYS = 60                # keep in sync with MAX_LEAD_DAYS in app/js/schedule.js
LEAP_YEAR = 2024                  # used to allow Feb 29 in yearly rules
MONTHLY_RULES = {"monthly_day", "monthly_nth_weekday", "monthly_last_weekday"}


def load_json_lists(directory):
    """Read every *.json file of a directory; each file holds a list of items."""
    items, problems = [], []
    if not directory.is_dir():
        return items, problems
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            problems.append(f"{path.name}: cannot read ({error})")
            continue
        if not isinstance(data, list):
            problems.append(f"{path.name}: top level must be a list")
            continue
        items.extend(data)
    return items, problems


def is_text(value):
    """True for a non-empty string."""
    return isinstance(value, str) and value.strip() != ""


def is_iso_date(value):
    """True for a valid YYYY-MM-DD string."""
    try:
        date.fromisoformat(value)
        return isinstance(value, str)
    except (TypeError, ValueError):
        return False


def valid_month_day(month, day):
    """True when month/day exist (Feb 29 allowed)."""
    if not (isinstance(month, int) and isinstance(day, int)):
        return False
    return 1 <= month <= 12 and 1 <= day <= calendar.monthrange(LEAP_YEAR, month)[1]


def check_rule(rule):
    """Return a list of problems with a schedule rule (empty list = valid)."""
    if not isinstance(rule, dict):
        return ["rule must be an object"]
    kind = rule.get("type")
    problems = []
    if kind == "date":
        if not is_iso_date(rule.get("date")):
            problems.append("rule.date must be YYYY-MM-DD")
    elif kind == "yearly_date":
        if not valid_month_day(rule.get("month"), rule.get("day")):
            problems.append("rule.month/day invalid")
    elif kind == "monthly_day":
        day = rule.get("day")
        if not (isinstance(day, int) and 1 <= day <= 31):
            problems.append("rule.day must be 1-31")
    elif kind == "monthly_nth_weekday":
        nth = rule.get("nth")
        if not (isinstance(nth, int) and 1 <= nth <= 4):
            problems.append("rule.nth must be 1-4")
        if rule.get("weekday") not in list(WEEKDAYS):
            problems.append("rule.weekday must be one of 일월화수목금토")
    elif kind == "monthly_last_weekday":
        if rule.get("weekday") not in list(WEEKDAYS):
            problems.append("rule.weekday must be one of 일월화수목금토")
    elif kind == "monthly_any":
        pass
    elif kind == "period":
        if not valid_month_day(rule.get("from_month"), rule.get("from_day")):
            problems.append("rule.from_month/from_day invalid")
        if not valid_month_day(rule.get("to_month"), rule.get("to_day")):
            problems.append("rule.to_month/to_day invalid")
    else:
        problems.append(f"unknown rule type: {kind}")
    months = rule.get("months")
    if months is not None:
        allowed = kind in MONTHLY_RULES or kind == "monthly_any"
        if not allowed or not isinstance(months, list) or not all(isinstance(m, int) and 1 <= m <= 12 for m in months):
            problems.append("rule.months must be a list of 1-12 (monthly rules only)")
    return problems


def clean_task(task, card_ids, docs_by_file):
    """Validate one task card; returns (card or None, problems)."""
    problems = []
    for field in ("id", "title", "category", "basis_date"):
        if not is_text(task.get(field)):
            problems.append(f"missing field: {field}")
    steps = task.get("steps")
    if not (isinstance(steps, list) and steps and all(is_text(s) for s in steps)):
        problems.append("steps must be a non-empty list of texts")
    if is_text(task.get("basis_date")) and not is_iso_date(task["basis_date"]):
        problems.append("basis_date must be YYYY-MM-DD")
    if "steps_title" in task and not is_text(task["steps_title"]):
        problems.append("steps_title must be text")
    for field in ("aliases", "menu_paths", "cautions"):
        value = task.get(field, [])
        if not (isinstance(value, list) and all(is_text(v) for v in value)):
            problems.append(f"{field} must be a list of texts")
    if problems:
        return None, problems
    cleaned = dict(task)
    # Broken links are dropped (with a warning) so the rest of the card still works.
    good_terms = []
    for term_id in task.get("terms", []):
        if term_id in card_ids:
            good_terms.append(term_id)
        else:
            problems.append(f"term id not found (link dropped): {term_id}")
    cleaned["terms"] = good_terms
    good_laws = []
    for law in task.get("laws", []):
        document = docs_by_file.get(law.get("doc")) if isinstance(law, dict) else None
        if document is None:
            problems.append(f"law document not found (link dropped): {law}")
        elif law.get("label") not in [label for label, _ in document["pages"]]:
            problems.append(f"law article not found (link dropped): {law}")
        else:
            good_laws.append({"doc": law["doc"], "label": law["label"]})
    cleaned["laws"] = good_laws
    return cleaned, problems


def clean_event(event, task_ids):
    """Validate one schedule event; returns (event or None, problems)."""
    problems = []
    for field in ("id", "title"):
        if not is_text(event.get(field)):
            problems.append(f"missing field: {field}")
    problems.extend(check_rule(event.get("rule")))
    lead = event.get("lead_days", 0)
    if not (isinstance(lead, int) and 0 <= lead <= MAX_LEAD_DAYS):
        problems.append(f"lead_days must be 0-{MAX_LEAD_DAYS}")
    for field in ("prep", "note"):
        if field in event and not is_text(event[field]):
            problems.append(f"{field} must be text")
    if problems:
        return None, problems
    cleaned = dict(event)
    cleaned["lead_days"] = lead
    if event.get("task") and event["task"] not in task_ids:
        problems.append(f"task id not found (link dropped): {event['task']}")
        cleaned.pop("task")
    return cleaned, problems


def build_work(documents, cards):
    """Return (work_data, problem_count) for the site."""
    docs_by_file = {d["file"]: d for d in documents}
    card_ids = {c.get("id") for c in cards}
    raw_tasks, problems = load_json_lists(TASKS_DIR)
    raw_events, event_problems = load_json_lists(SCHEDULE_DIR)
    failures = len(problems) + len(event_problems)
    for message in problems + event_problems:
        print(f"[work FAIL] {message}")

    tasks, seen_ids = [], set()
    for raw in raw_tasks:
        label = raw.get("id") if isinstance(raw, dict) else raw
        task, task_problems = clean_task(raw, card_ids, docs_by_file) if isinstance(raw, dict) else (None, ["item must be an object"])
        if task is not None and task["id"] in seen_ids:
            task, task_problems = None, task_problems + ["duplicate id"]
        for message in task_problems:
            failures += 1
            print(f"[work FAIL] task {label}: {message}")
        if task is not None:
            seen_ids.add(task["id"])
            tasks.append(task)

    events, seen_event_ids = [], set()
    for raw in raw_events:
        label = raw.get("id") if isinstance(raw, dict) else raw
        event, event_issues = clean_event(raw, seen_ids) if isinstance(raw, dict) else (None, ["item must be an object"])
        if event is not None and event["id"] in seen_event_ids:
            event, event_issues = None, event_issues + ["duplicate id"]
        for message in event_issues:
            failures += 1
            print(f"[work FAIL] event {label}: {message}")
        if event is not None:
            seen_event_ids.add(event["id"])
            events.append(event)

    print(f"[work] {len(tasks)} task cards, {len(events)} schedule events, {failures} problems")
    return {"tasks": tasks, "events": events}, failures
