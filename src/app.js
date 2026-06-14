const DATA = window.EXAM_DATA;
const QUESTIONS = DATA.questions;
const SUBJECTS = DATA.subjects;
const STORAGE_KEY = "procurement-exam-progress-v1";

let progress = loadProgress();
let session = [];
let sessionIndex = 0;
let selectedAnswer = null;
let answeredIds = new Set();
let sessionResults = [];
const tfCorrectionCache = new Map();

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
  if (question.type === "tf") return question.answer === "O" ? "O 正確" : "X 錯誤";
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
  if (question.answer === "O") {
    const result = {
      kind: "true",
      text: "原題敘述本身就是正確版本，不需要改寫；若你選 X，請回頭檢查題幹中的期限、金額、程序或法律效果是否被你誤判。",
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
    const fallback = {
      kind: "false",
      text: "這題題庫標準答案為 X，表示原題至少有一個關鍵敘述不正確；目前找不到足夠相似的正確句可自動比對，建議依來源題庫與條文檢查題幹中的期限、金額、機關、程序或法律效果。",
    };
    tfCorrectionCache.set(question.id, fallback);
    return fallback;
  }

  const parts = changedParts(question.stem, best.item.stem);
  const wrongPart = parts.wrong || question.stem;
  const correctPart = parts.correct || best.item.stem;
  const result = {
    kind: "false",
    text: `原題錯誤處：「${wrongPart}」。正確應改為：「${correctPart}」。可對照同科是非題第 ${best.item.number} 題的正確敘述。`,
    matchedQuestion: best.item,
  };
  tfCorrectionCache.set(question.id, result);
  return result;
}

function explanation(question, chosen) {
  const correct = answerText(question);
  const keywords = extractKeywords(question);
  const chosenText = chosen ? (question.type === "choice" ? `(${chosen})` : chosen) : "未作答";
  const focus = keywords.length ? `本題判斷點：${keywords.join("、")}。` : "本題重點在題幹敘述與標準答案的差異。";
  const source = `來源：${question.source}，${question.subject}第 ${question.number} 題。`;
  if (question.type === "choice") {
    return `你選 ${chosenText}，題庫標準答案是 ${correct}。${focus}選擇題建議把正確選項整句記下來，再回頭比較其他選項被改動的期限、金額、程序或效力。${source}`;
  }
  const correction = findTrueFalseCorrection(question);
  return `你選 ${chosenText}，題庫標準答案是 ${correct}。${focus}${correction.text}${source}`;
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
