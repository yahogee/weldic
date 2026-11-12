"""Convert central_details.json (data.go.kr 중앙부처복지서비스 API result) into task cards.

[학습용 설명]
공공데이터포털에서 받은 central_details.json(중앙부처 복지서비스 상세)을
웰딕의 '업무 카드' 형식으로 바꿔 work/tasks/중앙부처복지사업.json 에 저장합니다.
지자체용 변환 프로그램(import_local_welfare.py)의 공통 함수(field_line 등)를 그대로 가져다 씁니다.
원본 json 은 저장소에 올리지 않고, 변환 결과만 올립니다.

Usage:
    python3 tools/import_central_welfare.py PATH_TO_central_details.json
"""
import html
import json
import re
import sys
from pathlib import Path

from import_local_welfare import MISSING_TEXT, field_line  # reuse: same card line format as the local cards

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "work" / "tasks" / "중앙부처복지사업.json"

CATEGORY = "중앙부처 복지사업 (참고)"
BASIS_DATE = "2026-11-12"                      # date the data was downloaded
STEPS_TITLE = "내용 정리"                       # heading shown above the facts
SOURCE_NAME = "공공데이터포털 한국사회보장정보원_중앙부처복지서비스"
COMMON_ALIAS = "중앙부처 복지"
LINE_JOINER = " / "                            # original line breaks are shown as this separator
FLOW_JOINER = " → "                            # application steps are shown as a flow
MAX_FORM_NAMES = 4                             # how many form/guide file names to show
REFER_TARGET_MAX_LEN = 30                      # a short criteria text that only says "see the target" is a placeholder
REFER_TARGET_WORD = "참고"
CARD_NOTE = ("공공데이터포털(복지로)에 올라온 내용을 그대로 옮긴 참고용이에요. "
             "금액과 기준은 해마다 바뀌고, 받은 날(기준일) 이후 달라졌을 수 있어요. "
             "최종 확인은 복지로 또는 담당자(팀장님)에게 하세요.")

# Search words per service (what a person might type); added as aliases.
ALIASES = {
    "WLF00001132": ["생계", "기초생활", "기초수급", "수급자", "중위소득"],
    "WLF00003201": ["주거", "월세", "임차료", "집수리", "수선", "기초수급"],
    "WLF00000102": ["의료비", "1종", "2종", "수급자 병원", "기초수급"],
    "WLF00001089": ["교육", "학용품", "교육비", "입학금", "수업료", "기초수급"],
    "WLF00001135": ["해산", "출산", "출산비", "기초수급"],
    "WLF00003267": ["장제", "장례", "사망", "장례비", "기초수급"],
    "WLF00003180": ["긴급", "위기가구", "위기상황", "긴급지원", "생계비", "무소득"],
    "WLF00003179": ["긴급 의료", "병원비", "수술", "입원", "중한 질병", "긴급"],
    "WLF00000917": ["긴급 주거", "임시거소", "쫓겨남", "숙박", "긴급"],
    "WLF00001162": ["연료비", "전기요금", "난방비", "단전", "겨울나기", "도시가스", "에너지", "긴급"],
    "WLF00003178": ["긴급 해산", "출산", "조산", "긴급"],
    "WLF00000892": ["긴급 장제", "장례", "사망", "긴급"],
    "WLF00001112": ["긴급 교육", "학비", "수업료", "학생", "긴급"],
    "WLF00003229": ["긴급 시설", "입소", "쉼터", "긴급"],
    "WLF00003191": ["노인돌봄", "독거노인", "안부확인", "생활교육", "어르신 돌봄"],
    "WLF00005442": ["긴급 돌봄", "돌봄 공백", "일시 돌봄", "갑자기 입원", "간병"],
    "WLF00005411": ["일상 돌봄", "가족돌봄청년", "중장년 돌봄", "청년 돌봄"],
    "WLF00003249": ["장애인 연금", "중증장애인", "소득 지원"],
    "WLF00003260": ["활동보조", "활동지원사", "장애인 활동", "바우처"],
    "WLF00001093": ["응급안전", "독거노인", "119 연결", "안심 서비스", "응급호출기"],
    "WLF00003211": ["보조기기", "휠체어", "보청기", "보조기구"],
    "WLF00003181": ["장애인 의료비", "진료비 지원"],
    "WLF00006257": ["건보료", "건강보험료", "경감", "감면"],
    "WLF00006294": ["장애인 등록", "장애인 등록증", "장애 등록", "장애인증", "장애 진단서"],
}


