const DATA = window.EXAM_DATA;
const QUESTIONS = DATA.questions;
const SUBJECTS = DATA.subjects;
const STORAGE_KEY = "procurement-exam-progress-v1";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDFwKoHKw7iq2-tTzV9rx0fapYksunX6Wk",
  authDomain: "procurement-certification.firebaseapp.com",
  databaseURL: "https://procurement-certification-default-rtdb.firebaseio.com",
  projectId: "procurement-certification",
  storageBucket: "procurement-certification.firebasestorage.app",
  messagingSenderId: "1066257908472",
  appId: "1:1066257908472:web:fae8136650546007a4f10d",
};
const TF_EXPLANATION_OVERRIDES = {
  "01-tf-0002": {
    topic: "工程採購契約範本的物價調整機制",
    wrong: "「招標文件並納入總指數漲跌幅調整契約價金之內容即符合主管機關之工程採購契約範本」",
    fix: "應改為：招標文件採用工程採購契約範本時，物價調整應納入個別項目、中分類項目及總指數等三層級機制，以反映物價變動。",
    why: "前半段「招標時檢核設計預算是否符合市場行情並作必要調整」是正確觀念；錯在後半段把物價調整簡化成只看總指數。講義在招標決標階段寫的是採用工程採購契約範本，應納入個別項目、中分類項目及總指數辦理物價調整，不是只放總指數漲跌幅就算符合。",
    review: "複習時記成：物調不是單一總指數，而是三層級物調。看到「只要、即符合、免、僅」這類絕對化字眼要特別小心。",
  },
};

const REVIEW_RULES = [
  {
    match: /物價調整|總指數|工程採購契約範本|市場行情|設計預算/,
    topic: "物價調整與招標前預算檢核",
    explain: "工程採購在招標前要檢核預算是否仍符合市場行情；採工程採購契約範本時，物價調整重點是個別項目、中分類項目及總指數等三層級機制。若題幹說只用總指數、免檢核市場行情、或要求廠商放棄物調，通常就是錯誤方向。",
  },
  {
    match: /全生命週期|工程、財物及勞務|技術服務及工程/,
    topic: "政府採購全生命週期適用範圍",
    explain: "政府採購全生命週期概念可適用於工程、財物及勞務採購，不限於工程或技術服務。題幹若出現「僅適用」或排除財物、勞務，通常是把適用範圍縮得太窄。",
  },
  {
    match: /規劃設計階段|預算範圍|工法可行性|工期合理性|可先不考量預算/,
    topic: "規劃設計階段檢核",
    explain: "規劃設計階段要檢查工程定位、預算範圍、工法可行性及工期合理性。若題幹說可先不考量預算，會讓後續招標、履約產生風險，因此是錯誤敘述。",
  },
  {
    match: /多次流標|量體|拆標|限制性招標|專業工項/,
    topic: "多次流標後的採購策略",
    explain: "多次流標時可以檢討量體、專業工項、預算、工期與契約條件，必要時可合理拆標；但不能因為拆成專業工項，就當然改用限制性招標。招標方式仍要回到採購法的適用條件。",
  },
  {
    match: /風險管理|營運維護|計畫階段|履約驗收階段/,
    topic: "全生命週期風險管理階段",
    explain: "全生命週期風險管理包含計畫、規劃設計、招標決標、履約驗收與營運維護。若題幹排除營運維護階段，表示生命週期被截斷，因此為錯。",
  },
  {
    match: /異議|申訴|調解|招標|審標|決標|履約|驗收|保固/,
    topic: "爭議處理分流",
    explain: "招標、審標、決標階段的爭議走異議、申訴；履約、驗收、保固爭議多走調解、仲裁或訴訟。先判斷爭議發生在哪個階段，才能選對救濟途徑。",
  },
  {
    match: /底價|比減價|標價偏低|不訂底價|評審委員會/,
    topic: "底價與價格分析",
    explain: "底價重點在訂定時點、核定權責、保密與減價比減價程序；標價偏低則要看總標價或部分標價是否低於規定比例，以及是否需通知廠商說明或成立評審機制。",
  },
  {
    match: /最有利標|評選|優勝廠商|協商|固定費用|費率/,
    topic: "最有利標與評選",
    explain: "最有利標題目要先分辨採第56條最有利標、準用最有利標、參考最有利標精神，並注意評選委員會、評選項目、協商與議價程序是否符合規定。",
  },
  {
    match: /契約|分包|轉包|違約金|契約變更|履約期限/,
    topic: "採購契約與履約責任",
    explain: "契約題要看契約是否成立、生效日、文件效力、契約變更是否經程序處理，以及分包和轉包的差異。轉包原則禁止；分包不免除得標廠商對機關的履約責任。",
  },
  {
    match: /電子|電子領標|電子投標|電子報價|電子押標金|採購網/,
    topic: "電子採購實務",
    explain: "電子採購題要掌握電子領標、電子投標、電子報價與電子押標金的法律效果。電子化資料通常視同正式文件，但撤回、更正、補正仍要依招標文件及系統規定辦理。",
  },
];

