from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "data" / "questions.js"
PLACEHOLDER_MARKERS = (
    "模擬題庫",
    "[模擬題庫]",
    "自動產生的模擬題目",
    "滿足30題隨機抽題",
    "滿足 30 題隨機抽題",
    "30題隨機抽題機制",
    "隨機抽題機制所自動產生",
)


SUBJECTS = {
    "01": {
        "group": "法規課程",
        "title": "政府採購全生命週期概論",
        "examWeight": "法規課程合計 115 分",
        "hours": 23,
        "notes": [
            "掌握採購全流程：需求確認、招標、審標、決標、履約、驗收、保固與爭議。",
            "常考「程序先後」與「各階段權責」，複習時用流程圖記憶。",
            "搭配法令彙編先看採購法總則、招標決標、履約驗收與罰則的章節位置。",
        ],
        "articleFocus": "採購法總則、招標決標、履約驗收、爭議與罰則的整體架構。",
    },
    "02": {
        "group": "法規課程",
        "title": "政府採購法之總則、招標及決標",
        "examWeight": "法規課程主力題源",
        "hours": 23,
        "notes": [
            "高頻題集中在公告金額、招標方式、等標期、押標金、底價、決標原則。",
            "特別注意「應、得、不得」以及公開招標、選擇性招標、限制性招標的適用條件。",
            "數字題多，建議把金額門檻、期限、次數獨立整理成速記表。",
        ],
        "articleFocus": "政府採購法第1條至第62條及相關子法、招標文件與決標程序規定。",
    },
    "03": {
        "group": "法規課程",
        "title": "政府採購法之履約管理及驗收",
        "examWeight": "法規課程",
        "hours": 23,
        "notes": [
            "重點在契約履行、查驗、驗收、保固、契約變更與履約爭議的分界。",
            "常把履約驗收與招標審標救濟混在一起考，看到爭議類題目先判斷階段。",
            "驗收期限、驗收紀錄、減價收受、不符契約處理方式要反覆練。",
        ],
        "articleFocus": "履約管理、驗收、保固與契約執行相關條文及作業規定。",
    },
    "04": {
        "group": "法規課程",
        "title": "政府採購法之罰則及附則",
        "examWeight": "法規課程",
        "hours": 23,
        "notes": [
            "核心是第101條停權通知、刊登公報、異議申訴、押標金追繳與刑責。",
            "是非題常把期限、效果、救濟途徑改一個字，答題時逐字看。",
            "把第87條至第92條罰則與第101條至第103條停權效果分開背。",
        ],
        "articleFocus": "罰則、停權、刊登政府採購公報、押標金追繳及附則。",
    },
    "05": {
        "group": "其他課程",
        "title": "政府採購法之爭議處理",
        "examWeight": "20 分",
        "hours": 4,
        "notes": [
            "先判斷爭議發生在招標審標決標，還是履約驗收保固。",
            "招標審標決標走異議、申訴；履約驗收多走調解、仲裁或訴訟。",
            "期限與效果最常考：異議、申訴、調解費退還、審議判斷效力。",
        ],
        "articleFocus": "第74條至第86條之1、申訴審議規則與履約爭議調解規則。",
    },
    "06": {
        "group": "其他課程",
        "title": "採購契約",
        "examWeight": "20 分",
        "hours": 4,
        "notes": [
            "重點是契約成立、生效、契約文件效力、契約變更、分包與轉包。",
            "常考契約範本、履約期限、違約金、保險、價金調整與資安/AI條款。",
            "碰到案例題先抓：誰有權變更、是否書面同意、是否可歸責。",
        ],
        "articleFocus": "採購契約要項、契約範本、分包轉包、契約變更與履約責任。",
    },
    "07": {
        "group": "實務課程",
        "title": "財物及勞務採購實務",
        "examWeight": "30 分",
        "hours": 6,
        "notes": [
            "重點在財物、勞務採購的招標文件、規格訂定、驗收與履約管理。",
            "留意資訊服務、勞務承攬、共同供應契約與財物採購的差異。",
            "實務題通常會包案例，先判斷採購性質與適用作業規定。",
        ],
        "articleFocus": "財物及勞務採購作業規定、契約範本與相關實務注意事項。",
    },
    "08": {
        "group": "實務課程",
        "title": "工程及技術服務採購作業",
        "examWeight": "30 分",
        "hours": 6,
        "notes": [
            "工程與技術服務差異是主軸，包含設計監造、專案管理、統包與技服評選。",
            "熟悉委託技術服務計費、評選、履約管理與工程保險。",
            "考題常把工程、技術服務、資訊服務的規定交錯比較。",
        ],
        "articleFocus": "工程採購、技術服務採購、統包、委託技術服務評選及計費規定。",
    },
    "09": {
        "group": "其他課程",
        "title": "投標須知及招標文件製作",
        "examWeight": "20 分",
        "hours": 4,
        "notes": [
            "招標文件哪些事項應載明、哪些限制無效，是這科最大重點。",
            "押標金、保證金、電子領標、共同投標、補正文件與不合格標要反覆練。",
            "看到「招標文件規定」題型，先判斷該規定是否不當限制競爭或違反採購法。",
        ],
        "articleFocus": "投標須知範本、招標文件製作、押標金保證金與廠商資格規定。",
    },
    "10": {
        "group": "實務課程",
        "title": "最有利標及評選優勝廠商",
        "examWeight": "30 分",
        "hours": 6,
        "notes": [
            "區分最有利標、準用最有利標、參考最有利標精神與評選優勝廠商。",
            "評選委員會組成、評分方式、協商、議價、固定費用或費率是高頻。",
            "案例題先看採購法條款依據，再判斷是否可評選、協商或議價。",
        ],
        "articleFocus": "採購法第56條、最有利標評選辦法、評選委員會與服務廠商評選規定。",
    },
    "11": {
        "group": "其他課程",
        "title": "底價及價格分析",
        "examWeight": "15 分",
        "hours": 3,
        "notes": [
            "底價訂定時點、核定權責、保密、超底價決標與不訂底價是核心。",
            "總標價偏低、部分標價偏低、減價與比減價程序要熟。",
            "數字題集中在80%、70%、超底價比例、比減價次數等。",
        ],
        "articleFocus": "底價訂定、價格分析、標價偏低處理、減價比減價及決標紀錄。",
    },
    "12": {
        "group": "其他課程",
        "title": "道德規範及違法處置",
        "examWeight": "10 分",
        "hours": 2,
        "notes": [
            "重點是採購人員倫理、利益衝突迴避、保密、請託關說與違法責任。",
            "題目常考公務員、採購人員、廠商之間哪些互動不得為之。",
            "搭配罰則一起讀，可把行政責任、刑事責任、停權效果分開記。",
        ],
        "articleFocus": "採購人員倫理準則、利益衝突迴避、保密義務與違法處置。",
    },
    "13": {
        "group": "其他課程",
        "title": "錯誤採購態樣",
        "examWeight": "10 分",
        "hours": 2,
        "notes": [
            "這科適合用題目累積判斷力：看到敘述先問是否限制競爭、規避程序或程序顛倒。",
            "常見錯誤包含限制規格、資格不當、底價程序錯誤、驗收或履約處理不當。",
            "錯題要回填成「錯誤態樣 -> 正確作法」的對照。",
        ],
        "articleFocus": "採購常見錯誤行為態樣、限制競爭、規避招標及程序瑕疵。",
    },
    "14": {
        "group": "實務課程",
        "title": "電子採購實務",
        "examWeight": "30 分",
        "hours": 6,
        "notes": [
            "熟悉政府電子採購網流程：公告、領標、電子投標、電子報價與共同供應契約。",
            "常考電子憑據、電子押標金、電子領標紀錄與系統操作責任。",
            "把紙本與電子程序的差異整理成表，選擇題會很快。",
        ],
        "articleFocus": "政府電子採購網、電子領投標、電子報價、電子押標金與系統作業規定。",
    },
}


