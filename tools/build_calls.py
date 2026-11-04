"""Collect and validate the phone-call data (common frame, call types, real cases).

Reads work/calls/*.json; every item has a "kind": "frame", "type" or "case".
Like build_work.py, a broken link is dropped with a warning and a structurally
broken item is skipped, so one typo never breaks the whole build.
"""
from build_work import ROOT, load_json_lists, is_text, is_iso_date

CALLS_DIR = ROOT / "work" / "calls"

TEXT_LIST_FIELDS = ("heard", "aliases", "ask", "check", "say", "handoff", "cautions")
REQUIRED_TEXT_FIELDS = {
    "frame": ("id", "title", "basis_date"),
    "type": ("id", "title", "category", "real_need", "basis_date"),
    "case": ("id", "title", "heard", "real_need", "lesson", "basis_date"),
}


def is_text_list(value):
    """True for a list whose items are all non-empty texts."""
    return isinstance(value, list) and all(is_text(item) for item in value)


def check_structure(item, kind):
    """Return the structural problems of one item (empty list = valid)."""
    problems = [f"missing field: {name}" for name in REQUIRED_TEXT_FIELDS[kind] if not is_text(item.get(name))]
    if is_text(item.get("basis_date")) and not is_iso_date(item["basis_date"]):
        problems.append("basis_date must be YYYY-MM-DD")
    if kind == "type":
        if not (is_text_list(item.get("heard")) and item["heard"]):
            problems.append("heard must be a non-empty list of texts")
        for name in TEXT_LIST_FIELDS:
            if name in item and not is_text_list(item[name]):
                problems.append(f"{name} must be a list of texts")
        if "gap" in item and not is_text(item["gap"]):
            problems.append("gap must be text")
    if kind == "frame":
        sections = item.get("sections")
        valid = isinstance(sections, list) and sections and all(
            isinstance(s, dict) and is_text(s.get("title")) and is_text_list(s.get("items")) for s in sections)
        if not valid:
            problems.append("sections must be a non-empty list of {title, items}")
        if "quick" in item and not is_text_list(item["quick"]):
            problems.append("quick must be a list of texts")
    return problems


def clean_links(item, task_ids, card_ids, type_ids):
    """Drop links to things that do not exist; returns (cleaned item, problems)."""
    problems, cleaned = [], dict(item)
    if item["kind"] == "type":
        cleaned["tasks"] = [t for t in item.get("tasks", []) if t in task_ids]
        cleaned["terms"] = [t for t in item.get("terms", []) if t in card_ids]
        problems += [f"task id not found (link dropped): {t}" for t in item.get("tasks", []) if t not in task_ids]
        problems += [f"term id not found (link dropped): {t}" for t in item.get("terms", []) if t not in card_ids]
    if item["kind"] == "case" and item.get("call_type") and item["call_type"] not in type_ids:
        problems.append(f"call_type not found (link dropped): {item['call_type']}")
        cleaned.pop("call_type")
    return cleaned, problems


def build_calls(tasks, cards):
    """Return (calls_data, problem_count). calls_data = {frame, types, cases}."""
    task_ids = {t["id"] for t in tasks}
    card_ids = {c.get("id") for c in cards}
    raw_items, file_problems = load_json_lists(CALLS_DIR)
    failures = len(file_problems)
    for message in file_problems:
        print(f"[calls FAIL] {message}")
    type_ids = {i.get("id") for i in raw_items if isinstance(i, dict) and i.get("kind") == "type"}
    result, seen = {"frame": None, "types": [], "cases": []}, set()
    for raw in raw_items:
        label = raw.get("id") if isinstance(raw, dict) else raw
        kind = raw.get("kind") if isinstance(raw, dict) else None
        if kind not in REQUIRED_TEXT_FIELDS:
            failures += 1
            print(f"[calls FAIL] {label}: kind must be frame, type or case")
            continue
        problems = check_structure(raw, kind)
        if raw.get("id") in seen:
            problems.append("duplicate id")
        if problems:
            failures += len(problems)
            for message in problems:
                print(f"[calls FAIL] {kind} {label}: {message}")
            continue
        seen.add(raw["id"])
        item, link_problems = clean_links(raw, task_ids, card_ids, type_ids)
        failures += len(link_problems)
        for message in link_problems:
            print(f"[calls FAIL] {kind} {label}: {message}")
        if kind == "frame":
            result["frame"] = item
        else:
            result["types" if kind == "type" else "cases"].append(item)
    print(f"[calls] {len(result['types'])} call types, {len(result['cases'])} cases, frame {'yes' if result['frame'] else 'no'}, {failures} problems")
    return result, failures
