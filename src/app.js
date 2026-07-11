const DATA = window.EXAM_DATA || { questions: [], subjects: [], exam: {}, generatedAt: "" };
const STORAGE_KEY = "procurement-review-progress-v2";
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
      <span class="source-path">來源：${escapeHTML(question.source)}</span>`;
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
      <div class="card-actions">
        <span class="source-path">${escapeHTML(question.source)}</span>
        ${options.master ? `<button data-master="${question.id}" type="button">標記熟練</button>` : ""}
      </div>
    </article>`;
}

function renderWrongs() {
  const wrongs = QUESTIONS.filter(isWrongQuestion);
  $("#wrongList").innerHTML = wrongs.length
    ? wrongs.slice(0, 200).map((question) => questionCard(question, { master: true })).join("")
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