GROUPS = {
    "法規課程": {
        "time": "13:30-14:50",
        "duration": "80 分鐘",
        "score": 115,
        "examQuestions": "是非 23 題、選擇 46 題",
    },
    "實務課程": {
        "time": "15:00-16:20",
        "duration": "80 分鐘",
        "score": 120,
        "examQuestions": "是非 24 題、選擇 48 題",
    },
    "其他課程": {
        "time": "16:30-17:50",
        "duration": "80 分鐘",
        "score": 95,
        "examQuestions": "是非 19 題、選擇 38 題",
    },
}


def clean_line(line: str) -> str:
    line = line.strip()
    line = re.sub(r"\s+", " ", line)
    return line


def extract_pdf_text(path: Path) -> str:
    with fitz.open(path) as doc:
        return "\n".join(page.get_text() for page in doc)


def is_page_noise(line: str) -> bool:
    if not line:
        return True
    if re.fullmatch(r"\d{1,4}", line):
        return True
    if line in {"編", "號", "答案", "試題", "選擇題", "是非題"}:
        return True
    return False


def is_header_noise(line: str) -> bool:
    if not line:
        return True
    if line in {"編", "號", "答案", "試題", "選擇題", "是非題"}:
        return True
    return False


def normalize_tf(answer: str) -> str:
    answer = answer.upper().replace("○", "O").replace("〇", "O").replace("×", "X")
    return answer


