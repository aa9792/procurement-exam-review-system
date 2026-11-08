#!/usr/bin/env python3
"""Build a browser-searchable page index from the procurement law compendium PDF."""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader


DEFAULT_SOURCE = Path(__file__).resolve().parents[2] / "《政府採購法令彙編35版》250514電子書版 (1).pdf"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "compendium.js"


def clean_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    lines = []
    for line in text.replace("\r", "\n").splitlines():
        line = re.sub(r"[\t\u00a0 ]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def page_title(text: str, page_number: int) -> str:
    for line in text.splitlines():
        candidate = line.strip()
        if not candidate or len(candidate) > 72:
            continue
        if re.fullmatch(r"(?:總|附|目)?\d+", candidate):
            continue
        return candidate
    return f"彙編第 {page_number} 頁"


def extract_page_batch(source: str, page_indexes: list[int], worker_number: int) -> list[dict]:
    reader = PdfReader(source, strict=False)
    pages = []
    for position, page_index in enumerate(page_indexes, start=1):
        page_number = page_index + 1
        try:
            text = clean_text(reader.pages[page_index].extract_text() or "")
        except Exception as error:  # Keep the remaining searchable pages if one page is malformed.
            print(f"Worker {worker_number}: page {page_number} failed: {error}", flush=True)
            text = ""
        pages.append({"page": page_number, "title": page_title(text, page_number), "text": text})
        if position % 25 == 0 or position == len(page_indexes):
            print(f"Worker {worker_number}: {position}/{len(page_indexes)} pages", flush=True)
    return pages


def build_index(source: Path, start_page: int, workers: int) -> dict:
    total = len(PdfReader(str(source), strict=False).pages)
    page_indexes = list(range(start_page - 1, total))
    batches = [page_indexes[offset::workers] for offset in range(workers)]
    pages = []
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(extract_page_batch, str(source), batch, number)
            for number, batch in enumerate(batches, start=1)
            if batch
        ]
        for future in as_completed(futures):
            pages.extend(future.result())
    pages.sort(key=lambda page: page["page"])
    return {
        "meta": {
            "title": "政府採購法令彙編第35版",
            "sourceDate": "2025-05-14",
            "pageCount": total,
            "indexedPageCount": len(pages),
        },
        "pages": pages,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--start-page", type=int, default=11)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    data = build_index(args.source.resolve(), max(1, args.start_page), max(1, args.workers))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    args.output.write_text(f"window.COMPENDIUM_DATA = {payload};\n", encoding="utf-8")
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)", flush=True)


if __name__ == "__main__":
    main()