let progress = loadProgress();
let session = [];
let sessionIndex = 0;
let selectedAnswer = null;
let answeredIds = new Set();
let sessionResults = [];
const tfCorrectionCache = new Map();
let firebaseAuth = null;
let firebaseDb = null;
let currentUser = null;
let cloudReady = false;
let cloudSyncTimer = null;
let isCloudLoading = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  scheduleCloudSave();
}

function normalizeHistory(history) {
  if (!history) return [];
  const list = Array.isArray(history) ? history : Object.values(history);
  return list.filter(Boolean).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

function normalizeProgressItem(item) {
  const history = normalizeHistory(item.history);
  if (history.length) {
    return {
      attempts: history.length,
      correct: history.filter((entry) => entry.correct).length,
      wrong: history.filter((entry) => !entry.correct).length,
      history,
      mastered: !!item.mastered,
      lastAnswer: item.lastAnswer || history.at(-1)?.answer,
      lastAt: item.lastAt || history.at(-1)?.at,
    };
  }
  return {
    attempts: Number(item.attempts || 0),
    correct: Number(item.correct || 0),
    wrong: Number(item.wrong || 0),
    history: [],
    mastered: !!item.mastered,
    lastAnswer: item.lastAnswer || "",
    lastAt: item.lastAt || "",
  };
}

function mergeProgress(localProgress, cloudProgress) {
  const merged = {};
  const ids = new Set([...Object.keys(localProgress || {}), ...Object.keys(cloudProgress || {})]);
  ids.forEach((id) => {
    const localItem = localProgress?.[id] ? normalizeProgressItem(localProgress[id]) : null;
    const cloudItem = cloudProgress?.[id] ? normalizeProgressItem(cloudProgress[id]) : null;
    if (!localItem) {
      merged[id] = cloudItem;
      return;
    }
    if (!cloudItem) {
      merged[id] = localItem;
      return;
    }
    const combinedHistory = [...normalizeHistory(localItem.history), ...normalizeHistory(cloudItem.history)];
    const unique = new Map();
    combinedHistory.forEach((entry) => {
      const key = `${entry.at || ""}-${entry.answer || ""}-${entry.correct ? "1" : "0"}`;
      unique.set(key, entry);
    });
    const history = Array.from(unique.values()).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    if (history.length) {
      merged[id] = {
        attempts: history.length,
        correct: history.filter((entry) => entry.correct).length,
        wrong: history.filter((entry) => !entry.correct).length,
        history,
        mastered: localItem.mastered || cloudItem.mastered,
        lastAnswer: history.at(-1)?.answer || localItem.lastAnswer || cloudItem.lastAnswer,
        lastAt: history.at(-1)?.at || localItem.lastAt || cloudItem.lastAt,
      };
      return;
    }
    merged[id] = String(localItem.lastAt || "") >= String(cloudItem.lastAt || "") ? localItem : cloudItem;
  });
  return merged;
}

function updateSyncStatus(message) {
  const el = $("#syncStatus");
  if (el) el.textContent = message;
}

function userPath() {
  return currentUser ? `procurementExamUsers/${currentUser.uid}` : "";
}

function scheduleCloudSave() {
  if (!currentUser || !cloudReady || !firebaseDb || isCloudLoading) return;
  clearTimeout(cloudSyncTimer);
  updateSyncStatus("已登入，準備同步...");
  cloudSyncTimer = setTimeout(pushProgressToCloud, 900);
}

async function pushProgressToCloud() {
  if (!currentUser || !cloudReady || !firebaseDb) return;
  try {
    updateSyncStatus("同步中...");
    await firebaseDb.ref(userPath()).set({
      progress,
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      appVersion: "firebase-rtdb-v1",
    });
    updateSyncStatus(`已同步：${currentUser.displayName || currentUser.email || "已登入"}`);
  } catch (error) {
    updateSyncStatus(`同步失敗：${error.message}`);
  }
}

async function loadProgressFromCloud(user) {
  if (!firebaseDb) return;
  isCloudLoading = true;
  try {
    updateSyncStatus("讀取雲端進度...");
    const snapshot = await firebaseDb.ref(`procurementExamUsers/${user.uid}/progress`).once("value");
    const cloudProgress = snapshot.val() || {};
    progress = mergeProgress(progress, cloudProgress);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    cloudReady = true;
    isCloudLoading = false;
    renderAll();
    await pushProgressToCloud();
  } catch (error) {
    isCloudLoading = false;
    cloudReady = false;
    updateSyncStatus(`雲端讀取失敗：${error.message}`);
  }
}

function initFirebaseSync() {
  if (!window.firebase) {
    updateSyncStatus("Firebase 載入失敗，使用本機紀錄");
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    firebaseDb = firebase.database();
    firebaseAuth.onAuthStateChanged((user) => {
      currentUser = user;
      cloudReady = false;
      clearTimeout(cloudSyncTimer);
      if (user) {
        $("#loginBtn")?.classList.add("hidden");
        $("#logoutBtn")?.classList.remove("hidden");
        loadProgressFromCloud(user);
      } else {
        $("#loginBtn")?.classList.remove("hidden");
        $("#logoutBtn")?.classList.add("hidden");
        updateSyncStatus("未登入，使用本機紀錄");
      }
    });
  } catch (error) {
    updateSyncStatus(`Firebase 初始化失敗：${error.message}`);
  }
}

async function loginWithGoogle() {
  if (!firebaseAuth) return updateSyncStatus("Firebase 尚未初始化");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await firebaseAuth.signInWithPopup(provider);
  } catch (error) {
    updateSyncStatus(`登入失敗：${error.message}`);
  }
}

