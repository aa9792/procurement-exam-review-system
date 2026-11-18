const test = require("node:test");
const assert = require("node:assert/strict");

const reader = require("../src/compendium-reader.js");

test("extracts electronic book printed page labels", () => {
  assert.deepEqual(reader.extractPrintedPages("條文\n總44 總45"), [44, 45]);
  assert.equal(reader.formatPrintedPages("條文\n總44 總45"), "總44–總45");
  assert.equal(reader.formatPrintedPages("封面"), "前置頁或附錄頁");
});

test("keeps chapter order aligned with the compilation", () => {
  assert.deepEqual(reader.BOOK_SECTIONS.map((item) => item.page), [11, 63, 575, 621]);
  assert.equal(reader.BOOK_CHAPTERS[0].title, "政府採購法及其施行細則之條文對照");
  assert.equal(reader.BOOK_CHAPTERS.at(-1).page, 681);
  assert.ok(reader.BOOK_CHAPTERS.every((item, index, all) => !index || item.page >= all[index - 1].page));
});

test("marks dates, money and ratios without changing text", () => {
  const source = "中華民國114年5月14日，期限30日，金額150萬元，比例百分之八十。";
  const segments = reader.annotateText(source);
  assert.equal(segments.map((segment) => segment.text).join(""), source);
  assert.ok(segments.some((segment) => segment.type === "date" && segment.text.includes("30日")));
  assert.ok(segments.some((segment) => segment.type === "money" && segment.text.includes("150萬元")));
  assert.ok(segments.some((segment) => segment.type === "ratio" && segment.text.includes("百分之八十")));
});

test("search results stay in electronic book page order", () => {
  const pages = [
    { page: 12, title: "第二頁", text: "押標金規定" },
    { page: 11, title: "押標金", text: "第一頁" },
    { page: 13, title: "其他", text: "無關" },
  ];
  const results = reader.searchPages(pages, "押標金");
  assert.deepEqual(results.map((item) => item.page.page), [11, 12]);
});

test("finds Chinese legal amounts when the user types digits", () => {
  const pages = [{ page: 77, title: "公告金額", text: "公告金額為新臺幣一百五十萬元。" }];
  assert.equal(reader.searchPages(pages, "150萬元")[0].page.page, 77);
  assert.equal(reader.searchPages(pages, "一百五十萬元")[0].page.page, 77);
});

test("removes footer page labels from readable text", () => {
  assert.equal(reader.cleanPageText("第一條 內容\n總5 總6"), "第一條 內容");
});
