const assert = require("node:assert/strict");
const rules = require("../src/game-rules.js");

assert.equal(rules.passed(80, 10, 10), true, "80% 且全數作答應通關");
assert.equal(rules.passed(79, 10, 10), false, "79% 不得通關");
assert.equal(rules.passed(100, 9, 10), false, "未完成全部題目不得通關");
assert.equal(rules.comboMultiplier(2), 1);
assert.equal(rules.comboMultiplier(3), 1.25);
assert.equal(rules.comboMultiplier(5), 1.5);
assert.equal(rules.comboMultiplier(10), 2);
assert.equal(rules.comboMultiplier(99), 2, "Combo 加成最高 2 倍");
assert.equal(rules.levelForXp(0), 1);
assert.equal(rules.levelForXp(100), 2);

console.log("Game rule tests passed.");