async function logout() {
  if (!firebaseAuth) return;
  await firebaseAuth.signOut();
}

function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseISO(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a, b) {
  const ms = parseISO(b) - parseISO(a);
  return Math.ceil(ms / 86400000);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getQuestion(id) {
  return QUESTIONS.find((q) => q.id === id);
}

function isWrong(id) {
  const item = progress[id];
  return item && item.wrong > 0 && !item.mastered;
}

function statsForQuestion(id) {
  return progress[id] || { attempts: 0, correct: 0, wrong: 0 };
}

function progressSummary() {
  const attempted = Object.keys(progress).filter((id) => progress[id].attempts > 0).length;
  const wrong = Object.keys(progress).filter(isWrong).length;
  const correct = Object.values(progress).reduce((sum, item) => sum + (item.correct || 0), 0);
  const attempts = Object.values(progress).reduce((sum, item) => sum + (item.attempts || 0), 0);
  return {
    attempted,
    wrong,
    attempts,
    correct,
    coverage: QUESTIONS.length ? Math.round((attempted / QUESTIONS.length) * 100) : 0,
    accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
  };
}

function recordAnswer(question, answer) {
  const id = question.id;
  const correct = answer === question.answer;
  const item = progress[id] || {
    attempts: 0,
    correct: 0,
    wrong: 0,
    history: [],
    mastered: false,
  };
  item.attempts += 1;
  item.lastAnswer = answer;
  item.lastAt = new Date().toISOString();
  item.history = item.history || [];
  item.history.push({ answer, correct, at: item.lastAt });
  if (correct) {
    item.correct += 1;
  } else {
    item.wrong += 1;
    item.mastered = false;
  }
  progress[id] = item;
  saveProgress();
  return correct;
}

function markMastered(id) {
  if (!progress[id]) return;
  progress[id].mastered = true;
  saveProgress();
  renderAll();
}

function questionTypeName(type) {
  return type === "choice" ? "選擇題" : "是非題";
}

function answerText(question) {
  if (question.type === "tf") return question.answer === "O" ? "O（題目敘述正確）" : "X（題目敘述錯誤）";
  const idx = Number(question.answer) - 1;
  const option = question.options?.[idx] || "";
  return `(${question.answer}) ${option}`;
}

function extractKeywords(question) {
  const text = `${question.stem} ${question.raw}`;
  const patterns = ["申訴", "異議", "調解", "底價", "押標金", "保證金", "公告金額", "查核金額", "最有利標", "評選", "履約", "驗收", "契約", "電子", "停權", "刊登", "分包", "轉包", "期限", "決標", "招標"];
  const found = patterns.filter((kw) => text.includes(kw));
  const numbers = text.match(/\d+\s*(日|天|個月|年|%|％|萬元|億元)/g) || [];
  return [...new Set([...found, ...numbers])].slice(0, 6);
}

function choiceIntent(question) {
  const stem = question.stem || question.raw || "";
  if (/不包含|不包括|非屬|何者非|何者不是|非為|除外/.test(stem)) {
    return {
      type: "exclude",
      label: "找出不屬於題目所列範圍的選項",
      why: "題目用的是排除式問法，所以答案要選「不在規定範圍內」的那一項。",
    };
  }
  if (/錯誤|不正確|有誤|不適法|不合法|無效|不得/.test(stem)) {
    return {
      type: "false",
      label: "找出錯誤或不適法的敘述",
      why: "題目是在問錯誤選項，因此標準答案代表該敘述和法規、程序或題庫基準不一致。",
    };
  }
  if (/正確|何者為是|適法|合法|有效|得為|應為/.test(stem)) {
    return {
      type: "true",
      label: "找出正確或最適法的敘述",
      why: "題目是在問正確選項，因此標準答案代表該敘述最符合規定或題意。",
    };
  }
  return {
    type: "best",
    label: "找出最符合題意的選項",
    why: "題目沒有明顯的正反問法，需依關鍵字、程序階段與選項內容判斷最符合題意者。",
  };
}

function optionList(question) {
  return (question.options || []).map((option, index) => ({
    number: String(index + 1),
    text: option,
    label: `(${index + 1}) ${option}`,
  }));
}

function chapterHint(question) {
  const chart = window.CHAPTER_CHARTS?.[question.subjectId];
  if (!chart) return "";
  const text = `${question.stem} ${question.raw}`;
  const hit = chart.memory.find((item) => text.includes(item.replace(/[/%]/g, "")) || text.includes(item));
  if (hit) return `本題可放在「${hit}」這個記憶點下複習。`;
  return `可回到「${chart.flowTitle}」檢查這題所在的程序位置。`;
}

function specificChoiceReason(question) {
  if (
    question.subjectId === "01" &&
    question.stem.includes("共同性費用編列基準") &&
    question.stem.includes("專案研析後得計列")
  ) {
    return "依共同性費用編列基準，專案研析後得計列的項目包含「綠建築、挑高空間、智慧建築」；「基地一般性整理」不是這一類專案研析後加列項目。題目問「不包含」，所以答案是 (1)。";
  }
  return "";
}

function relatedQuestionHint(question, anchorText) {
  const candidates = QUESTIONS.filter(
    (item) => item.id !== question.id && item.subjectId === question.subjectId
  )
    .map((item) => ({ item, score: similarity(anchorText, `${item.stem} ${item.raw}`) }))
    .filter((entry) => entry.score >= 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (!candidates.length) return "";
  return `延伸對照：同科第 ${candidates.map((entry) => `${entry.item.number} 題`).join("、第 ")} 也有相近概念，可用來交叉複習。`;
}

function reviewRule(question) {
  const text = `${question.stem} ${question.raw}`;
  return REVIEW_RULES.find((rule) => rule.match.test(text));
}

function choiceExplanation(question) {
  const intent = choiceIntent(question);
  const options = optionList(question);
  const correct = options.find((option) => option.number === question.answer);
  const others = options.filter((option) => option.number !== question.answer);
  const specific = specificChoiceReason(question);
  const contrast =
    intent.type === "exclude"
      ? `其餘選項 ${others.map((option) => `(${option.number})`).join("、")} 在本題語境下屬於題目所問的範圍；${correct.label} 才是不包含的項目。`
      : intent.type === "false"
        ? `其餘選項 ${others.map((option) => `(${option.number})`).join("、")} 在本題語境下較符合規定；${correct.label} 才是題目要找的錯誤敘述。`
        : intent.type === "true"
          ? `${correct.label} 是最符合規定或題意的敘述；其餘選項在本題語境下有不完整、不適用或程序效果錯置的問題。`
          : `${correct.label} 最符合題幹條件；其餘選項不是本題要找的最佳答案。`;
  const basis = specific || `${intent.why}${contrast}`;
  const keywords = extractKeywords(question);
  const keywordText = keywords.length ? `判斷時抓這些字：${keywords.join("、")}。` : chapterHint(question);
  const related = relatedQuestionHint(question, `${question.stem} ${correct?.text || ""}`);
  return [
    `題目問法：${intent.label}。`,
    `正確選項：${correct?.label || answerText(question)}`,
    `為什麼：${basis}`,
    keywordText,
    related,
  ]
    .filter(Boolean)
    .join("\n");
}

function compactText(value) {
  return String(value || "").replace(/[\s，。；：、（）()「」『』,.!?！？;:]/g, "");
}

function bigrams(value) {
  const text = compactText(value);
  if (text.length <= 1) return text ? [text] : [];
  const grams = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.push(text.slice(i, i + 2));
  }
  return grams;
}

function similarity(a, b) {
  const aSet = new Set(bigrams(a));
  const bSet = new Set(bigrams(b));
  if (!aSet.size || !bSet.size) return 0;
  let overlap = 0;
  aSet.forEach((item) => {
    if (bSet.has(item)) overlap += 1;
  });
  return overlap / (aSet.size + bSet.size - overlap);
}

function changedParts(wrongText, correctText) {
  let start = 0;
  const wrong = wrongText.trim();
  const correct = correctText.trim();
  while (start < wrong.length && start < correct.length && wrong[start] === correct[start]) {
    start += 1;
  }
  let wrongEnd = wrong.length - 1;
  let correctEnd = correct.length - 1;
  while (
    wrongEnd >= start &&
    correctEnd >= start &&
    wrong[wrongEnd] === correct[correctEnd]
  ) {
    wrongEnd -= 1;
    correctEnd -= 1;
  }
  return {
    wrong: wrong.slice(start, wrongEnd + 1).trim(),
    correct: correct.slice(start, correctEnd + 1).trim(),
  };
}

function findTrueFalseCorrection(question) {
  if (question.type !== "tf") return null;
  if (tfCorrectionCache.has(question.id)) return tfCorrectionCache.get(question.id);
  if (TF_EXPLANATION_OVERRIDES[question.id]) {
    const detail = TF_EXPLANATION_OVERRIDES[question.id];
    const result = {
      kind: question.answer === "O" ? "true" : "false",
      text: [
        `考點：${detail.topic}。`,
        `原題錯誤處：${detail.wrong}`,
        detail.fix,
        `為什麼：${detail.why}`,
        detail.review,
      ].join("\n"),
    };
    tfCorrectionCache.set(question.id, result);
    return result;
  }
  if (question.answer === "O") {
    const rule = reviewRule(question);
    const result = {
      kind: "true",
      text: [
        rule ? `考點：${rule.topic}。` : "考點：題幹所述程序或法律效果。",
        "原題敘述本身就是正確版本，不需要改寫。",
        rule ? `為什麼：${rule.explain}` : "為什麼：題幹的主詞、程序、期限、金額或法律效果與題庫標準答案一致，所以判定為 O。",
        "複習提醒：若你選 X，通常是把相近程序、例外情形或絕對化用語誤判了。",
      ].join("\n"),
    };
    tfCorrectionCache.set(question.id, result);
    return result;
  }

  const candidates = QUESTIONS.filter(
    (item) => item.type === "tf" && item.subjectId === question.subjectId && item.answer === "O"
  )
    .map((item) => {
      const sim = similarity(question.stem, item.stem);
      const distance = Math.abs(question.number - item.number);
      const distanceBonus = distance <= 4 ? 0.2 - distance * 0.035 : 0;
      return { item, sim, score: sim + Math.max(distanceBonus, 0), distance };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || (best.sim < 0.34 && !(best.distance <= 2 && best.sim >= 0.22))) {
    const rule = reviewRule(question);
    const fallback = {
      kind: "false",
      text: [
        rule ? `考點：${rule.topic}。` : "考點：題幹中的關鍵程序、範圍或法律效果。",
        "原題錯誤處：題幹至少有一個關鍵敘述與規定不一致，通常會藏在「僅、即、免、不得、應、得」或期限/金額/機關/程序效果中。",
        rule ? `為什麼：${rule.explain}` : "為什麼：題庫標準答案為 X，代表不能照題幹文字直接記；作答時要把題幹拆成主詞、階段、條件、效果四段檢查。",
        `如何修正：請把題幹中的絕對化或範圍錯置文字改回本科「${question.subject}」的正確程序與法律效果。${chapterHint(question)}`,
      ].join("\n"),
    };
    tfCorrectionCache.set(question.id, fallback);
    return fallback;
  }

  const parts = changedParts(question.stem, best.item.stem);
  const wrongPart = parts.wrong || question.stem;
  const correctPart = parts.correct || best.item.stem;
  const rule = reviewRule(question);
  const result = {
    kind: "false",
    text: [
      rule ? `考點：${rule.topic}。` : "考點：同科相近敘述比對。",
      `原題錯誤處：「${wrongPart}」。`,
      `正確應改為：「${correctPart}」。`,
      rule ? `為什麼：${rule.explain}` : "為什麼：同科有相近的 O 題可作為正確版本，兩題差異處就是本題被改錯的地方。",
      `可對照同科是非題第 ${best.item.number} 題的正確敘述。`,
    ].join("\n"),
    matchedQuestion: best.item,
  };
  tfCorrectionCache.set(question.id, result);
  return result;
}

function explanation(question, chosen) {
  const correct = answerText(question);
  const correctSentence = /[。！？.!?]$/.test(correct) ? correct : `${correct}。`;
  const keywords = extractKeywords(question);
  const chosenText = chosen ? (question.type === "choice" ? `(${chosen})` : chosen) : "未作答";
  const resultText = chosen ? (chosen === question.answer ? "答對" : "答錯") : "未作答";
  const focus = keywords.length ? `本題判斷點：${keywords.join("、")}。` : "本題重點在題幹敘述與標準答案的差異。";
  const source = `來源：${question.source}，${question.subject}第 ${question.number} 題。`;
  if (question.type === "choice") {
    return `作答結果：${resultText}。你選 ${chosenText}，題庫標準答案是 ${correctSentence}\n${choiceExplanation(question)}\n${source}`;
  }
  const correction = findTrueFalseCorrection(question);
  return `作答結果：${resultText}。你選 ${chosenText}，題庫標準答案是 ${correct}。\n${focus}\n${correction.text}\n${source}`;
}

function filteredQuestions() {
  const subject = $("#subjectSelect").value;
  const type = $("#typeSelect").value;
  return QUESTIONS.filter((q) => {
    const subjectOK =
      subject === "all" ||
      q.subjectId === subject ||
      q.group === subject.replace("group:", "");
    const typeOK = type === "all" || q.type === type;
    return subjectOK && typeOK;
  });
}

function weakSubjectIds() {
  return SUBJECTS.map((subject) => {
    const qs = QUESTIONS.filter((q) => q.subjectId === subject.id);
    const attempted = qs.filter((q) => progress[q.id]?.attempts).length;
    const wrong = qs.filter((q) => isWrong(q.id)).length;
    const coverage = attempted / Math.max(qs.length, 1);
    return { id: subject.id, score: coverage - wrong / Math.max(qs.length, 1) };
  })
    .sort((a, b) => a.score - b.score)
    .map((s) => s.id);
}

function pickQuestions() {
  const mode = $("#modeSelect").value;
  let pool = filteredQuestions();
  if (mode === "wrong") {
    pool = pool.filter((q) => isWrong(q.id));
  }
  if (mode === "unseen") {
    const unseen = shuffle(pool.filter((q) => !progress[q.id]?.attempts));
    const seen = shuffle(pool.filter((q) => progress[q.id]?.attempts));
    pool = [...unseen, ...seen];
  } else if (mode === "weak") {
    const weak = weakSubjectIds();
    pool = shuffle(pool).sort((a, b) => weak.indexOf(a.subjectId) - weak.indexOf(b.subjectId));
  } else {
    pool = shuffle(pool);
  }

  if (mode === "wrong" && pool.length < 20) {
    const fillers = shuffle(filteredQuestions().filter((q) => !pool.includes(q) && !progress[q.id]?.attempts));
    pool = [...pool, ...fillers];
  }
  return pool.slice(0, 20);
}

function startQuiz(overrides = {}) {
  if (overrides.mode) $("#modeSelect").value = overrides.mode;
  if (overrides.subject) $("#subjectSelect").value = overrides.subject;
  session = pickQuestions();
  sessionIndex = 0;
  selectedAnswer = null;
  answeredIds = new Set();
  sessionResults = [];
  $("#quizIntro").classList.add("hidden");
  $("#quizArea").classList.remove("hidden");
  switchTab("quiz");
  renderQuiz();
}

function renderQuiz() {
  const area = $("#quizArea");
  if (!session.length) {
    area.innerHTML = `<div class="empty-state"><h2>沒有可出的題目</h2><p>請換科目、題型或模式再試一次。</p></div>`;
    return;
  }
  if (sessionIndex >= session.length) {
    const correct = sessionResults.filter((r) => r.correct).length;
    area.innerHTML = `
      <div class="empty-state">
        <h2>本回完成</h2>
        <p>答對 ${correct} / ${session.length} 題，正確率 ${Math.round((correct / session.length) * 100)}%。</p>
        <div class="today-actions">
          <button class="primary" id="againBtn">再產生 20 題</button>
          <button id="reviewWrongBtn">查看錯題</button>
        </div>
      </div>`;
    $("#againBtn").addEventListener("click", () => startQuiz());
    $("#reviewWrongBtn").addEventListener("click", () => switchTab("wrongs"));
    renderAll();
    return;
  }

  const question = session[sessionIndex];
  const alreadyAnswered = answeredIds.has(question.id);
  const currentResult = sessionResults.find((r) => r.id === question.id);
  const choices =
    question.type === "choice"
      ? question.options.map((option, idx) => ({ value: String(idx + 1), label: `(${idx + 1}) ${option}` }))
      : [
          { value: "O", label: "O 正確" },
          { value: "X", label: "X 錯誤" },
        ];

  area.innerHTML = `
    <div class="quiz-top">
      <div>
        <strong>第 ${sessionIndex + 1} / ${session.length} 題</strong>
        <div class="question-meta">
          <span class="mini-tag">${escapeHTML(question.group)}</span>
          <span class="mini-tag">${escapeHTML(question.subject)}</span>
          <span class="mini-tag">${questionTypeName(question.type)}</span>
        </div>
      </div>
      <span class="muted">已練 ${statsForQuestion(question.id).attempts} 次</span>
    </div>
    <p class="question-stem">${escapeHTML(question.stem || question.raw)}</p>
    <div class="options"></div>
    <div id="answerBox" class="${alreadyAnswered ? "answer-box" : "hidden"}"></div>
    <div class="quiz-nav">
      <button id="prevBtn">上一題</button>
      <div class="today-actions">
        <button id="submitBtn" class="primary">${alreadyAnswered ? "已作答" : "送出答案"}</button>
        <button id="nextBtn">${sessionIndex === session.length - 1 ? "看結果" : "下一題"}</button>
      </div>
    </div>`;

  const options = area.querySelector(".options");
  choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.dataset.value = choice.value;
    btn.textContent = choice.label;
    if (choice.value === selectedAnswer) btn.classList.add("is-selected");
    if (alreadyAnswered) {
      btn.disabled = true;
      if (choice.value === question.answer) btn.classList.add("is-correct");
      if (choice.value === currentResult?.answer && !currentResult.correct) btn.classList.add("is-wrong");
    }
    btn.addEventListener("click", () => {
      selectedAnswer = choice.value;
      renderQuiz();
    });
    options.appendChild(btn);
  });

  if (alreadyAnswered && currentResult) {
    $("#answerBox").textContent = explanation(question, currentResult.answer);
  }
  $("#prevBtn").disabled = sessionIndex === 0;
  $("#prevBtn").addEventListener("click", () => {
    sessionIndex -= 1;
    selectedAnswer = null;
    renderQuiz();
  });
  $("#nextBtn").addEventListener("click", () => {
    sessionIndex += 1;
    selectedAnswer = null;
    renderQuiz();
  });
  $("#submitBtn").disabled = alreadyAnswered || !selectedAnswer;
  $("#submitBtn").addEventListener("click", () => {
    const correct = recordAnswer(question, selectedAnswer);
    answeredIds.add(question.id);
    sessionResults.push({ id: question.id, answer: selectedAnswer, correct });
    renderHeader();
    renderGroups();
    renderSubjectProgress();
    renderQuiz();
  });
}

