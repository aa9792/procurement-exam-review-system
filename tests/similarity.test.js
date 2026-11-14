const test = require("node:test");
const assert = require("node:assert/strict");
const similarity = require("../src/similarity.js");

function question(id, subjectId, group, stem, lawSource = "", type = "tf") {
  return { id, subjectId, group, subject: `科目 ${subjectId}`, stem, lawSource, type, answer: "O" };
}

test("ranks questions sharing a law article before unrelated questions", () => {
  const anchor = question("a", "02", "法規課程", "限制性招標的適用條件", "政府採購法第22條");
  const sameArticle = question("b", "02", "法規課程", "限制性招標得採用的情形", "政府採購法第22條");
  const sameSubject = question("c", "02", "法規課程", "公開招標的公告程序", "政府採購法第19條");
  const unrelated = question("d", "11", "其他課程", "底價分析方法", "政府採購法第46條");
  const ranked = similarity.rankSimilarQuestions(anchor, [unrelated, sameSubject, sameArticle], { includeAnchor: false });
  assert.equal(ranked[0].id, "b");
});

test("keeps the anchor first and respects the requested group size", () => {
  const anchor = question("a", "03", "法規課程", "驗收不符的處理", "政府採購法第72條");
  const pool = [anchor, ...Array.from({ length: 30 }, (_, index) => question(`q${index}`, "03", "法規課程", `驗收題 ${index}`))];
  const ranked = similarity.rankSimilarQuestions(anchor, pool, { count: 20 });
  assert.equal(ranked.length, 20);
  assert.equal(ranked[0].id, "a");
  assert.equal(new Set(ranked.map((item) => item.id)).size, 20);
});

test("normalizes filler wording before comparing question text", () => {
  const left = "下列何者關於最有利標之敘述正確？";
  const right = "最有利標之評選規定";
  assert.ok(similarity.diceSimilarity(left, right) > 0.45);
});