def parse_section(text: str, qtype: str) -> list[dict]:
    answer_re = r"[1-4]" if qtype == "choice" else r"[OX○〇×]"
    lines = [clean_line(line) for line in text.splitlines()]
    items: list[dict] = []
    current = None
    expected = 1
    i = 0

    while i < len(lines):
        line = lines[i]

        start = re.match(rf"^{expected}\s+({answer_re})(?:\s+(.*))?$", line, re.I)
        if not start and line == str(expected):
            j = i + 1
            while j < len(lines) and is_header_noise(lines[j]):
                j += 1
            if j < len(lines):
                next_line = lines[j]
                next_start = re.match(rf"^({answer_re})(?:\s+(.*))?$", next_line, re.I)
                if next_start:
                    start = next_start
                    i = j

        if start:
            if current:
                items.append(current)
            answer = normalize_tf(start.group(1))
            body = (start.group(2) or "").strip()
            current = {"number": expected, "answer": answer, "text": body}
            expected += 1
        elif is_page_noise(line):
            i += 1
            continue
        elif current:
            current["text"] = (current["text"] + " " + line).strip()
        i += 1

    if current:
        items.append(current)
    return items


def split_sections(text: str) -> tuple[str, str]:
    choice_marker = text.find("選擇題")
    tf_marker = text.find("是非題")
    if choice_marker == -1:
        choice = ""
    else:
        choice = text[choice_marker : tf_marker if tf_marker != -1 else len(text)]
    tf = text[tf_marker:] if tf_marker != -1 else ""
    return choice, tf


def split_choice_text(text: str) -> tuple[str, list[str] | None]:
    matches = list(re.finditer(r"\(([1-4])\)", text))
    if len(matches) < 4:
        return text, None
    options = []
    for idx, match in enumerate(matches[:4]):
        start = match.end()
        end = matches[idx + 1].start() if idx < 3 else len(text)
        options.append(text[start:end].strip())
    stem = text[: matches[0].start()].strip()
    return stem, options


def is_placeholder_question(*parts: object) -> bool:
    searchable = " ".join(str(part) for part in parts if part)
    return any(marker in searchable for marker in PLACEHOLDER_MARKERS) or (
        "為了滿足" in searchable and "隨機抽題" in searchable and "自動產生" in searchable
    )


def source_type(path: Path) -> str:
    if "法規課程" in str(path):
        return "法規課程"
    if "實務課程" in str(path):
        return "實務課程"
    return "其他課程"


def find_question_pdfs() -> list[Path]:
    files = []
    for path in ROOT.rglob("*.pdf"):
        name = path.name
        if "題庫" in name and "題庫數量" not in name:
            files.append(path)
    return sorted(files, key=lambda p: p.name[:2])


