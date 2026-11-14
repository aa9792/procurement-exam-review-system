(function (global) {
  "use strict";

  const CORE_KEYWORDS = [
    "押標金",
    "履約保證金",
    "保固保證金",
    "分批辦理",
    "限制性招標",
    "選擇性招標",
    "公開招標",
    "最有利標",
    "標價偏低",
    "底價",
    "同等品",
    "廠商資格",
    "共同投標",
    "統包",
    "不合格標",
    "投標文件",
    "轉包",
    "分包",
    "減價收受",
    "部分驗收",
    "異議",
    "申訴",
    "履約爭議",
    "調解",
    "仲裁",
    "停權",
    "刊登政府採購公報",
    "政黨",
    "利益衝突",
    "監辦",
    "評選委員會",
    "電子投標",
    "等標期",
    "公告金額",
    "查核金額",
  ];

  function articleFromReference(reference) {
    const text = `${reference?.key || ""} ${reference?.label || ""}`;
    return text.match(/第?\s*(\d+(?:\s*之\s*\d+)?)\s*條/)?.[1]?.replace(/\s+/g, "") || "";
  }

  function referenceLevel(reference) {
    const text = `${reference?.key || ""} ${reference?.label || ""}`;
    if (reference?.key === "no-exact-reference") return "unknown";
    if (/政府採購法施行細則/.test(text)) return "enforcement";
    if (/政府採購法/.test(text)) return "act";
    return "subordinate";
  }

  function locationLabel(reference) {
    const article = articleFromReference(reference);
    const level = referenceLevel(reference);
    if (level === "act") return `【母法】政府採購法${article ? `第 ${article} 條` : ""}`;
    if (level === "enforcement") return `【施行細則】${article ? `第 ${article} 條` : "條文"}`;
    if (level === "subordinate") return `【子法】${reference?.label || "法規名稱待核對"}`;
    return "【待核對】題庫未標示可可靠定位的法規條號";
  }

  function actChapter(article) {
    const number = Number(String(article || "").match(/^\d+/)?.[0]);
    if (!number) return "政府採購法條文";
    if (number <= 17) return "第一章 總則";
    if (number <= 44) return "第二章 招標";
    if (number <= 62) return "第三章 決標";
    if (number <= 70) return "第四章 履約管理";
    if (number <= 73) return "第五章 驗收";
    if (number <= 86) return "第六章 爭議處理";
    if (number <= 92) return "第七章 罰則";
    return "第八章 附則";
  }

  function lookupRoute(reference) {
    const article = articleFromReference(reference);
    const level = referenceLevel(reference);
    if (level === "act") return `彙編「政府採購法」→ ${actChapter(article)} → 第 ${article} 條`;
    if (level === "enforcement") return `彙編後段「政府採購法施行細則」→ 第 ${article || "對應"} 條`;
    if (level === "subordinate") return `彙編子法目錄 →「${reference?.label || "法規全名"}」`;
    return "先以題幹關鍵字查彙編目錄，再核對題庫來源；不要憑系統猜測條號。";
  }

  function extractKeywords(question, references) {
    const correctOption = question?.type === "choice" ? question.options?.[Number(question.answer) - 1] || "" : "";
    const focusText = `${question?.stem || question?.raw || ""} ${correctOption} ${question?.lawSource || ""}`;
    const fullText = `${focusText} ${(question?.options || []).join(" ")}`;
    const focusMatches = CORE_KEYWORDS.filter((keyword) => focusText.includes(keyword));
    const otherMatches = CORE_KEYWORDS.filter((keyword) => fullText.includes(keyword) && !focusMatches.includes(keyword));
    const focusNumbers = focusText.match(/\d+\s*(?:日|天|個月|年|%|％|萬元|億元)/g) || [];
    const otherNumbers = fullText.match(/\d+\s*(?:日|天|個月|年|%|％|萬元|億元)/g) || [];
    const prioritize = (items) => [...new Set(items)].sort((left, right) => right.length - left.length);
    const unique = [...prioritize([...focusMatches, ...focusNumbers]), ...prioritize([...otherMatches, ...otherNumbers])];
    if (unique.length) return [...new Set(unique)].slice(0, 2);
    const reference = (references || []).find((item) => referenceLevel(item) !== "unknown");
    const fallback = reference?.summary?.match(/[\u4e00-\u9fff]{2,8}/)?.[0];
    return [fallback || question?.subject || "題幹核心名詞"].slice(0, 2);
  }

  function statementDiff(wrong, correct) {
    const left = String(wrong || "").trim();
    const right = String(correct || "").trim();
    let start = 0;
    while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
    let leftEnd = left.length;
    let rightEnd = right.length;
    while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
      leftEnd -= 1;
      rightEnd -= 1;
    }
    return {
      wrongPart: left.slice(start, leftEnd).trim(),
      correctPart: right.slice(start, rightEnd).trim(),
    };
  }

  function riskyTokens(text) {
    const value = String(text || "");
    const tokens = value.match(/(?:不得|應|得|逾|未逾|以上|以下|一律|均|僅限|\d+\s*(?:日|天|個月|年|%|％|萬元|億元))/g) || [];
    return [...new Set(tokens)].slice(0, 3);
  }

  function focusedDifference(wrongPart, correctPart) {
    const wrong = String(wrongPart || "").trim();
    const correct = String(correctPart || "").trim();
    if (wrong.length <= 12 && correct.length <= 20) return { wrong, correct };
    const wrongTokens = riskyTokens(wrong);
    const correctTokens = riskyTokens(correct);
    const changedWrong = wrongTokens.find((token) => !correctTokens.includes(token)) || wrongTokens[0] || wrong;
    let changedCorrect = correctTokens.find((token) => !wrongTokens.includes(token)) || "";
    if (!changedCorrect && changedWrong === "不得" && correctTokens.includes("得")) changedCorrect = "得";
    if (!changedCorrect && changedWrong === "應" && correctTokens.includes("得")) changedCorrect = "得";
    return { wrong: changedWrong, correct: changedCorrect || correct };
  }

  function trapItems(question, explanation) {
    if (question?.type === "tf") {
      if (question.answer === "X" && explanation?.wrongPart && explanation?.correctPart) {
        const focused = focusedDifference(explanation.wrongPart, explanation.correctPart);
        return [{
          label: "原題錯誤字眼",
          text: question.stem || question.raw || "",
          emphasis: [focused.wrong],
          note: `關鍵差異應理解為「${focused.correct}」；完整正確句請以上方正確敘述為準。`,
        }];
      }
      if (question.answer === "X") {
        const text = question.stem || question.raw || "";
        return [{
          label: "高風險字眼",
          text,
          emphasis: riskyTokens(text),
          note: "題庫沒有足夠的逐字正確對照；請優先核對標示字眼、期限與金額，不以猜測改寫法條。",
        }];
      }
      return [{
        label: "本題為正確敘述",
        text: question.stem || question.raw || "",
        emphasis: riskyTokens(question.stem || question.raw || ""),
        note: "沒有錯誤選項；標示處是最容易被改成陷阱的字眼。",
      }];
    }

    const asksWrong = !!explanation?.intent?.asksWrong;
    const answerIndex = Number(question.answer) - 1;
    const indexes = asksWrong
      ? [answerIndex]
      : (question.options || []).map((_, index) => index).filter((index) => index !== answerIndex);
    return indexes.slice(0, 4).map((index) => {
      const text = question.options?.[index] || "";
      const correctionQuestion = explanation?.options?.[index]?.correction?.question;
      const correctText = correctionQuestion?.stem || correctionQuestion?.raw || "";
      const diff = correctText ? statementDiff(text, correctText) : null;
      const focused = diff ? focusedDifference(diff.wrongPart, diff.correctPart) : null;
      const hasDiff = !!(focused?.wrong && focused?.correct && focused.wrong.length <= 24);
      return {
        label: `選項（${index + 1}）${asksWrong ? "為本題要找的錯誤／例外" : "不是答案"}`,
        text,
        emphasis: hasDiff ? [focused.wrong] : riskyTokens(text),
        note: hasDiff
          ? `與正確對照題相比，關鍵差異應為「${focused.correct}」。`
          : "先核對標示的法律效果、絕對用語、期限或金額；若無標示，代表題庫不足以安全推定被篡改的單一字詞。",
      };
    });
  }

  function examOrder(references, optionSources) {
    const validOptions = (optionSources || []).filter((item) => item.references?.some((ref) => referenceLevel(ref) !== "unknown"));
    const distinctKeys = new Set(validOptions.flatMap((item) => item.references.map((ref) => ref.key)));
    if (distinctKeys.size > 1) {
      const ranked = validOptions
        .flatMap((item) => item.references.map((reference) => ({ option: item.option, reference })))
        .sort((left, right) => {
          const score = (item) => {
            const article = Number(articleFromReference(item.reference).match(/^\d+/)?.[0] || 999);
            return ({ act: 0, enforcement: 1, subordinate: 2, unknown: 9 })[referenceLevel(item.reference)] +
              (articleFromReference(item.reference) ? article / 1000 : 3);
          };
          return score(left) - score(right);
        });
      const first = ranked[0];
      return {
        crossLaw: true,
        text: `先查選項（${first.option}）的${locationLabel(first.reference)}。它有明確條號且位於彙編較前段，最快確認；再用排除法處理其餘選項。`,
      };
    }
    const reference = (references || []).find((item) => referenceLevel(item) !== "unknown");
    return {
      crossLaw: false,
      text: reference
        ? `各選項主要圍繞同一法源，先查${locationLabel(reference)}，對照「主體、得／應／不得、期限或金額」即可，不必逐一翻不同法規。`
        : "本題沒有可靠條號可直接定位；先用關鍵字查目錄，再依題庫來源核對，避免在考場盲翻。",
    };
  }

  function build(question, explanation, references, optionSources) {
    const answerSources = question?.type === "choice"
      ? (optionSources || []).find((item) => String(item.option) === String(question.answer))?.references || []
      : [];
    const primary = answerSources.find((item) => referenceLevel(item) !== "unknown") ||
      (references || []).find((item) => referenceLevel(item) !== "unknown") || references?.[0];
    return {
      locations: (references || []).map((reference) => ({ reference, label: locationLabel(reference) })),
      keywords: extractKeywords(question, references),
      lookup: lookupRoute(primary),
      traps: trapItems(question, explanation),
      order: examOrder(references, optionSources),
    };
  }

  const api = { articleFromReference, referenceLevel, locationLabel, actChapter, lookupRoute, extractKeywords, trapItems, examOrder, build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.ProcurementExamStrategy = api;
})(typeof window !== "undefined" ? window : globalThis);
