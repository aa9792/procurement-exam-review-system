const DATA = window.EXAM_DATA || { questions: [], subjects: [], exam: {}, generatedAt: "" };
const GAME_RULES = window.GAME_RULES || {
  CLEAR_RATE: 80,
  BOSS_LIVES: 3,
  comboMultiplier: (value) => (value >= 10 ? 2 : value >= 5 ? 1.5 : value >= 3 ? 1.25 : 1),
  passed: (rate, answered, total) => total > 0 && answered === total && rate >= 80,
  levelForXp: (xp) => Math.floor(Number(xp || 0) / 100) + 1,
};
const STORAGE_KEY = "procurement-review-progress-v2";
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

let progress = loadProgress();
let session = [];
let sessionIndex = 0;
let sessionAnswers = {};
let sessionMode = "practice";
let sessionStartedAt = 0;
let combo = 0;
let maxSessionCombo = 0;
let bossLives = 3;
let bossHp = 10;
let activeSkills = {};
let eliminatedChoice = "";
let insightActive = false;
let hintVisible = false;
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

function statsFor(id) {
  return progress[id] || {
    attempts: 0,
    correct: 0,
    wrong: 0,
    mastered: false,
    lastAnswer: "",
    lastAt: "",
  };
}

function normalizeProgressItem(item = {}) {
  return {
    attempts: Number(item.attempts || 0),
    correct: Number(item.correct || 0),
    wrong: Number(item.wrong || 0),
    mastered: !!item.mastered,
    lastAnswer: item.lastAnswer || "",
    lastAt: item.lastAt || "",
    assistedCorrect: Number(item.assistedCorrect || 0),
    cleanCorrect: Number(item.cleanCorrect || 0),
  };
}

function mergeProgress(localProgress = {}, cloudProgress = {}) {
  const merged = {};
  const ids = new Set([...Object.keys(localProgress || {}), ...Object.keys(cloudProgress || {})]);
  ids.forEach((id) => {
    if (id === "__game") {
      const localGame = localProgress?.__game || {};
      const cloudGame = cloudProgress?.__game || {};
      merged.__game = {
        ...cloudGame,
        ...localGame,
        xp: Math.max(Number(localGame.xp || 0), Number(cloudGame.xp || 0)),
        bestCombo: Math.max(Number(localGame.bestCombo || 0), Number(cloudGame.bestCombo || 0)),
        badges: { ...(cloudGame.badges || {}), ...(localGame.badges || {}) },
        chapterRates: { ...(cloudGame.chapterRates || {}), ...(localGame.chapterRates || {}) },
        confused: { ...(cloudGame.confused || {}), ...(localGame.confused || {}) },
        daily: { ...(cloudGame.daily || {}), ...(localGame.daily || {}) },
      };
      return;
    }
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
      lastAnswer: newer.lastAnswer || localItem.lastAnswer || cloudItem.lastAnswer || "",
      lastAt: newer.lastAt || localItem.lastAt || cloudItem.lastAt || "",
      assistedCorrect: Math.max(localItem.assistedCorrect, cloudItem.assistedCorrect),
      cleanCorrect: Math.max(localItem.cleanCorrect, cloudItem.cleanCorrect),
    };
  });
  return merged;
}

function gameState() {
  const raw = progress.__game || {};
  return {
    xp: Number(raw.xp || 0),
    bestCombo: Number(raw.bestCombo || 0),
    badges: raw.badges || {},
    chapterRates: raw.chapterRates || {},
    confused: raw.confused || {},
    assistedCorrect: Number(raw.assistedCorrect || 0),
    cleanCorrect: Number(raw.cleanCorrect || 0),
    daily: raw.daily || {},
    lastSubject: raw.lastSubject || "02",
  };
}

function updateGameState(patch) {
  const current = gameState();
  progress.__game = { ...current, ...patch };
  saveProgress();
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
      appVersion: "review-progress-v2",
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
    progress = mergeProgress(progress, cloudProgress);
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
  return `${questionText(question)} ${question.raw || ""} ${correctOption} ${question.subject}`;
}

function procurementActLink(article) {
  return `https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=A0030057&flno=${encodeURIComponent(article)}`;
}