def build_schedule(subject_stats: dict[str, dict]) -> list[dict]:
    start = date(2026, 6, 14)
    exam = date(2026, 8, 2)
    subjects = sorted(subject_stats.values(), key=lambda s: s["id"])
    plan = []
    cursor = 0
    d = start
    while d < exam:
        day_index = (d - start).days + 1
        days_left = (exam - d).days
        if days_left <= 6:
            phase = "考前總複習"
            quiz_sets = 5 if days_left > 1 else 3
            focus = "全科模擬與錯題回補"
            note = "照正式考程順序練：法規、實務、其他。只整理會錯的數字、期限、程序。"
        elif day_index <= 7:
            phase = "建立架構"
            quiz_sets = 3
            focus = subjects[cursor % len(subjects)]["title"]
            cursor += 1
            note = "先讀重點整理與講義目錄，再做未練題，建立每科的關鍵詞。"
        elif day_index <= 30:
            phase = "題庫一刷"
            quiz_sets = 4
            focus_items = []
            for _ in range(2):
                focus_items.append(subjects[cursor % len(subjects)]["title"])
                cursor += 1
            focus = "、".join(focus_items)
            note = "優先用「未練題」模式，目標把資料夾內題型至少全部碰過一次。"
        elif day_index <= 42:
            phase = "弱點二刷"
            quiz_sets = 4
            focus = "錯題本 + 高占比科目"
            note = "先做錯題，再補法規總則/招標決標、財物勞務、最有利標、電子採購。"
        else:
            phase = "混合模擬"
            quiz_sets = 5
            focus = "三大課程混合"
            note = "每組20題限時作答，完成後只看錯題詳解，避免重讀已會內容。"

        plan.append(
            {
                "date": d.isoformat(),
                "weekday": "一二三四五六日"[d.weekday()],
                "day": day_index,
                "daysLeft": days_left,
                "phase": phase,
                "focus": focus,
                "quizSets": quiz_sets,
                "targetQuestions": quiz_sets * 20,
                "note": note,
            }
        )
        d += timedelta(days=1)
    return plan


def build() -> None:
    questions = []
    stats = {}
    parse_warnings = []

    for path in find_question_pdfs():
        subject_id_match = re.match(r"^(\d{2})\.", path.name)
        if not subject_id_match:
            continue
        subject_id = subject_id_match.group(1)
        meta = SUBJECTS.get(subject_id)
        if not meta:
            continue
        text = extract_pdf_text(path)
        choice_text, tf_text = split_sections(text)
        parsed = []
        for qtype, section_text in [("choice", choice_text), ("tf", tf_text)]:
            for item in parse_section(section_text, qtype):
                stem, options = split_choice_text(item["text"]) if qtype == "choice" else (item["text"], None)
                if is_placeholder_question(path, meta["title"], stem, item["text"], *(options or [])):
                    continue
                qid = f"{subject_id}-{qtype}-{item['number']:04d}"
                parsed.append(
                    {
                        "id": qid,
                        "subjectId": subject_id,
                        "group": meta["group"],
                        "subject": meta["title"],
                        "type": qtype,
                        "number": item["number"],
                        "answer": item["answer"],
                        "stem": stem,
                        "options": options,
                        "raw": item["text"],
                        "source": str(path.relative_to(ROOT)),
                    }
                )
        questions.extend(parsed)
        stats[subject_id] = {
            "id": subject_id,
            **meta,
            "choice": sum(1 for q in parsed if q["type"] == "choice"),
            "tf": sum(1 for q in parsed if q["type"] == "tf"),
            "total": len(parsed),
            "source": str(path.relative_to(ROOT)),
        }
        if not parsed:
            parse_warnings.append(str(path.relative_to(ROOT)))

    questions.sort(key=lambda q: (q["subjectId"], q["type"], q["number"]))
    schedule = build_schedule(stats)
    payload = {
        "generatedAt": date.today().isoformat(),
        "exam": {
            "name": "115年採購人員基礎訓練第四期考試",
            "date": "2026-08-02",
            "place": "基隆市政府",
            "totalScore": 330,
            "groups": GROUPS,
        },
        "subjects": [stats[k] for k in sorted(stats)],
        "questions": questions,
        "schedule": schedule,
        "warnings": parse_warnings,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "window.EXAM_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT}")
    print(f"Subjects: {len(stats)}")
    print(f"Questions: {len(questions)}")
    for s in payload["subjects"]:
        print(f"{s['id']} {s['title']}: choice={s['choice']} tf={s['tf']} total={s['total']}")
    if parse_warnings:
        print("Warnings:", parse_warnings)


if __name__ == "__main__":
    build()
