(function initMockExam(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ProcurementMockExam = api;
})(typeof window !== "undefined" ? window : globalThis, function createMockExam() {
  const PAPERS = [
    {
      id: "law",
      title: "法規課程模擬卷",
      shortTitle: "法規",
      duration: 80,
      points: 115,
      blueprint: [
        { subjectId: "01", tf: 2, choice: 4 },
        { subjectId: "02", tf: 14, choice: 28 },
        { subjectId: "03", tf: 2, choice: 4 },
        { subjectId: "04", tf: 5, choice: 10 },
      ],
    },
    {
      id: "practice",
      title: "實務課程模擬卷",
      shortTitle: "實務",
      duration: 80,
      points: 120,
      blueprint: [
        { subjectId: "08", tf: 6, choice: 12 },
        { subjectId: "07", tf: 6, choice: 12 },
        { subjectId: "10", tf: 6, choice: 12 },
        { subjectId: "14", tf: 6, choice: 12 },
      ],
    },
    {
      id: "other",
      title: "其他課程模擬卷",
      shortTitle: "其他",
      duration: 80,
      points: 95,
      blueprint: [
        { subjectId: "13", tf: 2, choice: 4 },
        { subjectId: "09", tf: 4, choice: 8 },
        { subjectId: "06", tf: 4, choice: 8 },
        { subjectId: "11", tf: 3, choice: 6 },
        { subjectId: "05", tf: 4, choice: 8 },
        { subjectId: "12", tf: 2, choice: 4 },
      ],
    },
  ].map((paper) => ({
    ...paper,
    tf: paper.blueprint.reduce((sum, item) => sum + item.tf, 0),
    choice: paper.blueprint.reduce((sum, item) => sum + item.choice, 0),
    total: paper.blueprint.reduce((sum, item) => sum + item.tf + item.choice, 0),
  }));

  const HIGH_YIELD_PATTERNS = [
    /公告金額|查核金額|巨額|小額採購|採購金額/,
    /等標期|期限|日內|個月內|三十日|十日|二十日|五日/,
    /押標金|保證金|追繳|不予發還/,
    /公開招標|選擇性招標|限制性招標|未達公告金額/,
    /底價|超底價|標價偏低|減價|比減價格/,
    /最有利標|評選委員會|優勝廠商|協商|議價/,
    /驗收|初驗|複驗|減價收受|契約變更|轉包|分包/,
    /異議|申訴|調解|仲裁|拒絕往來|停權/,
    /電子領標|電子投標|電子採購|共同供應契約/,
    /利益衝突|迴避|保密|請託關說|倫理/,
    /同等品|限制競爭|廠商資格|投標文件/,
  ];

  function paperById(paperId) {
    return PAPERS.find((paper) => paper.id === paperId) || null;
  }

  function questionText(question) {
    return `${question.stem || ""} ${question.raw || ""} ${(question.options || []).join(" ")} ${question.lawSource || ""}`;
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function likelihoodScore(question, priorityIds = new Set()) {
    const text = questionText(question);
    let score = 0;
    score += HIGH_YIELD_PATTERNS.reduce((sum, pattern) => sum + (pattern.test(text) ? 4 : 0), 0);
    if (/[零〇一二三四五六七八九十百千萬億\d]+\s*(?:日|天|月|年|元|%|百分之)/.test(text)) score += 6;
    if (/應|得|不得|免|除外|以上|以下|未滿|逾/.test(text)) score += 4;
    if (/何者(?:錯誤|不正確|非|不是)|下列.*不/.test(text)) score += 3;
    if (/第\s*[零〇一二三四五六七八九十百千\d]+\s*條/.test(text) || question.lawSource) score += 5;
    if (text.length >= 30 && text.length <= 520) score += 2;
    if (priorityIds.has(question.id)) score += 10;
    return score;
  }

  function rankedPool(questions, subjectId, type, variant, priorityIds) {
    return questions
      .filter((question) => question.subjectId === subjectId && question.type === type)
      .map((question) => ({
        question,
        score: likelihoodScore(question, priorityIds),
        tie: stableHash(`${question.id}|${variant}`),
      }))
      .sort((left, right) => right.score - left.score || left.tie - right.tie);
  }

  function chooseFromPool(pool, count, variant) {
    if (pool.length < count) throw new Error(`題庫不足：需要 ${count} 題，目前只有 ${pool.length} 題。`);
    const windowSize = Math.min(pool.length, Math.max(count, count * 3));
    const candidates = pool.slice(0, windowSize);
    const offset = ((Math.max(1, variant) - 1) * count) % windowSize;
    const picked = [];
    for (let index = 0; picked.length < count; index += 1) {
      picked.push(candidates[(offset + index) % windowSize].question);
    }
    return picked;
  }

  function buildPaper(questions, paperId, variant = 1, priorityIds = new Set()) {
    const paper = paperById(paperId);
    if (!paper) throw new Error(`未知模擬卷：${paperId}`);
    const selected = [];
    paper.blueprint.forEach((item) => {
      selected.push(...chooseFromPool(rankedPool(questions, item.subjectId, "tf", variant, priorityIds), item.tf, variant));
      selected.push(...chooseFromPool(rankedPool(questions, item.subjectId, "choice", variant, priorityIds), item.choice, variant));
    });
    return selected;
  }

  function validatePaper(questions, paperId) {
    const paper = paperById(paperId);
    if (!paper) return { valid: false, errors: ["找不到試卷藍圖。"] };
    const errors = [];
    paper.blueprint.forEach((item) => {
      ["tf", "choice"].forEach((type) => {
        const expected = item[type];
        const actual = questions.filter((question) => question.subjectId === item.subjectId && question.type === type).length;
        if (actual !== expected) errors.push(`${item.subjectId} ${type}：應有 ${expected} 題，實際 ${actual} 題。`);
      });
    });
    if (questions.length !== paper.total) errors.push(`總題數應為 ${paper.total} 題，實際 ${questions.length} 題。`);
    return { valid: !errors.length, errors };
  }

  function scorePaper(questions, answers) {
    return questions.reduce((summary, question) => {
      const points = question.type === "choice" ? 2 : 1;
      const correct = answers[question.id] === question.answer;
      summary.totalPoints += points;
      summary.correctPoints += correct ? points : 0;
      summary.correct += correct ? 1 : 0;
      summary.bySubject[question.subjectId] ||= { total: 0, correct: 0, points: 0, earned: 0 };
      const subject = summary.bySubject[question.subjectId];
      subject.total += 1;
      subject.correct += correct ? 1 : 0;
      subject.points += points;
      subject.earned += correct ? points : 0;
      return summary;
    }, { totalPoints: 0, correctPoints: 0, correct: 0, bySubject: {} });
  }

  return { PAPERS, buildPaper, likelihoodScore, paperById, scorePaper, validatePaper };
});
