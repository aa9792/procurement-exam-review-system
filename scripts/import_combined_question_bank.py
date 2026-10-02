from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

from pypdf import PdfReader

from build_question_bank import GROUPS, SUBJECTS, build_schedule, split_choice_text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT = PROJECT_ROOT / "data" / "questions.js"
REPORT_OUTPUT = PROJECT_ROOT / "data" / "question-bank-update.json"
BANK_VERSION = "115-10-02"

PDF_SUBJECTS = {
    "工程及技術服務採購作業": "08",
    "財物及勞務採購作業": "07",
    "最有利標及評選優勝廠商": "10",
    "電子採購實務": "14",
    "錯誤採購態樣": "13",
    "投標須知及招標文件製作": "09",
    "採購契約": "06",
    "底價及價格分析": "11",
    "政府採購法之爭議處理": "05",
    "道德規範及違法處置": "12",
    "政府採購全生命週期概論": "01",
    "政府採購法之總則、招標及決標": "02",
    "政府採購法之履約管理及驗收": "03",
    "政府採購法之罰則及附則": "04",
}

SOURCE_COLUMN_SUBJECTS = {"02", "03", "04"}
SOURCE_ONLY_RE = re.compile(r"^(?:第\s*\d+(?:\s*之\s*\d+)?(?:\s*、\s*\d+)*\s*條|第\s*\d+(?:\s*之\s*\d+)?|條|綜合)$")
TRAILING_SOURCE_RE = re.compile(
    r"^(.*?[。？?）)])\s*(第\s*\d+(?:\s*之\s*\d+)?(?:\s*、\s*\d+)*\s*條|綜合)\s*$"
)