function extractExplicitLawReferences(question) {
  const text = textForLawBasis(question);
  const refs = [];
  const rangeRegex = /(政府採購法|採購法)第\s*(\d+(?:之\d+)?)\s*條\s*(?:至|到|-)\s*第?\s*(\d+(?:之\d+)?)\s*條/g;
  const articleRegex = /(政府採購法|採購法)第\s*(\d+(?:之\d+)?)\s*條/g;
  let match;
  while ((match = rangeRegex.exec(text))) {
    refs.push({
      label: `政府採購法第 ${match[2]} 條至第 ${match[3]} 條`,
      url: procurementActLink(match[2]),
    });
  }
  while ((match = articleRegex.exec(text))) {
    const label = `政府採購法第 ${match[2]} 條`;
    if (!refs.some((ref) => ref.label === label)) refs.push({ label, url: procurementActLink(match[2]) });
  }
  [
    "政府採購法施行細則",
    "招標期限標準",
    "押標金保證金暨其他擔保作業辦法",
    "最有利標評選辦法",
    "採購評選委員會組織準則",
    "採購評選委員會審議規則",
    "採購契約要項",
    "電子採購作業辦法",
    "機關委託技術服務廠商評選及計費辦法",
  ].forEach((name) => {
    if (text.includes(name) && !refs.some((ref) => ref.label === name)) refs.push({ label: name });
  });
  return refs.slice(0, 4);
}

function inferLawBasis(question) {
  const text = textForLawBasis(question);
  const rules = [
    { match: /異議|招標文件異議|採購申訴/, basis: "政府採購法第 74 條至第 86 條之 1：招標、審標、決標爭議的異議與申訴制度。" },
    { match: /申訴|審議判斷|採購申訴審議/, basis: "政府採購法第 75 條至第 86 條之 1及採購申訴審議相關規定：申訴期間、審議程序與判斷效力。" },
    { match: /調解|仲裁|履約爭議/, basis: "政府採購法第 85 條之 1至第 85 條之 4：履約爭議的調解、仲裁與後續處理。" },
    { match: /停權|刊登|政府採購公報|拒絕往來|第101|第 101/, basis: "政府採購法第 101 條至第 103 條：通知廠商、刊登政府採購公報及停權期間效果。" },
    { match: /罰則|圍標|借牌|綁標|刑責|第87|第 87/, basis: "政府採購法第 87 條至第 92 條：圍標、借牌、強迫、詐術等違法行為及罰則。" },
    { match: /押標金|保證金|不予發還|追繳/, basis: "政府採購法第 30 條、第 31 條及押標金保證金暨其他擔保作業辦法：押標金、保證金與追繳/不發還事由。" },
    { match: /底價|標價偏低|比減價|減價|超底價/, basis: "政府採購法第 46 條至第 58 條及施行細則決標規定：底價訂定、價格分析、減價與決標程序。" },
    { match: /最有利標|評選|優勝廠商|協商|序位法/, basis: "政府採購法第 52 條、第 56 條、最有利標評選辦法及採購評選委員會相關規定：評選、協商與決標依據。" },
    { match: /招標|公告|等標|公開招標|選擇性招標|限制性招標|廠商資格/, basis: "政府採購法第 18 條至第 38 條、施行細則及招標期限標準：招標方式、公告、等標期與投標資格。" },
    { match: /決標|開標|審標|廢標|保留決標/, basis: "政府採購法第 45 條至第 62 條及施行細則決標規定：開標、審標、決標與廢標處理。" },
    { match: /履約|驗收|保固|查驗|初驗|複驗/, basis: "政府採購法第 63 條至第 73 條及施行細則履約驗收規定：契約履行、驗收、保固與付款。" },
    { match: /轉包|分包|連帶責任/, basis: "政府採購法第 65 條至第 67 條：轉包禁止、分包管理與得標廠商責任。" },
    { match: /契約|契約變更|違約金|物價調整|契約價金/, basis: "政府採購法第 63 條、第 64 條、採購契約要項及工程採購契約範本：契約文件、變更、價金與違約責任。" },
    { match: /電子|電子領標|電子投標|電子採購網|電子報價/, basis: "電子採購作業辦法及政府電子採購網作業規定：電子領標、投標、報價與系統紀錄效力。" },
    { match: /技術服務|服務費用|建築師|監造|設計服務/, basis: "機關委託技術服務廠商評選及計費辦法：技術服務廠商評選、計費與履約管理。" },
    { match: /統包|設計施工|功能需求/, basis: "統包實施辦法、政府採購法及工程採購契約相關規定：統包需求、評選與履約責任。" },
  ];
  return rules.filter((rule) => rule.match.test(text)).map((rule) => rule.basis).slice(0, 3);
}

