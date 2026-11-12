"""Convert details.json (data.go.kr 지자체복지서비스 API result) into task cards.

[학습용 설명]
공공데이터포털에서 받은 details.json(경산시 복지서비스 상세 18건)을
웰딕의 '업무 카드' 형식으로 바꿔 work/tasks/경산시복지사업.json 에 저장합니다.
원본 details.json 은 저장소에 올리지 않고, 이 프로그램으로 변환한 결과만 올립니다.

Usage:
    python3 tools/import_local_welfare.py PATH_TO_details.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "work" / "tasks" / "경산시복지사업.json"

CATEGORY = "경산시 복지사업 (참고)"
BASIS_DATE = "2026-11-12"                      # date the data was downloaded
STEPS_TITLE = "내용 정리"                       # heading shown above the facts
MISSING_TEXT = "자료 일부 없음"                 # shown when the source field is empty
SOURCE_NAME = "공공데이터포털 한국사회보장정보원_지자체복지서비스"
CARD_NOTE = ("공공데이터포털(복지로)에 올라온 내용을 그대로 옮긴 참고용이에요. "
             "받은 날(기준일) 이후 바뀌었거나 빠진 항목이 있을 수 있어요. "
             "최종 확인은 복지로 또는 담당자(팀장님)에게 하세요.")
COMMON_ALIAS = "경산시 복지"

# Old duplicate version of WLF00006068 (last modified 2024) - skipped on purpose.
SKIP_IDS = {"WLF00001770"}
# Two cards with the same amounts: WLF00005141 is merged into WLF00002874.
MERGE_INTO = {"WLF00005141": "WLF00002874"}

# Search words per service (what a person might type); added as aliases.
ALIASES = {
    "WLF00006068": ["융자", "생활안정자금", "저소득 융자", "대출", "급전", "돈 빌려"],
    "WLF00003932": ["화장", "장례", "장사", "화장비", "사망"],
    "WLF00006634": ["진료비", "감면", "보건소", "어르신 진료", "노인 진료"],
    "WLF00005132": ["기형아", "임산부", "임신", "태아"],
    "WLF00004915": ["엽산", "임신 준비", "예비부모"],
    "WLF00004853": ["다자녀", "셋째", "자녀 지원"],
    "WLF00000435": ["한부모", "긴급구호", "조손"],
    "WLF00005892": ["참전", "유공자", "배우자 수당", "보훈"],
    "WLF00001839": ["초음파", "둘째", "산모"],
    "WLF00001768": ["보훈", "사망위로금", "유공자"],
    "WLF00001769": ["보훈예우수당", "보훈", "국가유공자"],
    "WLF00000437": ["행려", "노숙", "무연고", "구호"],
    "WLF00002040": ["참전", "사망위로금", "유공자"],
    "WLF00002874": ["출산", "출산장려금", "출산축하금", "건강보험료"],
    "WLF00004906": ["출산축하박스", "축하박스", "신생아", "기저귀"],
    "WLF00000436": ["면접정장", "취업", "청년", "정장 대여"],
}
# Merged card WLF00002874 takes these text fields (cleaner than WLF00005141).
MERGED_TITLE = "출산축하금·장려금 지원"
MERGED_EXTRA_BENEFIT = "둘째아 이상 출생아에게 3년간 월 3만원 이하의 건강보험료 지원"
MERGED_EXTRA_METHOD = "읍면동 행정복지센터 방문 접수 및 정부24 온라인 신청"


def clean_text(value):
    """Collapse line breaks and repeated spaces into single spaces."""
    text = re.sub(r"\s+", " ", value or "").strip()
    # Numbered items are glued to the previous word in the source ("12,000천원2. 융자금"); add a space.
    return re.sub(r"(?<=[^\d\s])(\d{1,2}\. )", r" \1", text)


def format_date(compact):
    """'20260703' -> '2026-07-03' (empty when the value is not 8 digits)."""
    text = clean_text(compact)
    return f"{text[:4]}-{text[4:6]}-{text[6:]}" if re.fullmatch(r"\d{8}", text) else ""


def field_line(label, text):
    """One 'label: value' line; empty values are shown as MISSING_TEXT."""
    return f"{label}: {text if text else MISSING_TEXT}"


def build_card(item, overrides):
    """Make one task card from one API detail record."""
    serv_id = item["servId"]
    target = clean_text(item.get("sprtTrgtCn"))
    criteria = clean_text(item.get("slctCritCn"))
    benefit = clean_text(item.get("alwServCn"))
    method = clean_text(item.get("aplyMtdCn"))
    method_kind = clean_text(item.get("aplyMtdNm"))
    notes = []
    # Some records repeat the target text as the benefit; that is not real benefit info.
    if benefit and benefit == target:
        benefit = ""
        notes.append("지원내용: 복지로 원문이 지원대상과 같은 글로만 되어 있어 내용을 알 수 없음")
    benefit = overrides.get("benefit", benefit)
    method = overrides.get("method", method)
    steps = []
    if criteria and criteria == target:
        steps.append(field_line("지원대상·선정기준", target))
    else:
        steps.append(field_line("지원대상", target))
        steps.append(field_line("선정기준", criteria))
    steps.append(field_line("지원내용", benefit))
    steps.append(field_line("신청방법", f"[{method_kind}] {method}" if method_kind and method else (method or method_kind)))
    steps.append(field_line("담당부서", clean_text(item.get("bizChrDeptNm"))))
    cycle = " / ".join(part for part in (clean_text(item.get("sprtCycNm")), clean_text(item.get("srvPvsnNm"))) if part)
    steps.append(field_line("지원주기·방식", cycle))
    cautions = ["복지로에 올라온 내용을 옮긴 것이라 실제 시청 안내와 다를 수 있음"] + notes
    if not method:
        cautions.append("신청방법: 복지로 원문에 적혀 있지 않음. 담당자에게 확인")
    modified = format_date(item.get("lastModYmd"))
    source = f"{SOURCE_NAME} (복지로 서비스ID {serv_id}" + (f", 복지로 최종수정 {modified})" if modified else ")")
    return {
        "id": f"local-welfare-{serv_id.lower()}",
        "title": overrides.get("title", clean_text(item.get("servNm"))),
        "aliases": [COMMON_ALIAS] + ALIASES.get(serv_id, []),
        "category": CATEGORY,
        "when": clean_text(item.get("servDgst")),
        "steps_title": STEPS_TITLE,
        "steps": steps,
        "cautions": cautions,
        "source": source,
        "note": CARD_NOTE,
        "basis_date": BASIS_DATE,
        "fold_long": True,                      # the app folds long items ("전체 보기" button)
    }


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 tools/import_local_welfare.py PATH_TO_details.json")
    records = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    by_id = {record["servId"]: record for record in records if record.get("servId")}
    cards = []
    for serv_id, record in by_id.items():
        if serv_id in SKIP_IDS or serv_id in MERGE_INTO:
            continue
        overrides = {}
        if serv_id == "WLF00002874":
            overrides = {
                "title": MERGED_TITLE,
                "benefit": clean_text(record.get("alwServCn")) + " " + MERGED_EXTRA_BENEFIT,
                "method": clean_text(record.get("aplyMtdCn")) + " (" + MERGED_EXTRA_METHOD + ")",
            }
        cards.append(build_card(record, overrides))
    OUTPUT_FILE.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(cards)} cards -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
