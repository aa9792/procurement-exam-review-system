const test = require("node:test");
const assert = require("node:assert/strict");
const strategy = require("../src/exam-strategy.js");

test("formats mother act, enforcement rules and subordinate regulations", () => {
  assert.equal(strategy.locationLabel({ key: "政府採購法-22", label: "政府採購法第 22 條" }), "【母法】政府採購法第 22 條");
  assert.equal(strategy.locationLabel({ key: "政府採購法施行細則-44", label: "政府採購法施行細則第 44 條" }), "【施行細則】第 44 條");
  assert.equal(strategy.locationLabel({ key: "最有利標評選辦法-6", label: "最有利標評選辦法第 6 條" }), "【子法】最有利標評選辦法第 6 條");
});

test("maps procurement act articles to the correct compendium chapter", () => {
  assert.equal(strategy.actChapter("22"), "第二章 招標");
  assert.equal(strategy.actChapter("56"), "第三章 決標");
  assert.equal(strategy.actChapter("72"), "第五章 驗收");
  assert.equal(strategy.actChapter("85之1"), "第六章 爭議處理");
});

test("extracts one or two high-value lookup keywords", () => {
  const keywords = strategy.extractKeywords({ stem: "機關不得意圖規避本法而分批辦理，並應注意公告金額。", options: [] }, []);
  assert.deepEqual(keywords, ["分批辦理", "公告金額"]);
});

test("prioritizes keywords from the correct option over distractors", () => {
  const keywords = strategy.extractKeywords({
    type: "choice",
    answer: "4",
    stem: "查核金額以上採購何者無須核准？",
    options: ["最有利標", "減價收受", "底價", "統包"],
  }, []);
  assert.deepEqual(keywords, ["查核金額", "統包"]);
});

test("prioritizes an explicit mother-act option in a cross-law question", () => {
  const refs = [{ key: "政府採購法-30", label: "政府採購法第 30 條" }];
  const options = [
    { option: 1, references: [{ key: "某子法-all", label: "某子法" }] },
    { option: 2, references: refs },
  ];
  const result = strategy.examOrder(refs, options);
  assert.equal(result.crossLaw, true);
  assert.match(result.text, /選項（2）/);
});

test("checks the earlier mother-act article first when levels are equal", () => {
  const result = strategy.examOrder([], [
    { option: 1, references: [{ key: "政府採購法-56", label: "政府採購法第 56 條" }] },
    { option: 4, references: [{ key: "政府採購法-24", label: "政府採購法第 24 條" }] },
  ]);
  assert.match(result.text, /選項（4）/);
});

test("marks the exact changed phrase when a true-false correction exists", () => {
  const question = { type: "tf", answer: "X", stem: "機關應辦理公告。" };
  const items = strategy.trapItems(question, { wrongPart: "應", correctPart: "得" });
  assert.deepEqual(items[0].emphasis, ["應"]);
  assert.match(items[0].note, /得/);
});

test("reduces a long PDF diff to the changed modal word", () => {
  const question = { type: "tf", answer: "X", stem: "機關不得於招標文件中規定，機關得審核。" };
  const items = strategy.trapItems(question, {
    wrongPart: "不得於招標文件中規定，廠商提出文件後機關得審核",
    correctPart: "得視個案需要於招標文件中規定，廠商提出文件後機關得審核",
  });
  assert.deepEqual(items[0].emphasis, ["不得"]);
  assert.match(items[0].note, /「得」/);
});

test("does not call an unknown reference a shared source", () => {
  const unknown = [{ key: "no-exact-reference", label: "未標示" }];
  const result = strategy.examOrder(unknown, []);
  assert.match(result.text, /沒有可靠條號/);
});

test("builds the four strategy fields for every question without throwing", () => {
  global.window = {};
  require("../data/questions.js");
  const unknown = [{ key: "no-exact-reference", label: "未標示", summary: "" }];
  window.EXAM_DATA.questions.forEach((question) => {
    const result = strategy.build(question, null, unknown, []);
    assert.equal(result.locations.length, 1);
    assert.ok(result.keywords.length >= 1);
    assert.ok(result.traps.length >= 1);
    assert.ok(result.order.text);
  });
  delete global.window;
});
