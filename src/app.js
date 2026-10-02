const DATA = window.EXAM_DATA || { questions: [], subjects: [], exam: {}, generatedAt: "" };
const STORAGE_KEY = "procurement-review-progress-v2";
const BANK_VERSION = DATA.bankVersion || DATA.generatedAt || "unknown";
const SITE_URL = "https://aa9792.github.io/procurement-exam-review-system/";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDFwKoHKw7iq2-tTzV9rx0fapYksunX6Wk",
  authDomain: "procurement-certification.firebaseapp.com",
  databaseURL: "https://procurement-certification-default-rtdb.firebaseio.com",
  projectId: "procurement-certification",
  storageBucket: "procurement-certification.firebasestorage.app",
  messagingSenderId: "1066257908472",
  appId: "1:1066257908472:web:fae8136650546007a4f10d",
};
const PLACEHOLDER_MARKERS = [
  "模擬題庫",
  "[模擬題庫]",
  "自動產生的模擬題目",
  "滿足30題隨機抽題",
  "滿足 30 題隨機抽題",
  "30題隨機抽題機制",
  "隨機抽題機制所自動產生",
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stringifyQuestion(question) {
  try {
    return JSON.stringify(question);
  } catch {
    return String(question || "");
  }
}

function isPlaceholderQuestion(question) {
  const text = stringifyQuestion(question);
  return (
    PLACEHOLDER_MARKERS.some((marker) => text.includes(marker)) ||
    (text.includes("為了滿足") && text.includes("隨機抽題") && text.includes("自動產生"))
  );
}

function isValidQuestion(question) {
  if (!question || isPlaceholderQuestion(question)) return false;
  if (!question.id || !question.subjectId || !question.subject || !question.type) return false;
  if (!["choice", "tf"].includes(question.type)) return false;
  if (!question.stem && !question.raw) return false;
  if (question.type === "choice") {
    return Array.isArray(question.options) && question.options.length >= 2 && /^\d+$/.test(String(question.answer));
  }
  return ["O", "X"].includes(question.answer);
}

const ALL_QUESTIONS = DATA.questions || [];
const QUESTIONS = ALL_QUESTIONS.filter(isValidQuestion);
const PLACEHOLDER_COUNT = ALL_QUESTIONS.filter(isPlaceholderQuestion).length;
const SUBJECTS = (DATA.subjects || []).filter((subject) =>
  QUESTIONS.some((question) => question.subjectId === subject.id)
);
const GROUPS = [...new Set(SUBJECTS.map((subject) => subject.group))];
const EXPLANATION_ENGINE = window.ProcurementExplanations?.createExplanationEngine(QUESTIONS);
const QUESTIONS_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));

let progress = migrateProgressToCurrentBank(loadProgress());
let session = [];
let sessionIndex = 0;
let sessionAnswers = {};
let firebaseAuth = null;
let firebaseDb = null;
let currentUser = null;
let cloudReady = false;
let cloudSaveTimer = null;
let isCloudLoading = false;

function loadProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  scheduleCloudSave();
}

function emptyProgressItem() {
  return {
    attempts: 0,
    correct: 0,
    wrong: 0,
    mastered: false,
    streak: 0,
    lastAnswer: "",
    lastAt: "",
    lastCorrectDate: "",
    dueAt: "",
    wrongReason: "",
    fingerprint: "",
    bankVersion: BANK_VERSION,
  };
}

function statsFor(id) {
  return progress[id] || emptyProgressItem();
}

function normalizeProgressItem(item = {}) {
  return {
    attempts: Number(item.attempts || 0),
    correct: Number(item.correct || 0),
    wrong: Number(item.wrong || 0),
    mastered: !!item.mastered,
    streak: Number(item.streak || 0),
    lastAnswer: item.lastAnswer || "",
    lastAt: item.lastAt || "",
    lastCorrectDate: item.lastCorrectDate || "",
    dueAt: item.dueAt || "",
    wrongReason: item.wrongReason || "",
    fingerprint: item.fingerprint || "",
    bankVersion: item.bankVersion || "",
  };
}