function defaultSubjectLawBasis(question) {
  const subject = subjectInfo(question);
  const focus = subject.articleFocus || `${question.subject}相關採購法規、子法及作業規範。`;
  const source = sourceFileName(question.source);
  return [
    `本科法規主軸：${focus}`,
    `題庫依據：${source} 原題第 ${question.number} 題的標準答案。`,
  ];
}

function lawBasisHTML(question) {
  const explicitRefs = extractExplicitLawReferences(question);
  const inferred = inferLawBasis(question);
  const defaultBasis = defaultSubjectLawBasis(question);
  const items = [
    ...explicitRefs.map((ref) =>
      ref.url
        ? `<a class="law-link" href="${escapeHTML(ref.url)}" target="_blank" rel="noopener">${escapeHTML(ref.label)}</a>`
        : escapeHTML(ref.label)
    ),
    ...inferred.map(escapeHTML),
    ...defaultBasis.map(escapeHTML),
  ];
  const unique = [...new Set(items)].slice(0, 6);
  return `
    <div class="law-basis">
      <strong>法規依據：</strong>
      <ul>${unique.map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>`;
}

function explanationHTML(question) {
  const subject = subjectInfo(question);
  const points = extractReviewPoints(question);
  const intent = choiceIntent(question);
  const isPrecise = !!(question.preciseExplanation || question.isBoss || question.boss);
  const reason =
    question.preciseExplanation ||
    (question.type === "choice"
      ? `${intent.detail} 本題依題庫標準答案，應選「${answerLabel(question)}」。`
      : `本題敘述依題庫標準答案判定為「${answerLabel(question)}」，複習時請先確認主詞、條件及法律效果是否全部成立。`);
  const misconception =
    question.misconception ||
    (points.length
      ? `常見失誤是只看到「${points.slice(0, 2).join("、")}」就作答，忽略題目是否要求找出例外、錯誤敘述或特定程序階段。`
      : "常見失誤是只記住結論，卻忽略題目的主詞、適用條件與例外規定。");
  const memory = question.memoryTip || subject.notes?.[0] || subject.articleFocus || "先判斷採購階段，再核對條件與法律效果。";
  return `
    <div class="explanation-block">
      <span class="explanation-tier">${isPrecise ? "精準解析 · 已標記核心題" : "章節提示 · 待逐題人工校對"}</span>
      <h4>${isPrecise ? "解題解析" : "本題複習線索"}</h4>
      <p><strong>為什麼：</strong>${escapeHTML(reason)}</p>
      <p><strong>常見迷思：</strong>${escapeHTML(misconception)}</p>
      ${points.length ? `<div class="review-points">${points.map((point) => `<span>${escapeHTML(point)}</span>`).join("")}</div>` : ""}
      <p><strong>速記：</strong>${escapeHTML(memory)}</p>
      ${lawBasisHTML(question)}
    </div>`;
}

function isWrongQuestion(question) {
  const item = statsFor(question.id);
  return (item.wrong > 0 && !item.mastered) || !!gameState().confused[question.id];
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
  $("#poolInfo").textContent = `目前條件：${pool.length} 題；未練 ${unseen} 題；錯題 ${wrong} 題。`;
}

function pickQuestions() {
  const mode = $("#modeSelect").value;
  const count = Number($("#countSelect").value || 20);
  let pool = filteredQuestions();

  if (mode === "wrong") {
    pool = pool.filter(isWrongQuestion);
  } else if (mode === "unseen") {
    const unseen = shuffle(pool.filter((question) => !statsFor(question.id).attempts));
    const seen = shuffle(pool.filter((question) => statsFor(question.id).attempts));
    pool = [...unseen, ...seen];
  } else {
    pool = shuffle(pool);
  }

  return pool.filter((question) => !isPlaceholderQuestion(question)).slice(0, count);
}

function selectedSubjectId() {
  const value = $("#subjectSelect").value;
  if (SUBJECTS.some((subject) => subject.id === value)) return value;
  return gameState().lastSubject || SUBJECTS[0]?.id;
}

function subjectBossUnlocked(subjectId) {
  return Number(gameState().chapterRates[subjectId] || 0) >= 80;
}

