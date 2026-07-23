(function exposeGameRules(root) {
  const rules = {
    CLEAR_RATE: 80,
    BOSS_LIVES: 3,
    comboMultiplier(combo) {
      if (combo >= 10) return 2;
      if (combo >= 5) return 1.5;
      if (combo >= 3) return 1.25;
      return 1;
    },
    passed(rate, answered, total) {
      return total > 0 && answered === total && rate >= 80;
    },
    levelForXp(xp) {
      return Math.floor(Math.max(0, Number(xp) || 0) / 100) + 1;
    },
  };
  root.GAME_RULES = rules;
  if (typeof module !== "undefined" && module.exports) module.exports = rules;
})(typeof window !== "undefined" ? window : globalThis);
