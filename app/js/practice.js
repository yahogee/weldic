/* Practice mode: the caller's clumsy words are shown, and the learner picks
   which kind of request it really is. Questions are generated from the call data
   (call types' "heard" phrases and real cases), so new data means new questions. */
import { el } from "./render.js";
import { showLinked } from "./work-render.js";
import { callDetail } from "./call-render.js";

const QUESTIONS_PER_ROUND = 10;     // 한 번 연습할 때 나오는 문제 수
const OPTIONS_PER_QUESTION = 4;     // 보기 개수 (정답 1 + 오답 3)
const EXPLAIN_ASK_COUNT = 3;        // 해설에 보여 줄 "되물을 질문" 개수

/** Fisher-Yates shuffle returning a new array. `random` is injectable for tests. */
export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/** Build a list of questions { phrase, answerId, optionIds } from the call data. */
export function buildQuestions(calls, count = QUESTIONS_PER_ROUND, random = Math.random) {
  const pool = [];
  calls.types.forEach((type) => type.heard.forEach((phrase) => pool.push({ phrase, answerId: type.id })));
  calls.cases.filter((entry) => entry.call_type).forEach((entry) => pool.push({ phrase: entry.heard, answerId: entry.call_type }));
  const typeIds = calls.types.map((type) => type.id);
  return shuffle(pool, random).slice(0, count).map((question) => {
    const wrong = shuffle(typeIds.filter((id) => id !== question.answerId), random).slice(0, OPTIONS_PER_QUESTION - 1);
    return { ...question, optionIds: shuffle([question.answerId, ...wrong], random) };
  });
}

/** The practice screen. `onExit` returns to the call list. */
export function practiceView(store, onExit) {
  const root = el("div", "practice-view");
  const { types } = store.work.calls;
  const titleOf = (id) => (types.find((type) => type.id === id) || { title: id }).title;
  // 보기에는 괄호 설명(정답 힌트가 들어 있음)을 뺀 짧은 이름만 보여 줌
  const optionLabel = (id) => titleOf(id).replace(/\s*\(.*\)\s*$/, "");
  let questions = [];
  let index = 0;
  let correctCount = 0;
  let wrongList = [];

  function exitButton() {
    const button = el("button", "btn back", "← 전화 목록으로");
    button.type = "button";
    button.addEventListener("click", onExit);
    return button;
  }

  function start() {
    questions = buildQuestions(store.work.calls);
    index = 0;
    correctCount = 0;
    wrongList = [];
    showQuestion();
  }

  function showQuestion() {
    root.replaceChildren(exitButton());
    if (questions.length === 0) {
      root.append(el("p", "empty", "연습할 자료가 없어요"));
      return;
    }
    const question = questions[index];
    root.append(el("p", "note", `문제 ${index + 1} / ${questions.length}`));
    root.append(el("h2", "section-title", "전화가 와서 이렇게 말해요. 어떤 요청일까요?"));
    root.append(el("blockquote", "quiz-phrase", `“${question.phrase}”`));
    const options = el("div", "quiz-options");
    const feedback = el("div", "quiz-feedback");
    question.optionIds.forEach((id) => {
      const button = el("button", "quiz-option", optionLabel(id));
      button.type = "button";
      button.addEventListener("click", () => answer(question, id, options, feedback));
      options.append(button);
    });
    root.append(options, feedback);
  }

  /** Mark the answer (text marks, not only colour) and show the explanation. */
  function answer(question, chosenId, options, feedback) {
    const right = chosenId === question.answerId;
    if (right) correctCount += 1;
    else wrongList.push(question);
    [...options.children].forEach((button, position) => {
      const id = question.optionIds[position];
      button.disabled = true;
      if (id === question.answerId) {
        button.classList.add("correct");
        button.textContent = `✓ ${optionLabel(id)}`;
      } else if (id === chosenId) {
        button.classList.add("wrong");
        button.textContent = `✗ ${optionLabel(id)}`;
      }
    });
    const type = types.find((item) => item.id === question.answerId);
    feedback.replaceChildren(el("p", "quiz-verdict", right ? "맞아요!" : `아니에요. 정답은 “${titleOf(question.answerId)}”`));
    feedback.append(el("h3", "", "사실은 이런 요청"), el("p", "gloss", type.real_need));
    const asks = (type.ask || []).slice(0, EXPLAIN_ASK_COUNT);
    if (asks.length > 0) {
      feedback.append(el("h3", "", "이렇게 되물어 보세요"));
      const list = el("ul", "plain-list");
      asks.forEach((text) => list.append(el("li", "", text)));
      feedback.append(list);
    }
    const detail = el("button", "btn", "응대 카드 자세히 보기");
    detail.type = "button";
    detail.addEventListener("click", () => showLinked(root, callDetail(type, store)));
    const next = el("button", "btn", index + 1 < questions.length ? "다음 문제 →" : "결과 보기");
    next.type = "button";
    next.addEventListener("click", () => {
      index += 1;
      if (index < questions.length) showQuestion();
      else showResult();
    });
    const row = el("div", "button-row");
    row.append(detail, next);
    feedback.append(row);
    next.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showResult() {
    root.replaceChildren(exitButton());
    root.append(el("h2", "", `${questions.length}문제 중 ${correctCount}개 맞았어요`));
    if (wrongList.length > 0) {
      root.append(el("h3", "", "다시 보면 좋은 것"));
      const list = el("ul", "plain-list");
      wrongList.forEach((question) => list.append(el("li", "", `“${question.phrase}” → ${titleOf(question.answerId)}`)));
      root.append(list);
    }
    const again = el("button", "btn", "한 번 더 연습하기");
    again.type = "button";
    again.addEventListener("click", start);
    root.append(again);
  }

  start();
  return root;
}