function bossQuestionPool(subjectId) {
  const pool = QUESTIONS.filter((question) => question.subjectId === subjectId);
  const wrong = shuffle(pool.filter(isWrongQuestion));
  const core = pool.filter((question) => question.isBoss || question.boss || question.importance === "high");
  const misconception = pool.filter((question) => /不得|應|非|錯誤|期限|金額|日|年/.test(questionText(question)));
  return [...new Map([...wrong, ...shuffle(core), ...shuffle(misconception), ...shuffle(pool)].map((question) => [question.id, question])).values()].slice(0, 10);
}

function resetBattleState(mode) {
  sessionMode = mode;
  sessionIndex = 0;
  sessionAnswers = {};
  sessionStartedAt = Date.now();
  combo = 0;
  maxSessionCombo = 0;
  bossLives = 3;
  bossHp = session.length;
  activeSkills = { eliminate: 1, hint: 2, shield: 1, insight: 1 };
  eliminatedChoice = "";
  insightActive = false;
  hintVisible = false;
}

function startQuiz(overrides = {}) {
  if (overrides.subject) $("#subjectSelect").value = overrides.subject;
  if (overrides.mode) $("#modeSelect").value = overrides.mode;
  const mode = overrides.boss ? "boss" : "practice";
  const subjectId = selectedSubjectId();
  if (mode === "boss") {
    if (!subjectBossUnlocked(subjectId)) {
      alert("先在此科一般關卡取得 80% 以上正確率，才能挑戰章末 Boss。");
      return;
    }
    session = bossQuestionPool(subjectId);
  } else {
    session = pickQuestions();
  }
  updateGameState({ lastSubject: subjectId });
  resetBattleState(mode);
  sessionIndex = 0;
  $("#quizIntro").classList.add("hidden");
  $("#quizArea").classList.remove("hidden");
  renderQuiz();
  renderStats();
}

function recordAnswer(question, answer) {
  if (sessionAnswers[question.id]) return;
  const correct = answer === question.answer;
  const usedSkill = !!activeSkills.currentAssisted;
  const shielded = !correct && sessionMode === "boss" && activeSkills.shield?.armed;
  if (correct) {
    combo += 1;
    maxSessionCombo = Math.max(maxSessionCombo, combo);
    if (sessionMode === "boss") bossHp = Math.max(0, bossHp - 1);
  } else {
    combo = 0;
    if (sessionMode === "boss" && !shielded) bossLives = Math.max(0, bossLives - 1);
  }
  const multiplier = GAME_RULES.comboMultiplier(combo);
  const earnedXp = correct ? Math.round(10 * multiplier) : 2;
  const item = normalizeProgressItem(progress[question.id]);
  item.attempts += 1;
  item.lastAnswer = answer;
  item.lastAt = new Date().toISOString();
  if (correct) {
    item.correct += 1;
    item.assistedCorrect = Number(item.assistedCorrect || 0) + (usedSkill ? 1 : 0);
    item.cleanCorrect = Number(item.cleanCorrect || 0) + (usedSkill ? 0 : 1);
  } else {
    item.wrong += 1;
    item.mastered = false;
  }
  progress[question.id] = item;
  const game = gameState();
  const today = new Date().toISOString().slice(0, 10);
  const daily = { ...game.daily };
  daily[today] = Number(daily[today] || 0) + 1;
  progress.__game = {
    ...game,
    xp: game.xp + earnedXp,
    bestCombo: Math.max(game.bestCombo, maxSessionCombo),
    assistedCorrect: game.assistedCorrect + (correct && usedSkill ? 1 : 0),
    cleanCorrect: game.cleanCorrect + (correct && !usedSkill ? 1 : 0),
    daily,
  };
  sessionAnswers[question.id] = { answer, correct, usedSkill, shielded, earnedXp, combo };
  if (activeSkills.shield) activeSkills.shield.armed = false;
  Object.values(activeSkills).forEach((skill) => { if (skill && typeof skill === "object") skill.usedOnCurrent = false; });
  saveProgress();
  renderAll(false);
  renderQuiz();
}

function highlightQuestionText(text) {
  const escaped = escapeHTML(text);
  if (!insightActive) return escaped;
  return escaped.replace(/(應|得|不得|非屬|錯誤|正確|\d+\s*(?:日|天|個月|年|%|％|萬元|億元))/g, "<mark>$1</mark>");
}

