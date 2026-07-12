const DATA = window.EXAM_DATA || { questions: [], subjects: [], exam: {}, generatedAt: "" };
const STORAGE_KEY = "procurement-review-progress-v2";
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
  };
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
      lastAnswer: newer.lastAnswer || localItem.lastAnswer || cloudItem.lastAnswer || "",
      lastAt: newer.lastAt || localItem.lastAt || cloudItem.lastAt || "",
    };
  });
  return merged;
}

function updateSyncStatus(message) {
  const el = $("#syncStatus");
  if (el) el.textContent = message;
}

function updateAuthControls() {
  $("#loginBtn")?.classList.toggle("hidden", !!currentUser);
  $("#logoutBtn")?.classList.toggle("hidden", !currentUser);
}

function authErrorMessage(error) {
  const host = window.location.hostname || "目前網域";
  if (error?.code === "auth/unauthorized-domain") {
    return `登入失敗：${host} 尚未加入 Firebase 授權網域。`;
  }
  if (error?.code === "auth/operation-not-allowed") {
    return "登入失敗：Firebase 尚未啟用 Google 登入。";
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
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    firebaseDb = firebase.database();
    firebaseAuth.getRedirectResult().catch((error) => updateSyncStatus(authErrorMessage(error)));
    firebaseAuth.onAuthStateChanged((user) => {
      currentUser = user;
      cloudReady = false;
      clearTimeout(cloudSaveTimer);
      updateAuthControls();
      if (user) {
        loadProgressFromCloud(user);
        return;
      }
      updateSyncStatus("未登入，使用本機紀錄");
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
  const provider = googleProvider();
  try {
    updateSyncStatus("開啟 Google 登入...");
    await firebaseAuth.signInWithPopup(provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(error.code)) {
      updateSyncStatus("改用重新導向登入...");
      await firebaseAuth.signInWithRedirect(provider);
      return;
    }
    updateSyncStatus(authErrorMessage(error));
  }
}

async function logout() {
  if (!firebaseAuth) return;
  await firebaseAuth.signOut();
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
  return `
    <div class="explanation-block">
      <h4>詳解</h4>
      ${lawBasisHTML(question)}
    </div>`;
}

function isWrongQuestion(question) {
  const item = statsFor(question.id);
  return item.wrong > 0 && !item.mastered;
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
  if (correct) {
    item.correct += 1;
  } else {
    item.wrong += 1;
    item.mastered = false;
  }
  progress[question.id] = item;
  sessionAnswers[question.id] = { answer, correct };
  saveProgress();
  renderAll(false);
  renderQuiz();
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
      <span class="muted">已練 ${statsFor(question.id).attempts} 次</span>
    </div>
    <p class="question-stem">${escapeHTML(questionText(question))}</p>
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
      <span class="source-path">來源：${escapeHTML(question.source)}</span>
      ${explanationHTML(question)}`;
  }

  $("#prevBtn").disabled = sessionIndex === 0;
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
  const attempted = QUESTIONS.filter((question) => statsFor(question.id).attempts > 0).length;
  const wrong = QUESTIONS.filter(isWrongQuestion).length;
  $("#totalQuestions").textContent = QUESTIONS.length;
  $("#attemptedQuestions").textContent = attempted;
  $("#wrongQuestions").textContent = wrong;
  $("#placeholderCount").textContent = PLACEHOLDER_COUNT;
  $("#generatedAt").textContent = `題庫建立日期：${DATA.generatedAt || "未標示"}`;
  updatePoolInfo();
}

function renderSubjectProgress() {
  $("#subjectProgress").innerHTML = SUBJECTS.map((subject) => {
    const questions = QUESTIONS.filter((question) => question.subjectId === subject.id);
    const attempted = questions.filter((question) => statsFor(question.id).attempts > 0).length;
    const wrong = questions.filter(isWrongQuestion).length;
    const rate = questions.length ? Math.round((attempted / questions.length) * 100) : 0;
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
  renderSubjectProgress();
  renderWrongs();
  if (includeBank) renderBank();
}

function bindEvents() {
  ["subjectSelect", "typeSelect", "modeSelect", "countSelect"].forEach((id) => {
    $(`#${id}`).addEventListener("change", updatePoolInfo);
  });
  $("#startBtn").addEventListener("click", () => startQuiz());
  $("#wrongBtn").addEventListener("click", () => startQuiz({ mode: "wrong" }));
  $("#refreshWrongBtn").addEventListener("click", renderWrongs);
  $("#searchInput").addEventListener("input", renderBank);
  $("#loginBtn")?.addEventListener("click", loginWithGoogle);
  $("#logoutBtn")?.addEventListener("click", logout);
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