function switchTab(tab) {
  $$(".tab").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tab === tab));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === tab));
  if (tab === "wrongs") renderWrongs();
  if (tab === "bank") renderBank();
}

function renderHeader() {
  const today = todayISO();
  const days = Math.max(daysBetween(today, DATA.exam.date), 0);
  const summary = progressSummary();
  $("#daysLeft").textContent = days;
  $("#coverageRate").textContent = `${summary.coverage}%`;
  $("#coverageDetail").textContent = `${summary.attempted} / ${QUESTIONS.length} 題`;
  $("#wrongCount").textContent = summary.wrong;
  $("#generatedAt").textContent = `題庫建立日期：${DATA.generatedAt}`;

  const todayPlan =
    DATA.schedule.find((item) => item.date === today) ||
    DATA.schedule.find((item) => item.date > today) ||
    DATA.schedule.at(-1);
  $("#todayPhase").textContent = todayPlan.phase;
  $("#todayFocus").textContent = `${todayPlan.date}（週${todayPlan.weekday}）：${todayPlan.focus}`;
  $("#todayNote").textContent = `${todayPlan.note} 建議 ${todayPlan.quizSets} 回，共 ${todayPlan.targetQuestions} 題。`;
}

function renderGroups() {
  $("#groupCards").innerHTML = Object.entries(DATA.exam.groups)
    .map(([name, group]) => {
      const qs = QUESTIONS.filter((q) => q.group === name);
      const attempted = qs.filter((q) => progress[q.id]?.attempts).length;
      const rate = Math.round((attempted / qs.length) * 100);
      return `
        <article class="group-card">
          <h3>${escapeHTML(name)}</h3>
          <p class="muted">${escapeHTML(group.time)}，${escapeHTML(group.duration)}，${group.score} 分</p>
          <div class="bar"><span style="width:${rate}%"></span></div>
          <div class="group-meta">
            <span>${escapeHTML(group.examQuestions)}</span>
            <span>已練 ${attempted} / ${qs.length}</span>
          </div>
        </article>`;
    })
    .join("");
}

