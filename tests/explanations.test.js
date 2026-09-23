const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "data", "questions.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(root, "src", "explanations.js"), "utf8"), context);

const questions = context.window.EXAM_DATA.questions;
const engine = context.window.ProcurementExplanations.createExplanationEngine(questions);

function question(id) {
  return questions.find((item) => item.id === id);
}

test("recognizes reverse questions even when PDF extraction inserted spaces", () => {
  const result = engine.explain(question("01-choice-0007"));
  assert.equal(result.intent.asksWrong, true);
  assert.equal(result.intent.label, "反向選擇");
});

test("recognizes 'does not violate' as a positive-choice question", () => {
  const result = engine.explain(question("02-choice-0008"));
  assert.equal(result.intent.asksWrong, false);
  assert.equal(result.intent.label, "找不違法敘述");
});

test("pairs a false statement with a nearby correct statement", () => {
  const result = engine.explain(question("01-tf-0005"));
  assert.equal(result.correct, false);
  assert.match(result.reason, /僅適用於技術服務及工程/);
  assert.match(result.correctedStatement, /工程、財物及勞務採購/);
});

test("pinpoints the changed wording for a false statement", () => {
  const result = engine.explain(question("01-tf-0021"));
  assert.equal(result.wrongPart, "無");
  assert.equal(result.correctPart, "仍");
  assert.match(result.correctedStatement, /仍須依規定程序辦理當期/);
});

test("builds an explanation for every valid question without throwing", () => {
  questions.forEach((item) => {
    const result = engine.explain(item);
    assert.ok(result);
    assert.ok(["choice", "tf"].includes(result.kind));
  });
});