function useSkill(name, question) {
  if (sessionAnswers[question.id] || !activeSkills[name] || activeSkills[name] <= 0) return;
  if (name === "eliminate") {
    const choices = question.type === "choice"
      ? question.options.map((_, index) => String(index + 1)).filter((value) => value !== question.answer)
      : [];
    if (!choices.length) return;
    eliminatedChoice = choices[Math.floor(Math.random() * choices.length)];
  }
  if (name === "hint") hintVisible = true;
  if (name === "shield") activeSkills.shield = { armed: true, usedOnCurrent: true };
  if (name === "insight") insightActive = true;
  if (typeof activeSkills[name] === "number") activeSkills[name] -= 1;
  if (typeof activeSkills[name] === "number") activeSkills[`${name}Used`] = (activeSkills[`${name}Used`] || 0) + 1;
  activeSkills[name] = typeof activeSkills[name] === "object" ? activeSkills[name] : activeSkills[name];
  activeSkills.currentAssisted = true;
  renderQuiz();
}

function skillCount(name) {
  return typeof activeSkills[name] === "number" ? activeSkills[name] : activeSkills[name]?.armed ? 0 : 0;
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
  const subject = subjectInfo(question);
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
    <div class="battle-hud">
      <div class="battle-title">
        <strong>${sessionMode === "boss" ? `BOSS · ${escapeHTML(question.subject)}` : "一般關卡"}</strong>
        <span class="muted">${sessionMode === "boss" ? "章末能力檢定" : "累積 80% 正確率解鎖 Boss"}</span>
      </div>
      <div class="hud-stats">
        <span class="hud-stat">🔥 Combo <b>${combo}</b></span>
        <span class="hud-stat">最高 <b>${maxSessionCombo}</b></span>
        ${sessionMode === "boss" ? `<span class="hud-stat">生命 <b>${"♥".repeat(bossLives)}${"♡".repeat(3 - bossLives)}</b></span>` : ""}
      </div>
      ${sessionMode === "boss" ? `<div class="boss-health"><span>BOSS HP</span><div class="bar"><span style="width:${Math.round((bossHp / session.length) * 100)}%"></span></div><strong>${bossHp} / ${session.length}</strong></div>` : ""}
    </div>
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
      <span class="muted">已練 ${statsFor(question.id).attempts} 次</span>
    </div>
    <p class="question-stem">${highlightQuestionText(questionText(question))}</p>
    <div class="skill-bar" aria-label="角色技能">
      <button class="skill-button" data-skill="eliminate" type="button" ${result || question.type !== "choice" || skillCount("eliminate") < 1 ? "disabled" : ""}>⚔ 刪去術 ×${skillCount("eliminate")}</button>
      <button class="skill-button" data-skill="hint" type="button" ${result || skillCount("hint") < 1 ? "disabled" : ""}>⌘ 法典提示 ×${skillCount("hint")}</button>
      <button class="skill-button ${activeSkills.shield?.armed ? "used" : ""}" data-skill="shield" type="button" ${result || sessionMode !== "boss" || activeSkills.shield?.armed ? "disabled" : ""}>◇ 守護盾 ×${activeSkills.shield?.armed ? 0 : 1}</button>
      <button class="skill-button ${insightActive ? "used" : ""}" data-skill="insight" type="button" ${result || insightActive || skillCount("insight") < 1 ? "disabled" : ""}>◎ 洞察 ×${skillCount("insight")}</button>
    </div>
    ${hintVisible && !result ? `<div class="hint-box"><strong>法典提示：</strong>${escapeHTML(subject.articleFocus || subject.notes?.[0] || "先判斷本題所屬採購階段，再注意條件與例外。")}</div>` : ""}
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
    button.textContent = choice.label;
    if (!result && choice.value === eliminatedChoice) {
      button.disabled = true;
      button.classList.add("is-eliminated");
    }
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
      <div class="feedback-banner">
        <strong>${result.correct ? "答對，攻擊成功！" : result.shielded ? "答錯，但守護盾擋下傷害。" : "答錯，記住這個陷阱。"}</strong>
        <span class="feedback-rewards">+${result.earnedXp} XP · ${result.combo >= 2 ? `${result.combo} COMBO` : "連擊重新累積"}</span>
      </div>
      你的答案：${escapeHTML(answerLabel(question, result.answer))}<br>
      標準答案：${escapeHTML(answerLabel(question))}<br>
      <span class="mini-tag">${result.correct ? (result.usedSkill ? "輔助答對" : "完全答對") : "加入錯題營地"}</span><br>
      <span class="source-path">來源：${escapeHTML(question.source)}</span>
      ${explanationHTML(question)}`;
    $("#answerBox").insertAdjacentHTML("beforeend", `<button id="confusedBtn" class="confused" type="button">仍不懂，加入待複習</button>`);
    $("#confusedBtn").addEventListener("click", () => {
      const game = gameState();
      updateGameState({ confused: { ...game.confused, [question.id]: true } });
      $("#confusedBtn").textContent = "已加入待複習";
      $("#confusedBtn").disabled = true;
    });
  }

  area.querySelectorAll("[data-skill]").forEach((button) => {
    button.addEventListener("click", () => useSkill(button.dataset.skill, question));
  });
  $("#prevBtn").disabled = sessionIndex === 0;
  $("#prevBtn").addEventListener("click", () => {
    sessionIndex -= 1;
    eliminatedChoice = "";
    insightActive = false;
    hintVisible = false;
    renderQuiz();
  });
  $("#nextBtn").addEventListener("click", () => {
    if (sessionMode === "boss" && bossLives === 0) {
      renderSessionResult();
      return;
    }
    if (sessionIndex < session.length - 1) {
      sessionIndex += 1;
      eliminatedChoice = "";
      insightActive = false;
      hintVisible = false;
      activeSkills.currentAssisted = false;
      renderQuiz();
      return;
    }
    renderSessionResult();
  });
}

function renderSessionResult() {
  const answered = Object.values(sessionAnswers);
  const correct = answered.filter((item) => item.correct).length;
  const rate = session.length ? Math.round((correct / session.length) * 100) : 0;
  const elapsed = Math.max(1, Math.round((Date.now() - sessionStartedAt) / 60000));
  const subjectId = selectedSubjectId();
  const game = gameState();
  const passed = GAME_RULES.passed(rate, answered.length, session.length);
  const chapterRates = { ...game.chapterRates };
  const badges = { ...game.badges };
  if (sessionMode === "practice") chapterRates[subjectId] = Math.max(Number(chapterRates[subjectId] || 0), rate);
  if (sessionMode === "boss" && passed) badges[subjectId] = true;
  progress.__game = { ...game, chapterRates, badges, xp: game.xp + (passed ? (sessionMode === "boss" ? 100 : 30) : 0) };
  saveProgress();
  $("#quizArea").innerHTML = `
    <div class="empty-state">
      <span class="seal">${passed ? "CLEAR" : "RETRY"}</span>
      <h2>${passed ? (sessionMode === "boss" ? "Boss 擊破，徽章入手！" : "關卡通過，Boss 已解鎖！") : "尚未達到 80% 通關門檻"}</h2>
      <p>${passed ? "很好，把今天的手感帶進下一場戰役。" : "系統已把錯題送回營地，針對弱點再練一回就能更接近通關。"}</p>
      <div class="result-grid">
        <div><span>正確率</span><strong>${rate}%</strong></div>
        <div><span>最高連擊</span><strong>${maxSessionCombo}</strong></div>
        <div><span>作答時間</span><strong>${elapsed} 分</strong></div>
        <div><span>技能使用</span><strong>${answered.filter((item) => item.usedSkill).length}</strong></div>
      </div>
      <div class="card-actions">
        <button id="againBtn" class="primary" type="button">再練一回</button>
        <button id="reviewWrongSessionBtn" type="button">練錯題</button>
        ${sessionMode === "practice" && passed ? `<button id="resultBossBtn" class="boss-button" type="button">挑戰 Boss</button>` : ""}
      </div>
    </div>`;
  $("#againBtn").addEventListener("click", () => startQuiz());
  $("#reviewWrongSessionBtn").addEventListener("click", () => startQuiz({ mode: "wrong" }));
  $("#resultBossBtn")?.addEventListener("click", () => startQuiz({ boss: true }));
  renderAll(false);
}

function renderStats() {
  const attempted = QUESTIONS.filter((question) => statsFor(question.id).attempts > 0).length;
  const wrong = QUESTIONS.filter(isWrongQuestion).length;
  const game = gameState();
  const level = GAME_RULES.levelForXp(game.xp);
  const levelXp = game.xp % 100;
  const badgeCount = Object.values(game.badges).filter(Boolean).length;
  const totalCorrect = game.cleanCorrect + game.assistedCorrect;
  const mastery = totalCorrect ? Math.round((game.cleanCorrect / Math.max(attempted, 1)) * 100) : 0;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = Number(game.daily[today] || 0);
  const examDate = new Date(`${DATA.exam?.date || "2026-08-02"}T00:00:00`);
  const days = Math.max(0, Math.ceil((examDate - new Date()) / 86400000));
  const rank = level >= 20 ? "S" : level >= 15 ? "A" : level >= 10 ? "B" : level >= 6 ? "C" : level >= 3 ? "D" : "F";
  const titles = ["法典新兵", "程序斥候", "招標騎士", "履約守衛", "採購賢者"];
  const weak = SUBJECTS.map((subject) => {
    const qs = QUESTIONS.filter((question) => question.subjectId === subject.id);
    const attempts = qs.reduce((sum, question) => sum + statsFor(question.id).attempts, 0);
    const errors = qs.reduce((sum, question) => sum + statsFor(question.id).wrong, 0);
    return { title: subject.title, errors, attempts };
  }).filter((item) => item.errors).sort((a, b) => (b.errors / Math.max(b.attempts, 1)) - (a.errors / Math.max(a.attempts, 1)))[0];
  $("#totalQuestions").textContent = QUESTIONS.length;
  $("#attemptedQuestions").textContent = attempted;
  $("#wrongQuestions").textContent = wrong;
  $("#placeholderCount").textContent = PLACEHOLDER_COUNT;
  $("#heroLevel").textContent = `Lv. ${level} ${titles[Math.min(titles.length - 1, Math.floor((level - 1) / 4))]}`;
  $("#rankBadge").textContent = `RANK ${rank}`;
  $("#xpLabel").textContent = `${levelXp} / 100 XP`;
  $("#xpBar").style.width = `${levelXp}%`;
  $("#bestCombo").textContent = game.bestCombo;
  $("#badgeCount").textContent = `${badgeCount} / ${SUBJECTS.length}`;
  $("#masteryRate").textContent = `${Math.min(100, mastery)}%`;
  $("#countdownDays").textContent = days;
  $("#dailyBar").style.width = `${Math.min(100, (todayCount / 20) * 100)}%`;
  $("#dailyLabel").textContent = `${Math.min(todayCount, 20)} / 20`;
  $("#dailyMission").textContent = todayCount >= 20 ? "今日任務完成！" : "完成 20 題練習";
  $("#weakSubject").textContent = weak ? weak.title : "尚未發現，先開始一回練習";
  $("#generatedAt").textContent = `題庫建立日期：${DATA.generatedAt || "未標示"}`;
  updatePoolInfo();
}

function renderChapterMap() {
  const game = gameState();
  $("#chapterMap").innerHTML = SUBJECTS.map((subject) => {
    const rate = Number(game.chapterRates[subject.id] || 0);
    const cleared = !!game.badges[subject.id];
    const unlocked = rate >= 80;
    return `
      <article class="chapter-card ${cleared ? "is-clear" : unlocked ? "is-boss" : ""} ${game.lastSubject === subject.id ? "selected" : ""}" data-chapter="${subject.id}" tabindex="0" role="button" aria-label="選擇 ${escapeHTML(subject.title)}">
        <span class="chapter-no">CH. ${subject.id}</span>
        <h3>${escapeHTML(subject.title)}</h3>
        <p>${escapeHTML(subject.group)}</p>
        <div class="bar"><span style="width:${rate}%"></span></div>
        <footer><span>${rate}%</span><span>${cleared ? "徽章已取得" : unlocked ? "Boss 已解鎖" : "修練中"}</span></footer>
      </article>`;
  }).join("");
  $$("[data-chapter]").forEach((card) => {
    const select = () => {
      $("#subjectSelect").value = card.dataset.chapter;
      updateGameState({ lastSubject: card.dataset.chapter });
      updatePoolInfo();
      renderChapterMap();
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
    });
  });
}

function renderSubjectProgress() {
  const game = gameState();
  $("#subjectProgress").innerHTML = SUBJECTS.map((subject) => {
    const questions = QUESTIONS.filter((question) => question.subjectId === subject.id);
    const attempted = questions.filter((question) => statsFor(question.id).attempts > 0).length;
    const wrong = questions.filter(isWrongQuestion).length;
    const rate = questions.length ? Math.round((attempted / questions.length) * 100) : 0;
    const clearRate = Number(game.chapterRates[subject.id] || 0);
    const badge = !!game.badges[subject.id];
    return `
      <article class="subject-row">
        <div>
          <h3>${subject.id}. ${escapeHTML(subject.title)}</h3>
          <p class="muted">${escapeHTML(subject.group)}，共 ${questions.length} 題</p>
        </div>
        <div>
          <div class="bar"><span style="width:${rate}%"></span></div>
          <p class="muted">${attempted} / ${questions.length} 題，${rate}%</p>
        </div>
        <div>
          <strong>${wrong}</strong>
          <span class="muted">錯題</span>
        </div>
        <div class="status">${badge ? "◆ Boss 通關" : clearRate >= 80 ? "Boss 已解鎖" : `最佳 ${clearRate}%`}</div>
      </article>`;
  }).join("");
}

function questionCard(question, options = {}) {
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
        ${options.master ? `<button data-master="${question.id}" type="button">標記熟練</button>` : ""}
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
        <p>${escapeHTML(questionText(question))}</p>
        <p><strong>標準答案：</strong>${escapeHTML(answerLabel(question))}</p>
        ${explanationHTML(question)}
        <div class="card-actions">
          <span class="source-path">${escapeHTML(question.source)}</span>
          <button data-master="${question.id}" type="button">標記熟練</button>
        </div>
      </div>
    </details>`;
}