function renderSubjectProgress() {
  $("#subjectProgress").innerHTML = SUBJECTS.map((subject) => {
    const qs = QUESTIONS.filter((q) => q.subjectId === subject.id);
    const attempted = qs.filter((q) => progress[q.id]?.attempts).length;
    const wrong = qs.filter((q) => isWrong(q.id)).length;
    const rate = Math.round((attempted / qs.length) * 100);
    return `
      <article class="subject-row">
        <div>
          <h3>${subject.id}. ${escapeHTML(subject.title)}</h3>
          <p class="muted">${escapeHTML(subject.group)}，選擇 ${subject.choice} 題，是非 ${subject.tf} 題</p>
        </div>
        <div>
          <div class="bar"><span style="width:${rate}%"></span></div>
          <p class="muted">${attempted} / ${qs.length} 題，${rate}%</p>
        </div>
        <div>
          <strong>${wrong}</strong>
          <span class="muted">錯題待複習</span>
        </div>
      </article>`;
  }).join("");
}

function renderChapterChart(subject) {
  const chart = window.CHAPTER_CHARTS?.[subject.id];
  if (!chart) return "";
  const flow = chart.flow
    .map((step, index) => `
      <li>
        <span>${index + 1}</span>
        <strong>${escapeHTML(step)}</strong>
      </li>`)
    .join("");
  const rows = chart.table
    .map((row) => `
      <tr>
        <th>${escapeHTML(row[0])}</th>
        <td>${escapeHTML(row[1])}</td>
        <td>${escapeHTML(row[2])}</td>
      </tr>`)
    .join("");
  const memory = chart.memory
    .map((item) => `<span class="memory-chip">${escapeHTML(item)}</span>`)
    .join("");
  return `
    <div class="chart-block">
      <h4>${escapeHTML(chart.flowTitle)}</h4>
      <ol class="flow-chart">${flow}</ol>
      <h4>${escapeHTML(chart.tableTitle)}</h4>
      <div class="chart-table-wrap">
        <table class="chart-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>核心</th>
              <th>考題陷阱</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="memory-row">${memory}</div>
    </div>`;
}

