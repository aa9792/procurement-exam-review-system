(function (global) {
  "use strict";

  const QUESTION_FILLERS = [
    "下列何者",
    "以下何者",
    "何者正確",
    "何者錯誤",
    "何者有誤",
    "何者不正確",
    "關於",
    "依規定",
    "之敘述",
    "的敘述",
  ];

  function questionText(question) {
    const correctOption =
      question?.type === "choice" ? question.options?.[Number(question.answer) - 1] || "" : "";
    return `${question?.stem || question?.raw || ""} ${correctOption} ${question?.lawSource || ""}`;
  }

  function normalizeStudyText(value) {
    let text = String(value || "").toLowerCase();
    QUESTION_FILLERS.forEach((filler) => {
      text = text.replaceAll(filler, "");
    });
    return text.replace(/[^\p{Script=Han}a-z0-9%]+/gu, "").slice(0, 360);
  }

  function bigrams(value) {
    const text = normalizeStudyText(value);
    const grams = new Set();
    for (let index = 0; index < text.length - 1; index += 1) grams.add(text.slice(index, index + 2));
    if (!grams.size && text) grams.add(text);
    return grams;
  }

  function diceSimilarity(left, right) {
    const a = left instanceof Set ? left : bigrams(left);
    const b = right instanceof Set ? right : bigrams(right);
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    a.forEach((gram) => {
      if (b.has(gram)) overlap += 1;
    });
    return (2 * overlap) / (a.size + b.size);
  }

  function defaultReferenceKeys(question) {
    const text = questionText(question);
    const keys = [];
    for (const match of text.matchAll(/((?:政府採購法施行細則|政府採購法|採購法)?)第\s*(\d+)(?:\s*(?:條\s*之|之|-)\s*(\d+))?\s*條?/g)) {
      const law = match[1].includes("細則") ? "細則" : "採購法";
      const article = match[3] ? `${match[2]}之${match[3]}` : match[2];
      keys.push(`${law}-${article}`);
    }
    return [...new Set(keys)];
  }

  function similarityScore(anchor, candidate, options = {}) {
    if (!anchor || !candidate || anchor.id === candidate.id) return -Infinity;
    const getReferenceKeys = options.getReferenceKeys || defaultReferenceKeys;
    const anchorRefs = new Set(getReferenceKeys(anchor).filter(Boolean));
    const candidateRefs = new Set(getReferenceKeys(candidate).filter(Boolean));
    let sharedReferences = 0;
    anchorRefs.forEach((key) => {
      if (candidateRefs.has(key)) sharedReferences += 1;
    });

    let score = diceSimilarity(questionText(anchor), questionText(candidate));
    if (anchor.subjectId === candidate.subjectId) score += 0.55;
    else if (anchor.group === candidate.group) score += 0.08;
    if (anchor.type === candidate.type) score += 0.04;
    score += Math.min(sharedReferences, 2) * 1.2;
    return score;
  }

  function rankSimilarQuestions(anchor, pool, options = {}) {
    const count = Math.max(1, Number(options.count || 20));
    const includeAnchor = options.includeAnchor !== false;
    const candidates = (pool || []).filter((question) => question && question.id !== anchor?.id);
    const ranked = candidates
      .map((question) => ({ question, score: similarityScore(anchor, question, options) }))
      .sort((left, right) => right.score - left.score || String(left.question.id).localeCompare(String(right.question.id)))
      .map((item) => item.question);
    return [...(includeAnchor && anchor ? [anchor] : []), ...ranked].slice(0, count);
  }

  const api = {
    normalizeStudyText,
    diceSimilarity,
    defaultReferenceKeys,
    similarityScore,
    rankSimilarQuestions,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.ProcurementSimilarity = api;
})(typeof window !== "undefined" ? window : globalThis);