function renderWrongs() {
  const wrongs = QUESTIONS.filter(isWrongQuestion);
  $("#wrongList").innerHTML = wrongs.length
    ? `
      <div class="wrong-summary">共有 ${wrongs.length} 題待複習，點開題目列可查看內容與答案。</div>
      ${wrongs.map((question) => wrongQuestionItem(question)).join("")}`
    : `<div class="empty-state"><h2>目前沒有錯題</h2><p>答錯的題目會自動出現在這裡。</p></div>`;
  $$("[data-master]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = normalizeProgressItem(progress[button.dataset.master]);
      item.mastered = true;
      progress[button.dataset.master] = item;
      const game = gameState();
      const confused = { ...game.confused };
      delete confused[button.dataset.master];
      progress.__game = { ...game, confused };
      saveProgress();
      renderAll();
    });
  });
}

function renderBank() {
  const keyword = $("#searchInput").value.trim();
  const source = keyword
    ? QUESTIONS.filter((question) => {
        const text = `${question.subject} ${question.group} ${questionText(question)} ${question.raw || ""}`;
        return text.includes(keyword);
      })
    : QUESTIONS;
  $("#bankList").innerHTML = source.slice(0, 80).map((question) => questionCard(question)).join("");
}

function setupSelectors() {
  $("#subjectSelect").innerHTML = [
    `<option value="all">全部科目</option>`,
    ...GROUPS.map((group) => `<option value="group:${escapeHTML(group)}">${escapeHTML(group)}</option>`),
    ...SUBJECTS.map((subject) => `<option value="${subject.id}">${subject.id}. ${escapeHTML(subject.title)}</option>`),
  ].join("");
  if (SUBJECTS.some((subject) => subject.id === gameState().lastSubject)) {
    $("#subjectSelect").value = gameState().lastSubject;
  }
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
      progress = imported && typeof imported === "object" ? imported : {};
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
  renderChapterMap();
  renderSubjectProgress();
  renderWrongs();
  if (includeBank) renderBank();
}

function bindEvents() {
  ["subjectSelect", "typeSelect", "modeSelect", "countSelect"].forEach((id) => {
    $(`#${id}`).addEventListener("change", updatePoolInfo);
  });
  $("#subjectSelect").addEventListener("change", () => {
    const value = $("#subjectSelect").value;
    if (SUBJECTS.some((subject) => subject.id === value)) {
      updateGameState({ lastSubject: value });
      renderChapterMap();
    }
  });
  $("#startBtn").addEventListener("click", () => startQuiz());
  $("#bossBtn").addEventListener("click", () => startQuiz({ boss: true }));
  $("#wrongBtn").addEventListener("click", () => startQuiz({ mode: "wrong" }));
  $("#continueBtn").addEventListener("click", () => {
    $("#subjectSelect").value = gameState().lastSubject;
    startQuiz();
    $("#practice").scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