function renderNotes() {
  $("#notesGrid").innerHTML = SUBJECTS.map((subject) => `
    <article class="note-card">
      <div class="question-meta">
        <span class="mini-tag">${subject.id}</span>
        <span class="mini-tag">${escapeHTML(subject.group)}</span>
        <span class="mini-tag">${escapeHTML(subject.examWeight)}</span>
      </div>
      <h3>${escapeHTML(subject.title)}</h3>
      <p><strong>條文/內容主軸：</strong>${escapeHTML(subject.articleFocus)}</p>
      <ul>${subject.notes.map((note) => `<li>${escapeHTML(note)}</li>`).join("")}</ul>
      ${renderChapterChart(subject)}
      <p class="muted">題庫：選擇 ${subject.choice} 題，是非 ${subject.tf} 題，合計 ${subject.total} 題</p>
      <p class="source-path">來源 PDF：${escapeHTML(subject.source)}</p>
    </article>`).join("");
}

function renderSchedule() {
  const today = todayISO();
  $("#scheduleList").innerHTML = DATA.schedule.map((item) => `
    <article class="schedule-card ${item.date === today ? "is-today" : ""}">
      <div>
        <strong>${item.date}</strong>
        <p class="muted">週${item.weekday}，倒數 ${item.daysLeft} 天</p>
      </div>
      <div>
        <h3>${escapeHTML(item.phase)}：${escapeHTML(item.focus)}</h3>
        <p class="muted">${escapeHTML(item.note)}</p>
      </div>
      <div>
        <strong>${item.targetQuestions}</strong>
        <span class="muted">題 / ${item.quizSets} 回</span>
      </div>
    </article>`).join("");
}