function migrateProgressToCurrentBank(source = {}) {
  const snapshot = { ...(source || {}) };
  const migrated = {};
  QUESTIONS.forEach((question) => {
    const sourceId = question.previousId || question.id;
    const raw = snapshot[sourceId] || snapshot[question.id];
    if (!raw) return;
    const item = normalizeProgressItem(raw);
    const alreadyCurrent = item.bankVersion === BANK_VERSION && item.fingerprint === question.fingerprint;
    if (!alreadyCurrent && question.contentUpdated) {
      item.mastered = false;
      item.streak = 0;
      item.dueAt = new Date().toISOString();
    }
    item.fingerprint = question.fingerprint || "";
    item.bankVersion = BANK_VERSION;
    migrated[question.id] = item;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  return migrated;
}

function mergeProgress(localProgress = {}, cloudProgress = {}) {
  const merged = {};
  const ids = new Set([...Object.keys(localProgress || {}), ...Object.keys(cloudProgress || {})]);
  ids.forEach((id) => {
    const hasLocal = !!localProgress?.[id];
    const hasCloud = !!cloudProgress?.[id];
    if (!hasLocal && !hasCloud) return;
    const localItem = hasLocal ? normalizeProgressItem(localProgress[id]) : null;
    const cloudItem = hasCloud ? normalizeProgressItem(cloudProgress[id]) : null;
    if (!localItem) {
      merged[id] = cloudItem;
      return;
    }
    if (!cloudItem) {
      merged[id] = localItem;
      return;
    }
    const newer = String(localItem.lastAt || "") >= String(cloudItem.lastAt || "") ? localItem : cloudItem;
    const correct = Math.max(localItem.correct, cloudItem.correct);
    const wrong = Math.max(localItem.wrong, cloudItem.wrong);
    merged[id] = {
      attempts: Math.max(localItem.attempts, cloudItem.attempts, correct + wrong),
      correct,
      wrong,
      mastered: localItem.mastered || cloudItem.mastered,
      streak: Math.max(localItem.streak, cloudItem.streak),
      lastAnswer: newer.lastAnswer || localItem.lastAnswer || cloudItem.lastAnswer || "",
      lastAt: newer.lastAt || localItem.lastAt || cloudItem.lastAt || "",
      lastCorrectDate: newer.lastCorrectDate || localItem.lastCorrectDate || cloudItem.lastCorrectDate || "",
      dueAt: newer.dueAt || localItem.dueAt || cloudItem.dueAt || "",
      wrongReason: newer.wrongReason || localItem.wrongReason || cloudItem.wrongReason || "",
      fingerprint: newer.fingerprint || localItem.fingerprint || cloudItem.fingerprint || "",
      bankVersion: newer.bankVersion || localItem.bankVersion || cloudItem.bankVersion || "",
    };
  });
  return merged;
}

function updateSyncStatus(message) {
  const el = $("#syncStatus");
  if (el) el.textContent = message;
}

function updateAuthControls() {
  const loginBtn = $("#loginBtn");
  loginBtn?.classList.toggle("hidden", !!currentUser);
  if (loginBtn && !currentUser) {
    loginBtn.textContent = isUnsafeOAuthBrowser() ? "用 Chrome/Safari 開啟" : "Google 登入同步";
  }
  $("#toggleEmailAuthBtn")?.classList.toggle("hidden", !!currentUser);
  $("#logoutBtn")?.classList.toggle("hidden", !currentUser);
  $("#emailAuthPanel")?.classList.toggle("hidden", !!currentUser || !$("#emailAuthPanel")?.dataset.open);
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function isUnsafeOAuthBrowser() {
  const ua = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  return (
    /Line|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|Twitter|KAKAOTALK|LinkedInApp|GSA|DuckDuckGo/i.test(ua) ||
    /;\s*wv\)|;\s*wv\b|Version\/[\d.]+\s+Chrome\/[\d.]+\s+Mobile\s+Safari/i.test(ua) ||
    (/iPhone|iPad|iPod/i.test(ua) && !/Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) ||
    /Google Inc\./i.test(vendor) && /GSA/i.test(ua)
  );
}

function androidChromeIntent(url) {
  const target = new URL(url);
  return `intent://${target.host}${target.pathname}${target.search}${target.hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

function openInSystemBrowser() {
  const url = SITE_URL;
  updateSyncStatus("請改用 Chrome/Safari 開啟後再按 Google 登入。");
  if (/Android/i.test(navigator.userAgent || "")) {
    window.location.href = androidChromeIntent(url);
    return;
  }
  window.open(url, "_blank", "noopener");
  updateSyncStatus("請在新開啟的瀏覽器頁面登入。");
}

function updateBrowserHelp() {
  const help = $("#browserHelp");
  if (!help) return;
  const showHelp = isUnsafeOAuthBrowser() && !currentUser;
  help.classList.toggle("hidden", !showHelp);
  if (showHelp && !currentUser) {
    updateSyncStatus("請用 Chrome/Safari 開啟後登入");
  }
}

async function copySiteLink() {
  try {
    await navigator.clipboard.writeText(SITE_URL);
    updateSyncStatus("已複製網址，請貼到 Chrome/Safari 開啟。");
  } catch {
    updateSyncStatus("請手動複製頁面上的網址到 Chrome/Safari 開啟。");
  }
}

function authErrorMessage(error) {
  const host = window.location.hostname || "目前網域";
  if (error?.code === "auth/unauthorized-domain") {
    return `登入失敗：${host} 尚未加入 Firebase 授權網域。`;
  }
  if (error?.code === "auth/operation-not-allowed") {
    return "登入失敗：Firebase 尚未啟用此登入方式。請到 Firebase Authentication 啟用 Google 或 Email/Password。";
  }
  if (error?.code === "auth/web-storage-unsupported") {
    return "登入失敗：目前瀏覽器不支援登入儲存，請改用 Chrome 或 Safari。";
  }
  if (error?.code === "auth/missing-or-invalid-nonce" || /initial state|missing initial state|初始狀態/i.test(error?.message || "")) {
    return "Google 登入失敗：瀏覽器封鎖 redirect 狀態。請重新開本頁後使用 Google popup，或改用 Email 登入。";
  }
  if (error?.code === "auth/invalid-email") {
    return "登入失敗：Email 格式不正確。";
  }
  if (["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(error?.code)) {
    return "登入失敗：Email 或密碼不正確。";
  }
  if (error?.code === "auth/email-already-in-use") {
    return "註冊失敗：這個 Email 已註冊，請直接登入或使用忘記密碼。";
  }
  if (error?.code === "auth/weak-password") {
    return "註冊失敗：密碼至少需要 6 個字元。";
  }
  if (error?.code === "auth/too-many-requests") {
    return "登入嘗試太多次，請稍後再試或使用忘記密碼。";
  }
  return `登入失敗：${error?.message || "請稍後再試"}`;
}

function googleProvider() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

function userProgressPath(uid = currentUser?.uid) {
  return uid ? `procurementExamUsers/${uid}/progressV2` : "";
}

function scheduleCloudSave() {
  if (!currentUser || !cloudReady || !firebaseDb || isCloudLoading) return;
  clearTimeout(cloudSaveTimer);
  updateSyncStatus("已登入，準備同步...");
  cloudSaveTimer = setTimeout(pushProgressToCloud, 800);
}

async function pushProgressToCloud() {
  if (!currentUser || !cloudReady || !firebaseDb) return;
  try {
    updateSyncStatus("同步中...");
    await firebaseDb.ref(userProgressPath()).set({
      progress,
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      appVersion: "review-progress-v3",
      bankVersion: BANK_VERSION,
    });
    updateSyncStatus(`已同步：${currentUser.displayName || currentUser.email || "Google 帳號"}`);
  } catch (error) {
    updateSyncStatus(`同步失敗：${error.message}`);
  }
}

async function readCloudProgress(user) {
  const currentSnapshot = await firebaseDb.ref(userProgressPath(user.uid)).once("value");
  const currentValue = currentSnapshot.val();
  if (currentValue?.progress) return currentValue.progress;
  if (currentValue && !currentValue.progress) return currentValue;

  const legacySnapshot = await firebaseDb.ref(`procurementExamUsers/${user.uid}/progress`).once("value");
  return legacySnapshot.val() || {};
}

async function loadProgressFromCloud(user) {
  if (!firebaseDb) return;
  isCloudLoading = true;
  try {
    updateSyncStatus("讀取雲端進度...");
    const cloudProgress = await readCloudProgress(user);
    progress = migrateProgressToCurrentBank(mergeProgress(progress, cloudProgress));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    cloudReady = true;
    isCloudLoading = false;
    renderAll();
    if (session.length) renderQuiz();
    await pushProgressToCloud();
  } catch (error) {
    isCloudLoading = false;
    cloudReady = false;
    updateSyncStatus(`雲端讀取失敗：${error.message}`);
  }
}

function initFirebaseSync() {
  if (!$("#loginBtn") || !$("#logoutBtn")) return;
  if (!window.firebase) {
    updateSyncStatus("未載入同步服務，使用本機紀錄");
    updateAuthControls();
    updateBrowserHelp();
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    firebaseDb = firebase.database();
    firebaseAuth
      .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch((error) => updateSyncStatus(authErrorMessage(error)))
      .finally(() => {
        firebaseAuth.onAuthStateChanged((user) => {
          currentUser = user;
          cloudReady = false;
          clearTimeout(cloudSaveTimer);
          updateAuthControls();
          updateBrowserHelp();
          if (user) {
            loadProgressFromCloud(user);
            return;
          }
          updateSyncStatus("未登入，使用本機紀錄");
        });
      });
  } catch (error) {
    updateSyncStatus(`同步初始化失敗：${error.message}`);
  }
}

async function loginWithGoogle() {
  if (!firebaseAuth) {
    updateSyncStatus("同步服務尚未初始化");
    return;
  }
  if (isUnsafeOAuthBrowser()) {
    updateBrowserHelp();
    openInSystemBrowser();
    return;
  }
  const provider = googleProvider();
  try {
    updateSyncStatus("開啟 Google 登入視窗...");
    await firebaseAuth.signInWithPopup(provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error.code)) {
      updateSyncStatus("Google 登入視窗未完成，請允許彈出視窗或改用 Email 登入。");
      showEmailAuthPanel();
      return;
    }
    updateSyncStatus(authErrorMessage(error));
    showEmailAuthPanel();
  }
}

async function logout() {
  if (!firebaseAuth) return;
  await firebaseAuth.signOut();
}

function toggleEmailAuthPanel() {
  const panel = $("#emailAuthPanel");
  if (!panel || currentUser) return;
  panel.dataset.open = panel.dataset.open ? "" : "1";
  panel.classList.toggle("hidden", !panel.dataset.open);
}

function showEmailAuthPanel() {
  const panel = $("#emailAuthPanel");
  if (!panel || currentUser) return;
  panel.dataset.open = "1";
  panel.classList.remove("hidden");
}

function emailAuthValues() {
  return {
    email: $("#emailInput")?.value.trim() || "",
    password: $("#passwordInput")?.value || "",
  };
}

function validateEmailAuthValues({ email, password }, requirePassword = true) {
  if (!email) {
    updateSyncStatus("請先輸入 Email。");
    return false;
  }
  if (requirePassword && password.length < 6) {
    updateSyncStatus("請輸入至少 6 個字元的密碼。");
    return false;
  }
  return true;
}

async function loginWithEmail() {
  if (!firebaseAuth) {
    updateSyncStatus("同步服務尚未初始化");
    return;
  }
  const values = emailAuthValues();
  if (!validateEmailAuthValues(values)) return;
  try {
    updateSyncStatus("Email 登入中...");
    await firebaseAuth.signInWithEmailAndPassword(values.email, values.password);
  } catch (error) {
    updateSyncStatus(authErrorMessage(error));
  }
}

async function registerWithEmail() {
  if (!firebaseAuth) {
    updateSyncStatus("同步服務尚未初始化");
    return;
  }
  const values = emailAuthValues();
  if (!validateEmailAuthValues(values)) return;
  try {
    updateSyncStatus("建立 Email 帳號中...");
    await firebaseAuth.createUserWithEmailAndPassword(values.email, values.password);
  } catch (error) {
    updateSyncStatus(authErrorMessage(error));
  }
}

async function resetEmailPassword() {
  if (!firebaseAuth) {
    updateSyncStatus("同步服務尚未初始化");
    return;
  }
  const values = emailAuthValues();
  if (!validateEmailAuthValues(values, false)) return;
  try {
    await firebaseAuth.sendPasswordResetEmail(values.email);
    updateSyncStatus("已寄出重設密碼信，請檢查信箱。");
  } catch (error) {
    updateSyncStatus(authErrorMessage(error));
  }
}

function questionText(question) {
  return question.stem || question.raw || "";
}

const FOCUS_PATTERN = /(不得|不應|不可|無須|不適用|非屬|何者非|錯誤|不正確|除外|應|須|得|可以|可|\d[\d,]*(?:\.\d+)?\s*(?:日|天|個月|年|%|％|萬元|億元|家|人|次)?)/g;
const NEGATIVE_PATTERN = /不得|不應|不可|無須|不適用|非屬|何者非|錯誤|不正確|除外/;
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?\s*(?:日|天|個月|年|%|％|萬元|億元|家|人|次)/g;
const PROCEDURE_WORDS = ["招標", "審標", "評選", "決標", "議價", "履約", "驗收", "異議", "申訴", "調解"];
const ACTOR_WORDS = ["評選委員會", "上級機關", "主管機關", "採購人員", "主驗人員", "機關", "廠商"];
const NON_MODAL_PAIRS = new Set(["取得", "獲得", "所得", "值得", "得標", "得利", "因應", "對應", "相應", "反應", "應用", "應付", "可能", "可行", "可靠", "可見", "許可", "須知"]);

function isLegalModalToken(text, index, token) {
  if (NEGATIVE_PATTERN.test(token) || /^\d/.test(token) || token === "可以") return true;
  const previous = text[index - 1] || "";
  const next = text[index + token.length] || "";
  return !NON_MODAL_PAIRS.has(`${previous}${token}`) && !NON_MODAL_PAIRS.has(`${token}${next}`);
}

function annotatedText(value) {
  const text = String(value || "");
  let cursor = 0;
  let html = "";
  for (const match of text.matchAll(FOCUS_PATTERN)) {
    html += escapeHTML(text.slice(cursor, match.index));
    const token = match[0];
    if (!isLegalModalToken(text, match.index, token)) {
      html += escapeHTML(token);
      cursor = match.index + token.length;
      continue;
    }
    const kind = NEGATIVE_PATTERN.test(token) ? "negative" : /^\d/.test(token) ? "number" : "modal";
    html += `<mark class="focus-mark is-${kind}">${escapeHTML(token)}</mark>`;
    cursor = match.index + token.length;
  }
  return html + escapeHTML(text.slice(cursor));
}

function findModalToken(text) {
  for (const match of String(text || "").matchAll(/不得|不應|不可|無須|應|須|得|可以|可/g)) {
    if (isLegalModalToken(text, match.index, match[0])) return match[0];
  }
  return "";
}

function uniqueMatches(values) {
  return [...new Set(values.filter(Boolean))];
}

function questionFocus(question) {
  const text = questionText(question);
  const actor = ACTOR_WORDS.find((word) => text.includes(word)) || "行為主體";
  const direction = text.match(NEGATIVE_PATTERN)?.[0] || (/正確|為是|合法|適法/.test(text) ? "找正確" : "判斷規則");
  const numbers = uniqueMatches(text.match(NUMBER_PATTERN) || []).slice(0, 3);
  const procedures = PROCEDURE_WORDS.filter((word) => text.includes(word)).slice(0, 3);
  return {
    actor,
    direction,
    detail: numbers.length ? numbers.join("、") : procedures.length ? procedures.join(" → ") : "條件與法律效果",
  };
}

function focusGuideHTML(question) {
  const focus = questionFocus(question);
  return `
    <div class="focus-guide" aria-label="本題答題重點">
      <span><b>1 主詞</b>${escapeHTML(focus.actor)}</span>
      <span><b>2 問法</b>${escapeHTML(focus.direction)}</span>
      <span><b>3 鉤子</b>${escapeHTML(focus.detail)}</span>
    </div>`;
}

function conciseRule(question, explanation) {
  const correctText =
    question.type === "choice"
      ? question.options?.[Number(question.answer) - 1] || ""
      : explanation?.correctedStatement || questionText(question);
  const shortRule = correctText.length > 96 ? `${correctText.slice(0, 96)}…` : correctText;
  const numbers = uniqueMatches(correctText.match(NUMBER_PATTERN) || []).slice(0, 3);
  if (question.answer === "X" && explanation?.wrongPart && explanation?.correctPart) {
    return `改錯字：把「${explanation.wrongPart}」改成「${explanation.correctPart}」。`;
  }
  if (question.type === "choice" && explanation?.intent?.asksWrong) {
    const reference = lawReferences(question)[0];
    const legalRule = reference?.key !== "no-exact-reference" ? reference?.summary : "回到法條核對主體、條件、程序與法律效果";
    return `陷阱：${shortRule}（這是錯誤／例外選項）；正確規則：${legalRule}`;
  }
  if (numbers.length) {
    return `數字要連條件背：${numbers.join("、")}；${shortRule}`;
  }
  const modal = findModalToken(correctText);
  if (modal) {
    return `先記法律強度「${modal}」：${shortRule}`;
  }
  return shortRule;
}

function sourceFileName(source) {
  return String(source || "").split(/[\\/]/).pop();
}

function questionTypeLabel(type) {
  return type === "choice" ? "選擇題" : "是非題";
}

function answerLabel(question, answer = question.answer) {
  if (question.type === "tf") return answer === "O" ? "O（正確）" : "X（錯誤）";
  const index = Number(answer) - 1;
  const option = question.options?.[index] || "";
  return `(${answer}) ${option}`;
}

function choiceIntent(question) {
  const text = questionText(question);
  if (/不包含|不包括|非屬|何者非|何者不是|不是|除外/.test(text)) {
    return {
      label: "排除式題目",
      detail: "題目要找的是「不屬於、不包含或不是」的選項，標準答案通常是與題目所列規定或範圍不一致的那一項。",
    };
  }
  if (/錯誤|不正確|有誤|不適法|不合法|無效|不得/.test(text)) {
    return {
      label: "找錯誤敘述",
      detail: "題目要找的是錯誤或不適法的敘述，所以標準答案代表該選項與法規、程序或題庫基準不一致。",
    };
  }
  if (/正確|何者為是|適法|合法|有效|得為|應為/.test(text)) {
    return {
      label: "找正確敘述",
      detail: "題目要找的是最符合規定或題意的敘述，標準答案是本題語境下最適合採用的選項。",
    };
  }
  return {
    label: "一般判斷題",
    detail: "題目沒有明顯正反問法，作答時要先抓主詞、程序階段、條件和法律效果，再選最符合題意者。",
  };
}

function extractReviewPoints(question) {
  const text = `${questionText(question)} ${question.raw || ""}`;
  const keywords = [
    "招標",
    "決標",
    "履約",
    "驗收",
    "保固",
    "異議",
    "申訴",
    "調解",
    "底價",
    "押標金",
    "保證金",
    "最有利標",
    "評選",
    "統包",
    "電子",
    "契約",
    "轉包",
    "分包",
    "停權",
  ].filter((keyword) => text.includes(keyword));
  const numbers = text.match(/\d+\s*(日|天|個月|年|%|％|萬元|億元)/g) || [];
  return [...new Set([...keywords, ...numbers])].slice(0, 6);
}

function subjectInfo(question) {
  return SUBJECTS.find((subject) => subject.id === question.subjectId) || {};
}

function textForLawBasis(question) {
  const correctOption =
    question.type === "choice" ? question.options?.[Number(question.answer) - 1] || "" : questionText(question);
  return `${questionText(question)} ${correctOption} ${question.lawSource || ""}`;
}

function procurementActLink(article) {
  const flno = String(article).replace("之", "-");
  return `https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=A0030057&flno=${encodeURIComponent(flno)}`;
}

const PROCUREMENT_ARTICLE_SUMMARIES = {
  1: "建立公平、公開的政府採購制度，提升效率與功能並確保品質。",
  2: "採購包含工程定作、財物買受／定製／承租，以及勞務委任或僱傭等。",
  3: "政府機關、公立學校及公營事業辦理採購，原則上適用政府採購法。",
  4: "受機關補助達採購金額半數且補助金額達公告金額者，適用採購法並受補助機關監督。",
  5: "機關得委託法人或團體代辦採購，代辦採購仍適用採購法。",
  6: "採購應維護公共利益及公平合理，不得無正當理由差別待遇；專業判斷仍不得違反採購法。",
  7: "界定工程、財物、勞務採購；兼具二種以上性質時，依預算金額比率最高者認定。",
  8: "界定採購法所稱廠商，包括得提供工程、財物或勞務的自然人、法人、機構或團體。",
  9: "規定主管機關及上級機關的認定方式。",
  11: "採購資訊中心及工程價格資料庫可供預算編列與底價訂定參考。",
  "11之1": "巨額工程採購應依特性及需要成立採購工作及審查小組。",
  12: "查核金額以上採購的開標、比價、議價、決標及驗收，應報請上級機關派員監辦。",
  13: "公告金額以上採購，除特殊情形外，應由主（會）計及有關單位會同監辦。",
  14: "不得意圖規避採購法而分批辦理；必要分批且經核准者，仍按總金額適用程序。",
  15: "規範採購人員離職後接洽限制及本人、配偶、親屬利益衝突迴避。",
  18: "招標方式分為公開招標、選擇性招標及限制性招標。",
  19: "公告金額以上採購，除符合選擇性或限制性招標要件外，應公開招標。",
  20: "列舉公告金額以上採購得採選擇性招標的情形。",
  21: "選擇性招標得先辦資格審查並建立合格廠商名單，且應給予平等受邀機會。",
  22: "列舉公告金額以上採購得採限制性招標的法定情形。",
  23: "未達公告金額採購的招標方式，由中央或地方主管機關另定。",
  24: "機關基於效率及品質要求得採統包，將設計與施工、供應或安裝等併案辦理。",
  25: "共同投標須有助競爭或無不當限制競爭，並於投標時附共同投標協議書。",
  26: "技術規格應依功能或效益訂定，不得造成限制競爭；指定廠牌原則上須允許同等品。",
  27: "公開或選擇性招標應刊登政府採購公報並公開於資訊網路。",
  28: "公告或邀標日起至截止投標日的等標期，應訂定合理期限。",
  29: "公開招標文件應公開提供，且不得登記領標廠商名稱。",
  30: "原則上應在招標文件規定押標金及保證金，並列有得免收的採購情形。",
  31: "規定押標金發還、不予發還、追繳事由及追繳時效。",
  33: "規範投標文件送達、電子傳輸及非契約必要之點文件的補正。",
  34: "底價在開標後至決標前仍應保密；決標後除有特殊情形外應予公開，機關也得依實際需要於招標文件公告底價。",
  36: "機關得依需要訂定基本資格；特殊或巨額採購得訂定特定資格。",
  37: "廠商資格不得不當限制競爭，且應限於確認履約所必要的能力。",
  42: "機關得規定資格、規格與價格一次投標分段開標，或分段投標分段開標。",
  45: "公開招標及選擇性招標原則上應依招標文件公告的時間及地點公開開標。",
  46: "底價應依圖說、規範、契約並考量成本、市場行情及政府機關決標資料訂定。",
  47: "訂定底價確有困難的特殊或複數決標採購，得不訂底價，但應載明理由及決標條件。",
  48: "規範招標案件得開標、決標，以及第一次公開招標投標廠商家數等條件。",
  49: "未達公告金額而逾公告金額十分之一者，原則上應公開取得三家以上書面報價或企劃書。",
  50: "投標文件有偽造、借名、重大異常或不符招標文件等情形者，不予開標或決標。",
  52: "規定最低標、最有利標、最高標及複數決標等決標原則。",
  53: "合於招標文件的最低標超過底價時，得辦理減價並在法定條件下決標。",
  54: "最低標有二家以上標價相同時，依比減價或抽籤等方式決定得標廠商。",
  56: "採最有利標決標時，應依招標文件所定評審標準評選；協商須符合本條程序。",
  58: "總標價或部分標價偏低而顯不合理時，機關得限期要求說明或擔保後再決標。",
  61: "公告金額以上採購的決標結果，原則上應刊登政府採購公報。",
  62: "機關辦理採購的決標資料，應依規定定期彙送主管機關。",
  63: "採購契約原則上應採主管機關訂定的契約範本，契約應訂明權利義務。",
  65: "得標廠商應自行履行工程或勞務的主要部分，不得轉包。",
  66: "違法轉包時，得標廠商與轉包廠商對機關負連帶履行及賠償責任。",
  67: "得標廠商得分包，但對分包部分仍負完全責任；特定分包廠商應依規定報備。",
  70: "工程採購應訂定品質管理規定，辦理品質管理、環境保護及施工安全查核。",
  "70之1": "工程規劃及設計應依規模與特性分析施工危險，編製安全衛生圖說、規範並量化編列費用。",
  71: "採購完成履約後，機關應依期限辦理驗收，並得辦理部分驗收。",
  72: "驗收結果與契約不符時，應通知限期改善、拆除、重作、退貨或換貨；符合條件者得減價收受。",
  73: "驗收應作成紀錄；驗收合格後應填具結算驗收證明書。",
  "73之1": "驗收付款原則上應於接到廠商請款單據後 15 日內辦理；涉及申請補助款者為 30 日，契約另有約定者從其約定。",
  74: "廠商與機關間關於招標、審標、決標的爭議，得依異議及申訴程序處理。",
  75: "廠商對招標文件、招標過程或結果認為違法致損權益者，得在法定期限內提出異議。",
  76: "廠商對異議處理結果不服，或機關逾期不處理者，得在期限內提出申訴。",
  "85之1": "履約爭議得向採購申訴審議委員會申請調解；工程及技術服務採購另有強化調解、仲裁機制。",
  87: "處罰以強暴、詐術、合意或借牌等方式妨害投標、圍標的行為。",
  94: "辦理評選應成立採購評選委員會，委員專業資格、人數與組成依規定辦理。",
  "93之1": "機關得以電子化方式辦理招標、領標、投標、開標、決標及費用收取。",
  101: "廠商有法定違法或重大違約情形時，機關應通知並依程序刊登政府採購公報。",
  102: "廠商對第 101 條通知不服，得提出異議及申訴；機關應依期限處理。",
  103: "刊登公報的廠商於法定期間內不得參加投標或作為決標、分包對象。",
};

const NAMED_LAW_REFERENCES = {
  政府採購法施行細則: {
    pcode: "A0030058",
    url: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030058",
    summary: "補充採購金額計算、監辦、招標、審標、決標、履約及驗收等採購法執行細節。",
  },
  招標期限標準: { summary: "規定各類招標案件等標期的最低期限及得縮短期限的條件。" },
  押標金保證金暨其他擔保作業辦法: { summary: "規定押標金、保證金及其他擔保的額度、繳納、發還與不發還方式。" },
  最有利標評選辦法: { summary: "規定最有利標的評選項目、評審標準、評定方式、協商及決標程序。" },
  採購評選委員會組織準則: { summary: "規定評選委員會的任務、委員人數、專家學者比例及組成方式。" },
  採購評選委員會審議規則: { summary: "規定評選委員會會議、評分、出席、迴避及審議程序。" },
  採購契約要項: { summary: "整理採購契約應載明的履約、價金、變更、驗收、違約及爭議處理事項。" },
  電子採購作業辦法: { summary: "規定電子領標、投標、報價、開標及電子文件的作業程序。" },
  機關委託技術服務廠商評選及計費辦法: { summary: "規定技術服務廠商的評選、服務費用計算及相關作業。" },
  機關主會計及有關單位會同監辦採購辦法: { summary: "規定主（會）計及有關單位會同監辦的範圍、方式、得不派員監辦情形及紀錄程序。" },
};

function lawSearchLink(name) {
  return `https://law.moj.gov.tw/LawClass/LawSearch.aspx?ty=ONEBAR&kw=${encodeURIComponent(name)}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regulationArticleLink(pcode, article) {
  const flno = String(article).replace("之", "-");
  return `https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=${encodeURIComponent(pcode)}&flno=${encodeURIComponent(flno)}`;
}

function namedRegulationReference(name, article, summary, confidence = "題目明示") {
  const info = NAMED_LAW_REFERENCES[name] || {};
  return {
    key: `${name}-${article || "all"}`,
    label: `${name}${article ? `第 ${article} 條` : ""}`,
    url: info.pcode && article ? regulationArticleLink(info.pcode, article) : info.url || lawSearchLink(name),
    summary: summary || info.summary,
    confidence,
  };
}

function procurementArticleReference(article, confidence = "題目明示") {
  const normalized = String(article).replace("-", "之");
  return {
    key: `政府採購法-${normalized}`,
    label: `政府採購法第 ${normalized} 條`,
    url: procurementActLink(normalized),
    summary: PROCUREMENT_ARTICLE_SUMMARIES[normalized] || "請開啟全國法規資料庫核對本條完整條文及各項、各款規定。",
    confidence,
  };
}

function extractExplicitLawReferences(question) {
  const text = textForLawBasis(question);
  const refs = [];
  const add = (article) => {
    const ref = procurementArticleReference(article);
    if (!refs.some((item) => item.key === ref.key)) refs.push(ref);
  };
  for (const match of text.matchAll(/(?:政府採購法|採購法)第\s*(\d+)(?:\s*(?:條\s*之|之|-)\s*(\d+))?\s*條?/g)) {
    add(match[2] ? `${match[1]}之${match[2]}` : match[1]);
  }

  const containsOtherNamedRule = Object.keys(NAMED_LAW_REFERENCES).some(
    (name) => name !== "政府採購法施行細則" && text.includes(name)
  );
  if (["02", "03", "04"].includes(question.subjectId) && /(?:政府)?採購法/.test(text) && !containsOtherNamedRule) {
    for (const match of text.matchAll(/第\s*(\d+)(?:\s*(?:條\s*之|之|-)\s*(\d+))?\s*條?/g)) {
      const prefix = text.slice(Math.max(0, match.index - 20), match.index);
      if (/民法|刑法|行政程序法|規費法|公司法|施行細則|組織準則|審議規則/.test(prefix)) continue;
      add(match[2] ? `${match[1]}之${match[2]}` : match[1]);
    }
  }
  return refs.slice(0, 3);
}

function sourceColumnLawReferences(question) {
  if (!question.lawSource || question.lawSource === "綜合") return [];
  const refs = [];
  for (const match of question.lawSource.matchAll(/第\s*(\d+)(?:\s*條\s*之\s*(\d+)|\s*之\s*(\d+))?\s*條?/g)) {
    const article = match[2] || match[3] ? `${match[1]}之${match[2] || match[3]}` : match[1];
    const ref = procurementArticleReference(article, "最新題庫標示");
    if (!refs.some((item) => item.key === ref.key)) refs.push(ref);
  }
  return refs.slice(0, 3);
}

function extractNamedLawReferences(question) {
  const text = textForLawBasis(question);
  return Object.entries(NAMED_LAW_REFERENCES)
    .filter(([name]) => text.includes(name))
    .map(([name]) => {
      const article = text.match(new RegExp(`${escapeRegExp(name)}」?第\\s*(\\d+(?:[之-]\\d+)?)\\s*條`))?.[1];
      return namedRegulationReference(name, article);
    })
    .slice(0, 2);
}

function specialLawReferences(question) {
  const text = textForLawBasis(question);
  if (/規\s*格.*價\s*格.*合\s*併.*(?:投\s*標|開\s*標)/.test(text)) {
    return [
      procurementArticleReference("42", "現行法規精準對應"),
      namedRegulationReference(
        "政府採購法施行細則",
        "44",
        "分段開標得依資格、規格、價格順序辦理，也得將資格與規格或規格與價格合併開標；因此把「不得合併」當成一律禁止是錯的。",
        "現行法規精準對應"
      ),
    ];
  }
  if (/底價.*(?:保\s*密|公\s*開)|(?:保\s*密|公\s*開).*底價|已決標部分之底價/.test(text)) {
    return [procurementArticleReference("34", "現行法規精準對應")];
  }
  if (/採購金額.*(?:計算|認定)|租期不確定/.test(text)) {
    return [
      namedRegulationReference(
        "政府採購法施行細則",
        "6",
        "採購金額應於招標前認定；分批採購按全部批數預算總額計算，租期不確定者按每月租金 48 倍計算（即 4 年）。",
        "現行法規對應"
      ),
    ];
  }
  if (/查核金額以上.*(?:等標期|截止收件日).*5日/.test(text)) {
    return [
      namedRegulationReference(
        "政府採購法施行細則",
        "7",
        "查核金額以上採購的招標，應於等標期或截止收件日 5 日前檢送預算、招標文件及相關文件，報請上級機關派員監辦。",
        "現行法規對應"
      ),
    ];
  }
  if (/書面審核監辦/.test(text)) {
    return [
      namedRegulationReference(
        "政府採購法施行細則",
        "11",
        "監辦是實地監視或書面審核採購程序是否合法；採書面審核監辦時，應經機關首長或其授權人員核准。",
        "現行法規對應"
      ),
    ];
  }
  return [];
}

function inferLawReferences(question) {
  const text = textForLawBasis(question);
  const rules = [
    { match: /採購法.*適用範圍|採購法所稱採購|應依採購法辦理/, articles: ["2", "3"] },
    { match: /權利採購|工程、?財物及勞務|工程.*財物.*勞務/, articles: ["7"] },
    { match: /公共利益|公平合理|差別待遇|違反採購法之決定/, articles: ["6"] },
    { match: /上級機關/, articles: ["9"] },
    { match: /監辦|派員監辦|會同監辦/, articles: ["12", "13"] },
    { match: /招標文件.*異議|異議/, articles: ["75"] },
    { match: /申訴|審議判斷/, articles: ["76"] },
    { match: /調解|仲裁|履約爭議/, articles: ["85之1"] },
    { match: /停權|刊登.*公報|拒絕往來/, articles: ["101", "103"] },
    { match: /圍標|借牌|綁標|妨害投標/, articles: ["87"] },
    { match: /押標金|追繳/, articles: ["30", "31"] },
    { match: /標價偏低/, articles: ["58"] },
    { match: /底價|超底價/, articles: ["46", "47"] },
    { match: /最有利標/, articles: ["56"] },
    { match: /評選委員會/, articles: ["94"] },
    { match: /技術規格|同等品|限制競爭/, articles: ["26", "37"] },
    { match: /限制性招標/, articles: ["22"] },
    { match: /選擇性招標/, articles: ["20", "21"] },
    { match: /公開招標/, articles: ["19"] },
    { match: /招標方式/, articles: ["18"] },
    { match: /等標期/, articles: ["28"] },
    { match: /廠商資格/, articles: ["36", "37"] },
    { match: /不予開標|不予決標|偽造|借名/, articles: ["50"] },
    { match: /決標原則|最低標|複數決標/, articles: ["52"] },
    { match: /公開開標|第一次公開招標|廢標/, articles: ["45", "48"] },
    { match: /初驗|複驗|減價收受|驗收結果.*契約不符/, articles: ["71", "72"] },
    { match: /轉包/, articles: ["65", "66"] },
    { match: /分包/, articles: ["67"] },
    { match: /採購契約範本|契約範本/, articles: ["63"] },
    { match: /電子領標|電子投標|電子採購|電子報價/, articles: ["93之1"] },
    { match: /統包/, articles: ["24"] },
  ];
  const articles = [];
  rules.forEach((rule) => {
    if (!rule.match.test(text)) return;
    rule.articles.forEach((article) => {
      if (!articles.includes(article)) articles.push(article);
    });
  });
  return articles.slice(0, 2).map((article) => procurementArticleReference(article, "關鍵字對應"));
}

function lawReferences(question) {
  const sourceRefs = sourceColumnLawReferences(question);
  const explicitRefs = extractExplicitLawReferences(question);
  const namedRefs = extractNamedLawReferences(question);
  const specialRefs = specialLawReferences(question);
  const inferredRefs = explicitRefs.length || namedRefs.length || specialRefs.length ? [] : inferLawReferences(question);
  const refs = [...specialRefs, ...sourceRefs, ...explicitRefs, ...namedRefs, ...inferredRefs]
    .filter((ref, index, items) => items.findIndex((item) => item.key === ref.key) === index)
    .slice(0, 4);
  if (!refs.length) {
    refs.push({
      key: "no-exact-reference",
      label: "本題題庫未標示具體法條",
      summary: "此題可能依行政規則、作業要點、函釋或契約範本出題；目前無法僅憑題幹可靠對應到單一法條。",
      confidence: "待補法源",
    });
  }
  return refs;
}

function lawApplication(question, explanation, ref) {
  if (ref.key === "no-exact-reference") {
    return "目前只能依題庫標準答案與相近正確題核對，不能把未確認的條號當成法源。";
  }
  if (question.type === "choice") {
    const option = question.options?.[Number(question.answer) - 1] || "";
    if (explanation?.intent?.asksWrong) {
      return `本題採排除式問法；對照上述規定可知，答案選項「${option}」正是題目要求找出的例外、錯誤或不屬項，因此應選此項。`;
    }
    return `答案選項「${option}」符合上述規定所要求的主體、條件或程序，因此應選此項。`;
  }
  if (question.answer === "X" && explanation?.wrongPart && explanation?.correctPart) {
    return `原題錯在「${explanation.wrongPart}」，正確應為「${explanation.correctPart}」；對照上述規定可確認這項差異，因此判為 X。`;
  }
  if (question.answer === "X") {
    return "原題至少有一項主體、條件、程序或法律效果與上述規定不符，因此判為 X。";
  }
  return "題幹所述的主體、條件、程序及法律效果與上述規定一致，因此判為 O。";
}

function lawBasisHTML(question, explanation) {
  const refs = lawReferences(question);
  return `
    <div class="law-basis">
      <strong>法規依據</strong>
      <div class="law-reference-list">
        ${refs
          .map(
            (ref) => `
              <div class="law-reference-item">
                <div class="law-reference-heading">
                  ${
                    ref.url
                      ? `<a class="law-link" href="${escapeHTML(ref.url)}" target="_blank" rel="noopener">${escapeHTML(ref.label)}</a>`
                      : `<span class="law-reference-title">${escapeHTML(ref.label)}</span>`
                  }
                  <span class="law-confidence">${escapeHTML(ref.confidence)}</span>
                </div>
                <p>${escapeHTML(ref.summary)}</p>
                <p class="law-application"><strong>與本題的關係：</strong>${escapeHTML(
                  lawApplication(question, explanation, ref)
                )}</p>
              </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function explanationHTML(question) {
  const explanation = EXPLANATION_ENGINE?.explain(question);
  const correctStatement =
    question.type === "choice"
      ? explanation?.intent?.asksWrong
        ? `本題是反向題；答案 ${answerLabel(question)} 是題庫判定的錯誤／例外敘述，不可直接當成正確規則背誦。`
        : `本題正確答案為 ${answerLabel(question)}${/[。！？!?]$/.test(answerLabel(question)) ? "" : "。"}`
      : explanation?.correctedStatement ||
        (question.answer === "O" ? questionText(question) : "題庫未提供可核對的完整正確敘述。");
  const reason =
    explanation?.reason ||
    (question.type === "choice"
      ? "請對照答案選項與下方條文的主體、條件、程序及法律效果。"
      : "請對照下方法規依據核對題幹敘述。");
  const memoryRule = conciseRule(question, explanation);

  return `
    <div class="explanation-block">
      <div class="correct-statement-block">
        <strong>正確敘述・這題只記</strong>
        <p class="memory-rule">${annotatedText(memoryRule)}</p>
        <p>${escapeHTML(correctStatement)}</p>
        <p class="answer-reason"><strong>為什麼：</strong>${escapeHTML(reason)}</p>
      </div>
      ${lawBasisHTML(question, explanation)}
    </div>`;
}

function isWrongQuestion(question) {
  const item = statsFor(question.id);
  return item.wrong > 0 && !item.mastered;
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dueDate(days) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString();
}

function isDueQuestion(question) {
  const item = statsFor(question.id);
  if (!item.attempts) return false;
  if (!item.dueAt) return isWrongQuestion(question);
  return !item.mastered && new Date(item.dueAt).getTime() <= Date.now();
}

function subjectMatches(question, selection) {
  if (selection === "all") return true;
  if (selection.startsWith("group:")) return question.group === selection.slice(6);
  return question.subjectId === selection;
}

function filteredQuestions() {
  const subject = $("#subjectSelect").value;
  const type = $("#typeSelect").value;
  return QUESTIONS.filter((question) => {
    if (isPlaceholderQuestion(question)) return false;
    if (!subjectMatches(question, subject)) return false;
    return type === "all" || question.type === type;
  });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function updatePoolInfo() {
  const pool = filteredQuestions();
  const wrong = pool.filter(isWrongQuestion).length;
  const unseen = pool.filter((question) => !statsFor(question.id).attempts).length;
  const due = pool.filter(isDueQuestion).length;
  $("#poolInfo").textContent = `題庫 ${pool.length} 題｜今日到期 ${due}｜未練 ${unseen}｜錯題 ${wrong}`;
}

function reviewPriority(question) {
  const item = statsFor(question.id);
  if (isDueQuestion(question)) return 0;
  if (isWrongQuestion(question)) return 1;
  if (!item.attempts) return 2;
  return 3;
}

function prioritized(items) {
  return shuffle(items).sort((left, right) => reviewPriority(left) - reviewPriority(right));
}

function weightedReview(pool, count) {
  if ($("#subjectSelect").value !== "all") return prioritized(pool).slice(0, count);
  const weights = [
    ["其他課程", 9],
    ["法規課程", 6],
    ["實務課程", 5],
  ];
  const picked = [];
  weights.forEach(([group, quota]) => {
    picked.push(...prioritized(pool.filter((question) => question.group === group)).slice(0, quota));
  });
  const ids = new Set(picked.map((question) => question.id));
  const remaining = prioritized(pool.filter((question) => !ids.has(question.id)));
  return [...picked, ...remaining].slice(0, count);
}

function pickQuestions() {
  const mode = $("#modeSelect").value;
  const count = 20;
  let pool = filteredQuestions();

  if (mode === "wrong") {
    pool = prioritized(pool.filter(isWrongQuestion));
  } else if (mode === "unseen") {
    const unseen = shuffle(pool.filter((question) => !statsFor(question.id).attempts));
    const seen = shuffle(pool.filter((question) => statsFor(question.id).attempts));
    pool = [...unseen, ...seen];
  } else if (mode === "review") {
    return weightedReview(pool, count);
  } else {
    pool = shuffle(pool);
  }

  return pool.filter((question) => !isPlaceholderQuestion(question)).slice(0, count);
}

function startQuiz(overrides = {}) {
  if (overrides.mode) $("#modeSelect").value = overrides.mode;
  session = pickQuestions();
  sessionIndex = 0;
  sessionAnswers = {};
  $("#quizIntro").classList.add("hidden");
  $("#quizArea").classList.remove("hidden");
  renderQuiz();
  renderStats();
}

function recordAnswer(question, answer) {
  if (sessionAnswers[question.id]) return;
  const correct = answer === question.answer;
  const item = normalizeProgressItem(progress[question.id]);
  item.attempts += 1;
  item.lastAnswer = answer;
  item.lastAt = new Date().toISOString();
  item.fingerprint = question.fingerprint || "";
  item.bankVersion = BANK_VERSION;
  if (correct) {
    item.correct += 1;
    const today = localDateKey();
    if (item.lastCorrectDate !== today) item.streak += 1;
    item.lastCorrectDate = today;
    item.mastered = item.streak >= 2;
    item.dueAt = dueDate(item.mastered ? 7 : 1);
  } else {
    item.wrong += 1;
    item.mastered = false;
    item.streak = 0;
    item.dueAt = dueDate(1);
    item.wrongReason = "尚未標註";
  }
  progress[question.id] = item;
  sessionAnswers[question.id] = { answer, correct };
  saveProgress();
  renderAll(false);
  renderQuiz();
}

function setWrongReason(questionId, reason) {
  const item = normalizeProgressItem(progress[questionId]);
  item.wrongReason = reason;
  progress[questionId] = item;
  saveProgress();
  renderQuiz();
}

function wrongReasonHTML(question) {
  const current = statsFor(question.id).wrongReason;
  const reasons = ["觀念不熟", "反向題看錯", "數字混淆", "主體混淆", "程序順序", "猜題"];
  return `
    <div class="wrong-reasons">
      <strong>這次錯在哪裡？</strong>
      <div>
        ${reasons
          .map(
            (reason) =>
              `<button class="reason-chip ${current === reason ? "is-selected" : ""}" data-wrong-reason="${escapeHTML(
                reason
              )}" type="button">${escapeHTML(reason)}</button>`
          )
          .join("")}
      </div>
    </div>`;
}

function renderQuiz() {
  session = session.filter((question) => question && !isPlaceholderQuestion(question));
  if (sessionIndex >= session.length) sessionIndex = Math.max(session.length - 1, 0);

  const area = $("#quizArea");
  if (!session.length) {
    area.innerHTML = `
      <div class="empty-state">
        <h2>沒有可出的題目</h2>
        <p>請改選科目、題型或模式。若選錯題複習，代表目前沒有符合條件的錯題。</p>
      </div>`;
    return;
  }

  const question = session[sessionIndex];
  const result = sessionAnswers[question.id];
  const choices =
    question.type === "choice"
      ? question.options.map((option, index) => ({
          value: String(index + 1),
          label: `(${index + 1}) ${option}`,
        }))
      : [
          { value: "O", label: "O（正確）" },
          { value: "X", label: "X（錯誤）" },
        ];

  area.innerHTML = `
    <div class="quiz-top">
      <div>
        <strong>題目 ${sessionIndex + 1} / ${session.length}</strong>
        <div class="question-meta">
          <span class="mini-tag">${escapeHTML(question.group)}</span>
          <span class="mini-tag">${escapeHTML(question.subject)}</span>
          <span class="mini-tag">${questionTypeLabel(question.type)}</span>
          <span class="mini-tag">原題第 ${escapeHTML(question.number)} 題</span>
        </div>
      </div>
      <span class="muted">記憶 ${statsFor(question.id).streak} / 2</span>
    </div>
    ${focusGuideHTML(question)}
    <p class="question-stem">${annotatedText(questionText(question))}</p>
    <div class="options ${question.type === "tf" ? "tf-options" : ""}"></div>
    <div id="answerBox" class="${result ? `answer-box ${result.correct ? "is-correct" : "is-wrong"}` : "hidden"}"></div>
    <div class="quiz-nav">
      <button id="prevBtn" type="button">上一題</button>
      <button id="nextBtn" class="primary" type="button">${sessionIndex === session.length - 1 ? "完成 / 看結果" : "下一題"}</button>
    </div>`;

  const options = area.querySelector(".options");
  choices.forEach((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option";
    button.innerHTML = annotatedText(choice.label);
    if (result) {
      button.disabled = true;
      if (choice.value === question.answer) button.classList.add("is-correct");
      if (choice.value === result.answer && !result.correct) button.classList.add("is-wrong");
    }
    button.addEventListener("click", () => recordAnswer(question, choice.value));
    options.appendChild(button);
  });

  if (result) {
    $("#answerBox").innerHTML = `
      <strong>${result.correct ? "答對。" : "答錯。"}</strong>
      你的答案：${escapeHTML(answerLabel(question, result.answer))}<br>
      標準答案：${escapeHTML(answerLabel(question))}<br>
      ${!result.correct ? wrongReasonHTML(question) : ""}
      ${explanationHTML(question)}
      <span class="source-path">來源：${escapeHTML(question.source)}</span>`;
    $$('[data-wrong-reason]').forEach((button) => {
      button.addEventListener("click", () => setWrongReason(question.id, button.dataset.wrongReason));
    });
  }

  $("#prevBtn").disabled = sessionIndex === 0;
  $("#nextBtn").disabled = !result;
  $("#prevBtn").addEventListener("click", () => {
    sessionIndex -= 1;
    renderQuiz();
  });
  $("#nextBtn").addEventListener("click", () => {
    if (sessionIndex < session.length - 1) {
      sessionIndex += 1;
      renderQuiz();
      return;
    }
    renderSessionResult();
  });
}

function renderSessionResult() {
  const answered = Object.values(sessionAnswers);
  const correct = answered.filter((item) => item.correct).length;
  $("#quizArea").innerHTML = `
    <div class="empty-state">
      <h2>本回完成</h2>
      <p>已作答 ${answered.length} / ${session.length} 題，答對 ${correct} 題。</p>
      <div class="card-actions">
        <button id="againBtn" class="primary" type="button">再練一回</button>
        <button id="reviewWrongSessionBtn" type="button">練錯題</button>
      </div>
    </div>`;
  $("#againBtn").addEventListener("click", () => startQuiz());
  $("#reviewWrongSessionBtn").addEventListener("click", () => startQuiz({ mode: "wrong" }));
}

function renderStats() {
  const due = QUESTIONS.filter(isDueQuestion).length;
  const wrong = QUESTIONS.filter(isWrongQuestion).length;
  const mastered = QUESTIONS.filter((question) => statsFor(question.id).mastered).length;
  $("#totalQuestions").textContent = QUESTIONS.length;
  $("#attemptedQuestions").textContent = due;
  $("#wrongQuestions").textContent = wrong;
  $("#masteredQuestions").textContent = mastered;
  $("#generatedAt").textContent = `最新題庫：${DATA.bankVersion || DATA.generatedAt || "未標示"}，共 ${QUESTIONS.length} 題`;
  updatePoolInfo();
}

function renderSubjectProgress() {
  $("#subjectProgress").innerHTML = SUBJECTS.map((subject) => {
    const questions = QUESTIONS.filter((question) => question.subjectId === subject.id);
    const mastered = questions.filter((question) => statsFor(question.id).mastered).length;
    const wrong = questions.filter(isWrongQuestion).length;
    const rate = questions.length ? Math.round((mastered / questions.length) * 100) : 0;
    return `
      <article class="subject-row">
        <div>
          <h3>${subject.id}. ${escapeHTML(subject.title)}</h3>
          <p class="muted">${escapeHTML(subject.group)}，共 ${questions.length} 題</p>
        </div>
        <div>
          <div class="bar"><span style="width:${rate}%"></span></div>
          <p class="muted">熟練 ${mastered} / ${questions.length} 題，${rate}%</p>
        </div>
        <div>
          <strong>${wrong}</strong>
          <span class="muted">錯題</span>
        </div>
      </article>`;
  }).join("");
}

function questionCard(question) {
  const stat = statsFor(question.id);
  return `
    <article class="question-card">
      <div class="question-meta">
        <span class="mini-tag">${question.subjectId}. ${escapeHTML(question.subject)}</span>
        <span class="mini-tag">${questionTypeLabel(question.type)}</span>
        <span class="mini-tag">原題第 ${escapeHTML(question.number)} 題</span>
        <span class="mini-tag">錯 ${stat.wrong || 0} 次</span>
      </div>
      <p>${escapeHTML(questionText(question))}</p>
      <p><strong>標準答案：</strong>${escapeHTML(answerLabel(question))}</p>
      ${explanationHTML(question)}
      <div class="card-actions">
        <span class="source-path">${escapeHTML(question.source)}</span>
      </div>
    </article>`;
}

function wrongQuestionItem(question) {
  const stat = statsFor(question.id);
  const title = `${question.subjectId}. ${question.subject} / ${questionTypeLabel(question.type)} / 原題第 ${question.number} 題`;
  return `
    <details class="wrong-item">
      <summary>
        <span>${escapeHTML(title)}</span>
        <span class="wrong-count">錯 ${stat.wrong || 0} 次</span>
      </summary>
      <div class="wrong-detail">
        ${focusGuideHTML(question)}
        <p>${annotatedText(questionText(question))}</p>
        <p><strong>標準答案：</strong>${escapeHTML(answerLabel(question))}</p>
        <p class="wrong-cause"><strong>上次錯因：</strong>${escapeHTML(stat.wrongReason || "尚未標註")}</p>
        ${explanationHTML(question)}
        <div class="card-actions">
          <span class="source-path">${escapeHTML(question.source)}</span>
        </div>
      </div>
    </details>`;
}

function renderWrongs() {
  const wrongs = QUESTIONS.filter(isWrongQuestion);
  $("#wrongList").innerHTML = wrongs.length
    ? `
      <div class="wrong-summary">共有 ${wrongs.length} 題尚未穩定；需隔日答對 2 次，系統才會自動移出。</div>
      ${wrongs.map((question) => wrongQuestionItem(question)).join("")}`
    : `<div class="empty-state"><h2>目前沒有錯題</h2><p>答錯的題目會自動出現在這裡。</p></div>`;
}

function renderBank() {
  const keyword = $("#searchInput").value.trim();
  if (!keyword) {
    $("#bankList").innerHTML = `<div class="empty-state compact"><p>輸入法條、金額、程序或關鍵字後顯示題目。</p></div>`;
    return;
  }
  const source = QUESTIONS.filter((question) => {
    const text = `${question.subject} ${question.group} ${questionText(question)} ${question.raw || ""}`;
    return text.includes(keyword);
  });
  $("#bankList").innerHTML = source.length
    ? source.slice(0, 30).map((question) => questionCard(question)).join("")
    : `<div class="empty-state compact"><p>找不到符合「${escapeHTML(keyword)}」的題目。</p></div>`;
}

function setupSelectors() {
  $("#subjectSelect").innerHTML = [
    `<option value="all">全部科目</option>`,
    ...GROUPS.map((group) => `<option value="group:${escapeHTML(group)}">${escapeHTML(group)}</option>`),
    ...SUBJECTS.map((subject) => `<option value="${subject.id}">${subject.id}. ${escapeHTML(subject.title)}</option>`),
  ].join("");
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `採購證照複習進度-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      progress = migrateProgressToCurrentBank(imported && typeof imported === "object" ? imported : {});
      saveProgress();
      renderAll();
    } catch {
      alert("匯入失敗，請確認檔案格式正確。");
    }
  };
  reader.readAsText(file);
}