def clean_line(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def normalize_answer(value: str) -> str:
    return value.upper().replace("○", "O").replace("〇", "O").replace("×", "X")


def is_header_noise(line: str) -> bool:
    return not line or line in {
        "編",
        "號",
        "答",
        "案",
        "答案",
        "試題",
        "試題 依據法源",
        "依據法源",
        "選擇題",
        "是非題",
    }


def is_page_noise(line: str) -> bool:
    return is_header_noise(line) or bool(re.fullmatch(r"\d{1,4}", line))


def split_source(line: str, has_source_column: bool) -> tuple[str, list[str]]:
    if not has_source_column:
        return line, []
    if SOURCE_ONLY_RE.fullmatch(line):
        return "", [line]
    match = TRAILING_SOURCE_RE.match(line)
    if match:
        return match.group(1).strip(), [match.group(2)]
    return line, []


def normalize_source(parts: list[str]) -> str:
    if not parts:
        return ""
    combined = " ".join(parts)
    combined = re.sub(r"第\s*(\d+)\s*之\s*(\d+)\s*條", r"第\1條之\2", combined)
    combined = re.sub(r"第\s*(\d+)\s*條", r"第\1條", combined)
    combined = re.sub(r"第\s*(\d+)\s+條", r"第\1條", combined)
    combined = re.sub(r"\s+", "", combined)
    combined = combined.replace("條條", "條")
    found = []
    for value in re.findall(r"第\d+條(?:之\d+)?|綜合", combined):
        if value not in found:
            found.append(value)
    return "、".join(found) or combined


def parse_section(text: str, question_type: str, subject_id: str) -> list[dict]:
    answer_re = r"[1-4]" if question_type == "choice" else r"[OX○〇×]"
    lines = [clean_line(line) for line in text.splitlines()]
    questions: list[dict] = []
    current: dict | None = None
    expected = 1
    index = 0

    def finish() -> None:
        nonlocal current
        if not current:
            return
        current["text"] = " ".join(current.pop("parts")).strip()
        current["lawSource"] = normalize_source(current.pop("sourceParts"))
        questions.append(current)
        current = None

    while index < len(lines):
        line = lines[index]
        start = re.match(rf"^{expected}\s+({answer_re})(?:\s+(.*))?$", line, re.I)
        if not start and line == str(expected):
            probe = index + 1
            while probe < len(lines) and is_header_noise(lines[probe]):
                probe += 1
            if probe < len(lines):
                next_start = re.match(rf"^({answer_re})(?:\s+(.*))?$", lines[probe], re.I)
                if next_start:
                    start = next_start
                    index = probe

        if start:
            finish()
            body, source = split_source((start.group(2) or "").strip(), subject_id in SOURCE_COLUMN_SUBJECTS)
            current = {
                "number": expected,
                "answer": normalize_answer(start.group(1)),
                "parts": [body] if body else [],
                "sourceParts": source,
            }
            expected += 1
        elif is_page_noise(line):
            index += 1
            continue
        elif current:
            body, source = split_source(line, subject_id in SOURCE_COLUMN_SUBJECTS)
            if body:
                current["parts"].append(body)
            current["sourceParts"].extend(source)
        index += 1

    finish()
    return questions


def compact(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = re.sub(r"第\s*\d+(?:\s*之\s*\d+)?\s*條", "", text)
    return re.sub(r"\s+", "", text).removesuffix("綜合")


def fingerprint(question: dict) -> str:
    content = "|".join(
        [
            question["subjectId"],
            question["type"],
            question["answer"],
            compact(question["stem"]),
            *(compact(option) for option in question.get("options") or []),
        ]
    )
    return hashlib.sha1(content.encode("utf-8")).hexdigest()[:16]


def load_existing() -> dict:
    if not OUTPUT.exists():
        return {"questions": []}
    payload = OUTPUT.read_text(encoding="utf-8").strip()
    payload = re.sub(r"^window\.EXAM_DATA\s*=\s*", "", payload)
    payload = re.sub(r";\s*$", "", payload)
    return json.loads(payload)


def add_migration_metadata(questions: list[dict], previous: dict) -> dict:
    old_questions = previous.get("questions", [])
    old_by_key: dict[tuple[str, str, str], list[dict]] = {}
    for question in old_questions:
        key = (question["subjectId"], question["type"], compact(question.get("stem") or question.get("raw")))
        old_by_key.setdefault(key, []).append(question)

    matched_old: set[str] = set()
    unmatched_new = []
    moved = []
    answer_changes = []
    for question in questions:
        key = (question["subjectId"], question["type"], compact(question["stem"]))
        candidates = [item for item in old_by_key.get(key, []) if item["id"] not in matched_old]
        if not candidates:
            unmatched_new.append(question)
            continue
        old = candidates[0]
        matched_old.add(old["id"])
        if old["id"] != question["id"]:
            question["previousId"] = old["id"]
            moved.append({"from": old["id"], "to": question["id"]})
        if old.get("answer") != question.get("answer"):
            question["contentUpdated"] = True
            answer_changes.append(
                {"from": old["id"], "to": question["id"], "oldAnswer": old.get("answer"), "newAnswer": question.get("answer")}
            )

    old_remaining = [question for question in old_questions if question["id"] not in matched_old]
    semantic_updates = []
    for question in unmatched_new:
        candidates = [
            old
            for old in old_remaining
            if old["subjectId"] == question["subjectId"] and old["type"] == question["type"]
        ]
        if not candidates:
            question["contentUpdated"] = True
            continue
        best = max(
            candidates,
            key=lambda old: difflib.SequenceMatcher(None, compact(old.get("stem")), compact(question["stem"])).ratio(),
        )
        score = difflib.SequenceMatcher(None, compact(best.get("stem")), compact(question["stem"])).ratio()
        if score >= 0.72:
            matched_old.add(best["id"])
            old_remaining.remove(best)
            question["previousId"] = best["id"]
            question["contentUpdated"] = True
            semantic_updates.append(
                {
                    "from": best["id"],
                    "to": question["id"],
                    "oldAnswer": best.get("answer"),
                    "newAnswer": question.get("answer"),
                    "similarity": round(score, 3),
                }
            )
            if best.get("answer") != question.get("answer"):
                answer_changes.append(
                    {"from": best["id"], "to": question["id"], "oldAnswer": best.get("answer"), "newAnswer": question.get("answer")}
                )
        else:
            question["contentUpdated"] = True

    added = [question["id"] for question in questions if question["id"] not in matched_old and not question.get("previousId")]
    removed = [question["id"] for question in old_questions if question["id"] not in matched_old]
    return {
        "previousBankVersion": previous.get("bankVersion") or previous.get("generatedAt"),
        "bankVersion": BANK_VERSION,
        "questionCountBefore": len(old_questions),
        "questionCountAfter": len(questions),
        "moved": moved,
        "semanticUpdates": semantic_updates,
        "answerChanges": answer_changes,
        "added": added,
        "removed": removed,
    }


def extract_questions(pdf_path: Path) -> tuple[list[dict], dict[str, dict]]:
    reader = PdfReader(str(pdf_path))
    full_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    headings = []
    for pdf_title, subject_id in PDF_SUBJECTS.items():
        match = re.search(rf"(?m)^\s*{re.escape(pdf_title)}\s*$", full_text)
        if not match:
            raise ValueError(f"找不到考科標題：{pdf_title}")
        headings.append((match.start(), match.end(), pdf_title, subject_id))
    headings.sort()

    questions = []
    stats = {}
    for heading_index, (_, heading_end, pdf_title, subject_id) in enumerate(headings):
        block_end = headings[heading_index + 1][0] if heading_index + 1 < len(headings) else len(full_text)
        block = full_text[heading_end:block_end]
        markers = list(re.finditer(r"(?m)^\s*(選擇題|是非題)\s*$", block))
        if len(markers) != 2:
            raise ValueError(f"{pdf_title} 題型區段數異常：{len(markers)}")

        parsed_subject = []
        for marker_index, marker in enumerate(markers):
            question_type = "choice" if marker.group(1) == "選擇題" else "tf"
            section_end = markers[marker_index + 1].start() if marker_index + 1 < len(markers) else len(block)
            section = block[marker.end():section_end]
            for item in parse_section(section, question_type, subject_id):
                stem, options = split_choice_text(item["text"]) if question_type == "choice" else (item["text"], None)
                if question_type == "choice" and not options:
                    raise ValueError(f"{pdf_title} 選擇題第 {item['number']} 題無法解析選項")
                metadata = dict(SUBJECTS[subject_id])
                display_title = pdf_title if subject_id == "07" else metadata["title"]
                question = {
                    "id": f"{subject_id}-{question_type}-{item['number']:04d}",
                    "subjectId": subject_id,
                    "group": metadata["group"],
                    "subject": display_title,
                    "type": question_type,
                    "number": item["number"],
                    "answer": item["answer"],
                    "stem": stem,
                    "options": options,
                    "raw": item["text"],
                    "lawSource": item["lawSource"],
                    "source": f"{pdf_path.name}（資料產生日期 115/10/02）",
                    "bankVersion": BANK_VERSION,
                }
                question["fingerprint"] = fingerprint(question)
                parsed_subject.append(question)

        questions.extend(parsed_subject)
        metadata = dict(SUBJECTS[subject_id])
        if subject_id == "07":
            metadata["title"] = pdf_title
        stats[subject_id] = {
            "id": subject_id,
            **metadata,
            "choice": sum(item["type"] == "choice" for item in parsed_subject),
            "tf": sum(item["type"] == "tf" for item in parsed_subject),
            "total": len(parsed_subject),
            "source": f"{pdf_path.name}（資料產生日期 115/10/02）",
        }

    questions.sort(key=lambda item: (item["subjectId"], item["type"], item["number"]))
    return questions, stats


def main() -> None:
    parser = argparse.ArgumentParser(description="匯入採購證照合併題庫 PDF")
    parser.add_argument("pdf", type=Path, help="全部題庫 PDF 路徑")
    args = parser.parse_args()
    pdf_path = args.pdf.resolve()
    previous = load_existing()
    questions, stats = extract_questions(pdf_path)
    report = add_migration_metadata(questions, previous)

    payload = {
        "generatedAt": date.today().isoformat(),
        "bankVersion": BANK_VERSION,
        "sourceUpdatedAt": "2026-10-02",
        "exam": previous.get("exam", {}),
        "firstAttempt": {
            "law": {"score": 82, "total": 115},
            "practice": {"score": 84, "total": 120},
            "other": {"score": 62, "total": 95},
            "score": 228,
            "total": 330,
            "passingScore": 231,
        },
        "subjects": [stats[key] for key in sorted(stats)],
        "questions": questions,
        "schedule": build_schedule(stats),
        "warnings": [],
        "updateSummary": report,
    }
    OUTPUT.write_text("window.EXAM_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    REPORT_OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {OUTPUT}")
    print(f"Questions: {len(questions)}")
    for subject in payload["subjects"]:
        print(f"{subject['id']} {subject['title']}: choice={subject['choice']} tf={subject['tf']} total={subject['total']}")
    print(
        "Changes:",
        f"moved={len(report['moved'])}",
        f"updated={len(report['semanticUpdates'])}",
        f"answer={len(report['answerChanges'])}",
        f"added={len(report['added'])}",
        f"removed={len(report['removed'])}",
    )


if __name__ == "__main__":
    main()