function renderQuestionCard(question, options = {}) {
  const st = statsForQuestion(question.id);
  const last = st.lastAnswer ? `上次選 ${st.lastAnswer}` : "尚未作答";
  const exp = st.lastAnswer ? explanation(question, st.lastAnswer) : "";
  return `
    <article class="question-card">
      <div class="question-meta">
        <span class="mini-tag">${question.subjectId}. ${escapeHTML(question.subject)}</span>
        <span class="mini-tag">${questionTypeName(question.type)}</span>
        <span class="mini-tag">第 ${question.number} 題</span>
        <span class="mini-tag">錯 ${st.wrong || 0} 次</span>
      </div>
      <p>${escapeHTML(question.stem || question.raw)}</p>
      <p><strong>標準答案：</strong>${escapeHTML(answerText(question))} <span class="muted">${escapeHTML(last)}</span></p>
      ${exp ? `<div class="answer-box">${escapeHTML(exp)}</div>` : ""}
      <div class="today-actions">
        <span class="source-path">來源：${escapeHTML(question.source)}</span>
        ${options.master ? `<button data-master="${question.id}">標記熟練</button>` : ""}
      </div>
    </article>`;
}

function renderWrongs() {
  const wrongs = QUESTIONS.filter((q) => isWrong(q.id));
  $("#wrongList").innerHTML = wrongs.length
    ? wrongs.map((q) => renderQuestionCard(q, { master: true })).join("")
    : `<div class="empty-state"><h2>目前沒有錯題</h2><p>做完測驗後，答錯題會自動出現在這裡。</p></div>`;
  $$("[data-master]").forEach((btn) => btn.addEventListener("click", () => markMastered(btn.dataset.master)));
}