def clean_lines(value):
    """Decode HTML entities, split on the source's line breaks and join the lines with LINE_JOINER."""
    text = html.unescape(value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return LINE_JOINER.join(line for line in lines if line)


def application_flow(item):
    """Application procedure: the source lists the steps one by one (apply -> review -> decide -> ...)."""
    steps = [clean_lines(row.get("servSeDetailLink")) for row in item.get("applmetList", [])]
    return FLOW_JOINER.join(step for step in steps if step)


def inquiry_text(item):
    """Phone numbers and web sites for questions, as in the source."""
    phones = [f"{clean_lines(r.get('servSeDetailNm'))} {clean_lines(r.get('servSeDetailLink'))}".strip()
              for r in item.get("inqplCtadrList", [])]
    sites = [f"{clean_lines(r.get('servSeDetailNm'))} {clean_lines(r.get('servSeDetailLink'))}".strip()
             for r in item.get("inqplHmpgReldList", [])]
    return ", ".join(part for part in phones + sites if part)


def name_list(rows, limit=None):
    """Comma-joined 'servSeDetailNm' values of a list of rows."""
    names = [clean_lines(row.get("servSeDetailNm")) for row in rows]
    names = [name for name in names if name]
    return ", ".join(names[:limit] if limit else names)


def is_placeholder_criteria(criteria):
    """True when the criteria text only tells the reader to look at the target text."""
    return len(criteria) <= REFER_TARGET_MAX_LEN and REFER_TARGET_WORD in criteria


def build_card(item):
    """Make one task card from one API detail record."""
    serv_id = item["servId"]
    target = clean_lines(item.get("tgtrDtlCn"))
    criteria = clean_lines(item.get("slctCritCn"))
    cautions = ["복지로에 올라온 내용을 옮긴 것이라 실제 시청·센터 안내와 다를 수 있음"]
    steps = []
    if criteria == target or is_placeholder_criteria(criteria):
        steps.append(field_line("지원대상·선정기준", target))
        if is_placeholder_criteria(criteria):
            cautions.append("선정기준: 복지로 원문이 '지원대상 내용 참고'로만 적혀 있어 합쳐서 보여 줌")
    else:
        steps.append(field_line("지원대상", target))
        steps.append(field_line("선정기준", criteria))
    steps.append(field_line("지원내용", clean_lines(item.get("alwServCn"))))
    steps.append(field_line("신청 흐름", application_flow(item)))
    steps.append(field_line("문의처", inquiry_text(item)))
    steps.append(field_line("소관부처", clean_lines(item.get("jurMnofNm"))))
    cycle = " / ".join(part for part in (clean_lines(item.get("sprtCycNm")), clean_lines(item.get("srvPvsnNm"))) if part)
    steps.append(field_line("지원주기·방식", cycle))
    steps.append(field_line("근거 법령", name_list(item.get("baslawList", []))))
    steps.append(field_line("서식·안내문(복지로에서 내려받기)", name_list(item.get("basfrmList", []), MAX_FORM_NAMES)))
    year = clean_lines(item.get("crtrYr"))
    if year:
        cautions.append(f"금액·기준은 {year}년 기준이며 해마다 바뀜")
    if any(MISSING_TEXT in step for step in steps):
        cautions.append(f"'{MISSING_TEXT}'으로 표시된 칸은 복지로 원문에 내용이 없는 것")
    source = f"{SOURCE_NAME} (복지로 서비스ID {serv_id}" + (f", 기준연도 {year})" if year else ")")
    return {
        "id": f"central-welfare-{serv_id.lower()}",
        "title": clean_lines(item.get("servNm")),
        "aliases": [COMMON_ALIAS] + ALIASES.get(serv_id, []),
        "category": CATEGORY,
        "when": clean_lines(item.get("wlfareInfoOutlCn")),
        "steps_title": STEPS_TITLE,
        "steps": steps,
        "cautions": cautions,
        "source": source,
        "note": CARD_NOTE,
        "basis_date": BASIS_DATE,
    }


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 tools/import_central_welfare.py PATH_TO_central_details.json")
    records = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    cards = [build_card(record) for record in records if record.get("servId") and "_error" not in record]
    OUTPUT_FILE.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(cards)} cards -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
