const test = require("node:test");
const assert = require("node:assert/strict");

const mock = require("../src/mock-exam.js");

function syntheticBank() {
  const questions = [];
  mock.PAPERS.forEach((paper) => {
    paper.blueprint.forEach((item) => {
      ["tf", "choice"].forEach((type) => {
        for (let index = 0; index < Math.max(item[type] * 4, 12); index += 1) {
          questions.push({
            id: `${item.subjectId}-${type}-${index}`,
            subjectId: item.subjectId,
            type,
            answer: type === "tf" ? "O" : "1",
            stem: `公告金額與三十日期限核心題 ${index}`,
            options: type === "choice" ? ["正確", "錯誤"] : [],
          });
        }
      });
    });
  });
  return questions;
}

test("paper blueprints match the official counts and points", () => {
  assert.deepEqual(
    mock.PAPERS.map(({ id, tf, choice, total, points }) => ({ id, tf, choice, total, points })),
    [
      { id: "law", tf: 23, choice: 46, total: 69, points: 115 },
      { id: "practice", tf: 24, choice: 48, total: 72, points: 120 },
      { id: "other", tf: 19, choice: 38, total: 57, points: 95 },
    ],
  );
});

test("builds every paper with exact per-subject quotas", () => {
  const bank = syntheticBank();
  mock.PAPERS.forEach((paper) => {
    const questions = mock.buildPaper(bank, paper.id, 1);
    assert.deepEqual(mock.validatePaper(questions, paper.id), { valid: true, errors: [] });
  });
});

test("different forms rotate within the high-yield candidate window", () => {
  const bank = syntheticBank();
  const formA = mock.buildPaper(bank, "law", 1).map((question) => question.id);
  const formB = mock.buildPaper(bank, "law", 2).map((question) => question.id);
  assert.notDeepEqual(formA, formB);
});

test("scores true-false as one point and choice as two points", () => {
  const questions = [
    { id: "a", subjectId: "01", type: "tf", answer: "O" },
    { id: "b", subjectId: "01", type: "choice", answer: "2" },
  ];
  const score = mock.scorePaper(questions, { a: "O", b: "1" });
  assert.equal(score.totalPoints, 3);
  assert.equal(score.correctPoints, 1);
  assert.equal(score.correct, 1);
});

test("prior wrong questions receive a ranking bonus", () => {
  const ordinary = { id: "ordinary", stem: "一般敘述", options: [] };
  const priority = { id: "priority", stem: "一般敘述", options: [] };
  assert.ok(mock.likelihoodScore(priority, new Set(["priority"])) > mock.likelihoodScore(ordinary));
});