function renderBank() {
  const keyword = $("#searchInput").value.trim();
  const list = keyword
    ? QUESTIONS.filter((q) => `${q.subject} ${q.stem} ${q.raw}`.includes(keyword)).slice(0, 80)
    : QUESTIONS.slice(0, 40);
  $("#bankList").innerHTML = list.map((q) => renderQuestionCard(q)).join("");
}

function setupSelectors() {
  const subjectSelect = $("#subjectSelect");
  subjectSelect.innerHTML = `
    <option value="all">全部科目</option>
    <option value="group:法規課程">法規課程</option>
    <option value="group:實務課程">實務課程</option>
    <option value="group:其他課程">其他課程</option>
    ${SUBJECTS.map((s) => `<option value="${s.id}">${s.id}. ${escapeHTML(s.title)}</option>`).join("")}`;
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `採購證照錯題進度-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      progress = JSON.parse(reader.result);
      saveProgress();
      renderAll();
      switchTab("wrongs");
    } catch {
      alert("匯入失敗，請確認檔案是本系統匯出的 JSON。");
    }
  };
  reader.readAsText(file);
}

function renderAll() {
  renderHeader();
  renderGroups();
  renderSubjectProgress();
  renderNotes();
  renderSchedule();
  renderWrongs();
}

function bindEvents() {
  $$(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  $("#loginBtn")?.addEventListener("click", loginWithGoogle);
  $("#logoutBtn")?.addEventListener("click", logout);
  $("#startQuizBtn").addEventListener("click", () => startQuiz());
  $("#startTodayBtn").addEventListener("click", () => startQuiz({ mode: "unseen" }));
  $("#wrongQuickBtn").addEventListener("click", () => startQuiz({ mode: "wrong" }));
  $("#resetSessionBtn").addEventListener("click", () => {
    session = [];
    sessionIndex = 0;
    selectedAnswer = null;
    answeredIds = new Set();
    sessionResults = [];
    $("#quizArea").classList.add("hidden");
    $("#quizIntro").classList.remove("hidden");
  });
  $("#exportBtn").addEventListener("click", exportProgress);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importProgress(file);
  });
  $("#clearProgressBtn").addEventListener("click", () => {
    const ok = confirm("確定要清除全部作答、錯題與覆蓋率紀錄嗎？此動作無法復原。");
    if (!ok) return;
    progress = {};
    saveProgress();
    renderAll();
  });
  $("#searchInput").addEventListener("input", renderBank);
}

setupSelectors();
bindEvents();
renderAll();
initFirebaseSync();
