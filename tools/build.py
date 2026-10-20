#!/usr/bin/env python3
"""Build the weldic static site.

Reads every document in library/ (PDF or TXT), splits it into pages,
verifies term cards against the source text, and writes the finished
site into site/.  Only the Python standard library and poppler's
`pdftotext` are used.

Usage:
    python3 tools/build.py            # normal build (warnings only)
    python3 tools/build.py --strict   # exit 1 if any card fails verification
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY_DIR = ROOT / "library"
TERMS_DIR = ROOT / "terms"
APP_DIR = ROOT / "app"
SITE_DIR = ROOT / "site"

KST = timezone(timedelta(hours=9))
DOC_ID_LENGTH = 10
ARTICLE_PATTERN = re.compile(r"^(제\d+조(?:의\d+)?)")
LAW_REF_PATTERN = re.compile(r"제\d+[조항호](?:의\d+)?")
DIGIT_PATTERN = re.compile(r"\d")
SUPPORTED_SUFFIXES = {".pdf", ".txt"}


def normalize(text):
    """Unicode-normalize and collapse all whitespace to single spaces."""
    text = unicodedata.normalize("NFC", text)
    return re.sub(r"\s+", " ", text).strip()


def squash(text):
    """Remove all whitespace; used to compare quotes with source text."""
    return re.sub(r"\s+", "", unicodedata.normalize("NFC", text))


def make_doc_id(relative_path):
    """Stable short id derived from the file path."""
    return hashlib.sha1(relative_path.encode("utf-8")).hexdigest()[:DOC_ID_LENGTH]


def extract_pdf_pages(pdf_path):
    """Return a list of (label, text) using poppler's pdftotext."""
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True, check=True,
    )
    raw_pages = result.stdout.decode("utf-8", errors="replace").split("\f")
    if raw_pages and not raw_pages[-1].strip():
        raw_pages.pop()
    return [(f"{number}쪽", normalize(text)) for number, text in enumerate(raw_pages, 1)]


def split_law_text(body):
    """Split law text into one unit per article (제N조)."""
    units = []
    label, buffer = "머리말", []
    for line in body.splitlines():
        match = ARTICLE_PATTERN.match(line.strip())
        if match:
            if buffer:
                units.append((label, normalize(" ".join(buffer))))
            label, buffer = match.group(1), [line]
        else:
            buffer.append(line)
    if buffer:
        units.append((label, normalize(" ".join(buffer))))
    return [(l, t) for l, t in units if t]


def read_text_document(txt_path):
    """Return (title, pages) for a TXT document; first '# ' line is the title."""
    content = txt_path.read_text(encoding="utf-8")
    title = txt_path.stem
    lines = content.splitlines()
    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip()
        content = "\n".join(lines[1:])
    if "\f" in content:
        pages = [(f"{n}쪽", normalize(p)) for n, p in enumerate(content.split("\f"), 1) if p.strip()]
    else:
        pages = split_law_text(content)
    return title, pages


def collect_documents():
    """Extract every supported file in library/ into document records."""
    documents = []
    for path in sorted(LIBRARY_DIR.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            print(f"[skip] unsupported file type: {path.name}")
            continue
        relative = path.relative_to(LIBRARY_DIR).as_posix()
        if path.suffix.lower() == ".pdf":
            title, pages, kind = path.stem, extract_pdf_pages(path), "pdf"
        else:
            title, pages = read_text_document(path)
            kind = "law" if relative.startswith("법령/") else "text"
        total_chars = sum(len(t) for _, t in pages)
        if total_chars == 0:
            print(f"[warn] no text found (scanned PDF?): {relative}")
            continue
        documents.append({
            "id": make_doc_id(relative), "title": title, "kind": kind,
            "file": relative, "pages": pages, "chars": total_chars,
        })
        print(f"[doc] {relative}: {len(pages)} pages, {total_chars} chars")
    return documents


def load_cards():
    """Load all card files from terms/ (each file is a JSON list)."""
    cards = []
    for path in sorted(TERMS_DIR.glob("*.json")):
        cards.extend(json.loads(path.read_text(encoding="utf-8")))
    return cards


def verify_card(card, docs_by_file):
    """Return a list of problems; an empty list means the card is verified."""
    problems = []
    source = card.get("source", {})
    document = docs_by_file.get(source.get("doc"))
    if document is None:
        return [f"source document not found: {source.get('doc')}"]
    quote = squash(card.get("quote", ""))
    if not quote:
        problems.append("quote is empty")
    else:
        label = source.get("label")
        candidates = [t for l, t in document["pages"] if label is None or l == label]
        if not any(quote in squash(t) for t in candidates):
            problems.append(f"quote not found in {source.get('doc')} ({label})")
    gloss_without_refs = LAW_REF_PATTERN.sub("", card.get("gloss", ""))
    if DIGIT_PATTERN.search(gloss_without_refs):
        problems.append("gloss contains digits (amounts/rates must stay in the source)")
    for field in ("id", "term", "system", "quote", "gloss", "basis_date"):
        if not card.get(field):
            problems.append(f"missing field: {field}")
    return problems


def build_cards(cards, documents):
    """Attach a computed status to each card and report problems."""
    docs_by_file = {d["file"]: d for d in documents}
    seen_ids, failures = set(), 0
    for card in cards:
        problems = verify_card(card, docs_by_file)
        if card.get("id") in seen_ids:
            problems.append("duplicate id")
        seen_ids.add(card.get("id"))
        if problems:
            failures += 1
            card["status"] = "검수 전"
            print(f"[card FAIL] {card.get('id')}: {'; '.join(problems)}")
        else:
            card["status"] = "확인됨" if card.get("confirmed") else "원문 대조됨"
        source_doc = docs_by_file.get(card.get("source", {}).get("doc"))
        card["source_title"] = source_doc["title"] if source_doc else ""
        card["source_doc_id"] = source_doc["id"] if source_doc else ""
    print(f"[cards] {len(cards)} cards, {failures} failed verification")
    return cards, failures


def write_site(documents, cards):
    """Write the final static site into site/."""
    if SITE_DIR.exists():
        shutil.rmtree(SITE_DIR)
    shutil.copytree(APP_DIR, SITE_DIR)
    (SITE_DIR / "data" / "docs").mkdir(parents=True, exist_ok=True)
    build_stamp = datetime.now(KST)
    build_id = build_stamp.strftime("%Y%m%d%H%M%S")
    manifest_docs = []
    for document in documents:
        doc_path = SITE_DIR / "data" / "docs" / f"{document['id']}.json"
        payload = {"id": document["id"], "pages": [{"l": l, "t": t} for l, t in document["pages"]]}
        doc_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        target = SITE_DIR / "library" / document["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(LIBRARY_DIR / document["file"], target)
        manifest_docs.append({
            "id": document["id"], "title": document["title"], "kind": document["kind"],
            "file": "library/" + document["file"], "pageCount": len(document["pages"]),
        })
    manifest = {
        "buildId": build_id,
        "builtAt": build_stamp.strftime("%Y-%m-%d"),
        "docs": manifest_docs,
        "cardCount": len(cards),
    }
    data_dir = SITE_DIR / "data"
    (data_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    (data_dir / "cards.json").write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    service_worker = SITE_DIR / "sw.js"
    service_worker.write_text(service_worker.read_text(encoding="utf-8").replace("__BUILD_ID__", build_id), encoding="utf-8")
    print(f"[site] built {SITE_DIR} (build {build_id})")


def main():
    strict = "--strict" in sys.argv
    documents = collect_documents()
    cards, failures = build_cards(load_cards(), documents)
    write_site(documents, cards)
    if strict and failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
