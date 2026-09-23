(function (global) {
  "use strict";

  const STOP_CHARS = /[\s，。；：、（）()「」『』【】！？,.!?：;\-_/]/g;
  const NEGATIVE_WORDS = ["不得", "不應", "不可", "無須", "不適用", "非屬", "未達"];
  const ABSOLUTE_WORDS = ["一律", "全部", "任何", "僅", "均", "皆", "逕行", "立即", "當然", "絕對"];

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function compactText(value) {
    return cleanText(value).replace(STOP_CHARS, "");
  }

  function bigrams(value) {
    const text = compactText(value);
    const result = new Set();
    for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
    return result;
  }

  function diceSimilarity(left, right) {
    const a = bigrams(left);
    const b = bigrams(right);
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    a.forEach((gram) => {
      if (b.has(gram)) overlap += 1;
    });
    return (2 * overlap) / (a.size + b.size);
  }

  function sharedPrefixLength(left, right) {
    const max = Math.min(left.length, right.length);
    let index = 0;
    while (index < max && left[index] === right[index]) index += 1;
    return index;
  }

  function sharedSuffixLength(left, right, prefixLength) {
    const max = Math.min(left.length, right.length) - prefixLength;
    let index = 0;
    while (index < max && left[left.length - 1 - index] === right[right.length - 1 - index]) index += 1;
    return index;
  }

  function statementDiff(wrongText, correctText) {
    const wrong = cleanText(wrongText);
    const correct = cleanText(correctText);
    const prefixLength = sharedPrefixLength(wrong, correct);
    const suffixLength = sharedSuffixLength(wrong, correct, prefixLength);
    const wrongEnd = suffixLength ? wrong.length - suffixLength : wrong.length;
    const correctEnd = suffixLength ? correct.length - suffixLength : correct.length;
    return {
      wrongPart: wrong.slice(prefixLength, wrongEnd).trim() || "整句的判斷或適用條件",
      correctPart: correct.slice(prefixLength, correctEnd).trim() || "應依正確敘述判斷",
    };
  }

  function buildCorrectStatementIndex(questions) {
    const bySubject = new Map();
    questions.forEach((question) => {
      if (question.type !== "tf" || question.answer !== "O") return;
      if (!bySubject.has(question.subjectId)) bySubject.set(question.subjectId, []);
      bySubject.get(question.subjectId).push(question);
    });
    return bySubject;
  }

  function buildTrueFalseIndex(questions) {
    const bySubject = new Map();
    questions.forEach((question) => {
      if (question.type !== "tf") return;
      if (!bySubject.has(question.subjectId)) bySubject.set(question.subjectId, []);
      bySubject.get(question.subjectId).push({
        question,
        grams: bigrams(question.stem || question.raw),
      });
    });
    return bySubject;
  }

  function similarityFromGrams(a, b) {
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    a.forEach((gram) => {
      if (b.has(gram)) overlap += 1;
    });
    return (2 * overlap) / (a.size + b.size);
  }

  function findOptionEvidence(question, option, tfIndex) {
    const value = cleanText(option);
    if (compactText(value).length < 8) return null;
    const queryGrams = bigrams(value);
    let best = null;
    (tfIndex.get(question.subjectId) || []).forEach((candidate) => {
      const score = similarityFromGrams(queryGrams, candidate.grams);
      if (!best || score > best.score) best = { question: candidate.question, score };
    });
    return best && best.score >= 0.74 ? best : null;
  }

  function findCorrectCounterpart(question, correctIndex) {
    if (question.type !== "tf" || question.answer !== "X") return null;
    const candidates = correctIndex.get(question.subjectId) || [];
    let best = null;
    candidates.forEach((candidate) => {
      const score = diceSimilarity(question.stem || question.raw, candidate.stem || candidate.raw);
      if (!best || score > best.score) best = { question: candidate, score };
    });
    if (!best) return null;
    const nearby = Math.abs(Number(question.number) - Number(best.question.number)) <= 2;
    return best.score >= 0.62 || (nearby && best.score >= 0.5) ? best : null;
  }

  function detectTrap(text) {
    const value = cleanText(text);
    const negative = NEGATIVE_WORDS.find((word) => value.includes(word));
    if (negative) return `留意否定詞「${negative}」，它可能把原規定的方向說反。`;
    const absolute = ABSOLUTE_WORDS.find((word) => value.includes(word));
    if (absolute) return `留意絕對用語「${absolute}」，法規通常仍有條件、例外或裁量空間。`;
    if (/\d/.test(value)) return "本題含數字、期限或比例，錯誤通常出在數值或適用條件被替換。";
    if (/應|得|須|可/.test(value)) return "注意「應、得、須、可」的強制程度不同，不能互相替換。";
    return "請比較行為主體、適用條件、程序順序與法律效果，題幹至少有一項與正確規定不符。";
  }

  function choiceIntent(stem) {
    const text = compactText(stem);
    if (/不會.*違反|不違反|無違反/.test(text)) {
      return { label: "找不違法敘述", asksWrong: false, summary: "題目要找不會違反規定、可以成立的選項。" };
    }
    if (/不包含|不包括|非屬|何者非|何項非|何者不是|不是|為非|除外|不妥適/.test(text)) {
      return { label: "反向選擇", asksWrong: true, summary: "題目要找不符合規定或不屬於範圍的選項。" };
    }
    if (/錯誤|不正確|有誤|不適法|不合法|無效|不得|違反/.test(text)) {
      return { label: "找錯誤敘述", asksWrong: true, summary: "題目要找錯誤、不適法或不正確的敘述。" };
    }
    if (/正確|何者為是|適法|合法|有效|得為|應為|妥適/.test(text)) {
      return { label: "找正確敘述", asksWrong: false, summary: "題目要找最符合規定與題目條件的選項。" };
    }
    return { label: "一般選擇", asksWrong: false, summary: "依題幹限定的主體、條件與程序選出最符合者。" };
  }

  function explainChoice(question, tfIndex, correctIndex) {
    const intent = choiceIntent(question.stem || question.raw);
    const answerIndex = Number(question.answer) - 1;
    const correctOption = cleanText(question.options?.[answerIndex]);
    const options = (question.options || []).map((option, index) => {
      const number = String(index + 1);
      const evidence = findOptionEvidence(question, option, tfIndex);
      const correction = evidence?.question.answer === "X" ? findCorrectCounterpart(evidence.question, correctIndex) : null;
      if (number === String(question.answer)) {
        return {
          number,
          text: cleanText(option),
          status: intent.asksWrong ? "本題要找的不符合項" : "符合題意的正解",
          correct: true,
          evidence,
          correction,
        };
      }
      return {
        number,
        text: cleanText(option),
        status: intent.asksWrong ? "屬於題幹所述範圍，故不是答案" : "不符合本題限定條件，故不選",
        correct: false,
        evidence,
        correction,
      };
    });
    const answerEvidence = options[answerIndex]?.evidence;
    const evidenceSupportsAnswer =
      answerEvidence && answerEvidence.question.answer === (intent.asksWrong ? "X" : "O");
    const baseReason = intent.asksWrong
      ? `本題採反向問法，選項（${question.answer}）「${correctOption}」是不符合規定／不屬於題幹範圍的一項，因此要選它。`
      : `本題要找符合規定者，選項（${question.answer}）「${correctOption}」最符合題幹設定的主體、條件與程序，因此是答案。`;
    const reason = evidenceSupportsAnswer
      ? `${baseReason}同科題庫另有相近敘述並判為${answerEvidence.question.answer === "O" ? "正確" : "錯誤"}，可交叉確認這個判斷。`
      : baseReason;
    return { kind: "choice", intent, reason, options };
  }

  function explainTrueFalse(question, correctIndex) {
    const stem = cleanText(question.stem || question.raw);
    if (question.answer === "O") {
      return {
        kind: "tf",
        correct: true,
        reason: "本題敘述與題庫標準答案一致；主體、條件、程序與效果均成立。",
        correctedStatement: stem,
        trap: "請把這句視為正確基準，特別記住其中的主體、條件、程序順序與法律效果。",
        counterpart: null,
      };
    }
    const counterpart = findCorrectCounterpart(question, correctIndex);
    if (counterpart) {
      const correctedStatement = cleanText(counterpart.question.stem || counterpart.question.raw);
      const diff = statementDiff(stem, correctedStatement);
      return {
        kind: "tf",
        correct: false,
        reason: `原題的「${diff.wrongPart}」與題庫中的正確敘述不一致，應改為「${diff.correctPart}」。`,
        correctedStatement,
        wrongPart: diff.wrongPart,
        correctPart: diff.correctPart,
        trap: detectTrap(stem),
        counterpart,
      };
    }
    return {
      kind: "tf",
      correct: false,
      reason: `本題答案為 X，表示原句至少有一個關鍵敘述錯誤。${detectTrap(stem)}`,
      correctedStatement: "題庫未附官方改寫，系統也找不到足夠相似的正確對照題；此題不以猜測文字冒充正解。",
      trap: detectTrap(stem),
      counterpart: null,
    };
  }

  function createExplanationEngine(questions) {
    const correctIndex = buildCorrectStatementIndex(questions || []);
    const tfIndex = buildTrueFalseIndex(questions || []);
    return {
      explain(question) {
        return question.type === "choice"
          ? explainChoice(question, tfIndex, correctIndex)
          : explainTrueFalse(question, correctIndex);
      },
      findCorrectCounterpart(question) {
        return findCorrectCounterpart(question, correctIndex);
      },
    };
  }

  global.ProcurementExplanations = { createExplanationEngine, diceSimilarity, statementDiff };
})(typeof window !== "undefined" ? window : globalThis);