function renderAll(includeBank = true) {
  renderStats();
  renderSubjectProgress();
  renderWrongs();
  if (includeBank) renderBank();
}

function bindEvents() {
  ["subjectSelect", "typeSelect", "modeSelect"].forEach((id) => {
    $(`#${id}`).addEventListener("change", updatePoolInfo);
  });
  $("#startBtn").addEventListener("click", () => startQuiz());
  $("#wrongBtn").addEventListener("click", () => startQuiz({ mode: "wrong" }));
  $("#refreshWrongBtn").addEventListener("click", renderWrongs);
  $("#searchInput").addEventListener("input", renderBank);
  $("#loginBtn")?.addEventListener("click", loginWithGoogle);
  $("#toggleEmailAuthBtn")?.addEventListener("click", toggleEmailAuthPanel);
  $("#emailLoginBtn")?.addEventListener("click", loginWithEmail);
  $("#emailRegisterBtn")?.addEventListener("click", registerWithEmail);
  $("#passwordResetBtn")?.addEventListener("click", resetEmailPassword);
  $("#logoutBtn")?.addEventListener("click", logout);
  $("#openBrowserBtn")?.addEventListener("click", openInSystemBrowser);
  $("#copySiteLinkBtn")?.addEventListener("click", copySiteLink);
  $("#exportBtn").addEventListener("click", exportProgress);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importProgress(file);
  });
  $("#clearBtn").addEventListener("click", () => {
    if (!confirm("確定要清除所有本機作答紀錄嗎？")) return;
    progress = {};
    saveProgress();
    sessionAnswers = {};
    renderAll();
    renderQuiz();
  });
}

setupSelectors();
bindEvents();
renderAll();
initFirebaseSync();
updateAuthControls();
updateBrowserHelp();
