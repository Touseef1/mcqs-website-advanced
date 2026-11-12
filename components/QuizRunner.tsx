"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PublicQuestion } from "@/lib/data";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";
import { MCQImage } from "@/components/MCQImage";
import { LocalizedText } from "@/components/LocalizedText";
import { RichText } from "@/components/RichText";
import { SitePagination } from "@/components/SitePagination";

type QuizResult = {
  score: number;
  total: number;
  attemptHistorySaved?: boolean;
  results: Array<{
    questionId: number;
    selectedChoice: string;
    correctChoice: string;
    correct: boolean;
    explanation: string;
  }>;
};
type RevealedAnswer = { questionId: number; correctChoice: string; explanation: string };
type StudyMode = "read" | "quiz";
const PAGE_SIZE = 10;

function LearnerPagination({ currentPage, pageCount, total, onChange }: { currentPage: number; pageCount: number; total: number; onChange: (page: number) => void }) {
  return <SitePagination page={currentPage} pageCount={pageCount} pageSize={PAGE_SIZE} total={total} onPageChange={onChange} itemLabel="Questions" ariaLabel="Question pages" className="learner-pagination-wrap" />;
}

export function QuizRunner({ questions, title, quizSlug, quizPath, canBookmark = false, onRemoveQuestion, removingQuestionId }: { questions: PublicQuestion[]; title: string; quizSlug: string; quizPath?: string; canBookmark?: boolean; onRemoveQuestion?: (questionId: number) => void; removingQuestionId?: number | null }) {
  const [mode, setMode] = useState<StudyMode>("quiz");
  const [currentPage, setCurrentPage] = useState(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, RevealedAnswer>>({});
  const [pendingAnswerIds, setPendingAnswerIds] = useState<number[]>([]);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedIds, setSavedIds] = useState<number[]>([]);
  const [accountRequired, setAccountRequired] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const pageCount = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));
  const visibleQuestions = questions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const reviewQuestions = result ? questions.filter((question) => result.results.some((answer) => answer.questionId === question.id)) : [];
  const reviewPageCount = Math.max(1, Math.ceil(reviewQuestions.length / PAGE_SIZE));
  const visibleReviewQuestions = reviewQuestions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const answered = Object.keys(answers).length;
  const progress = questions.length ? Math.round((answered / questions.length) * 100) : 0;

  useEffect(() => { startedAt.current ??= Date.now(); }, []);

  useEffect(() => {
    if (mode !== "read" || questions.length === 0) return;
    const controller = new AbortController();
    const ids = questions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
      .filter((question) => !revealedAnswers[question.id]).map((question) => question.id);
    if (!ids.length) return;
    void fetch(`/api/quiz/reveal?ids=${ids.join(",")}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => parseApiResponse<{ answers: RevealedAnswer[] }>(response, "Could not load the answers."))
      .then((data) => setRevealedAnswers((current) => ({ ...current, ...Object.fromEntries(data.answers.map((answer) => [answer.questionId, answer])) })))
      .catch((cause) => { if (!controller.signal.aborted) { const message = getErrorMessage(cause, "Could not load the answers."); setError(message); notify.error(message); } });
    return () => controller.abort();
  }, [mode, currentPage, questions, revealedAnswers]);

  useEffect(() => {
    if (!canBookmark || !questions.length) return;
    const controller = new AbortController();
    void fetch(`/api/learner/bookmarks?ids=${questions.map((question) => question.id).join(",")}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return;
        const data = await parseApiResponse<{ bookmarks: Array<{ questionId: number }> }>(response, "Could not load saved questions.");
        setSavedIds(data.bookmarks.map((item) => item.questionId));
      }).catch((cause) => { if (!controller.signal.aborted) notify.error(getErrorMessage(cause, "Could not load saved questions.")); });
    return () => controller.abort();
  }, [canBookmark, questions]);

  async function toggleBookmark(questionId: number) {
    setSavingId(questionId);
    setAccountRequired(false);
    try {
      const isSaved = savedIds.includes(questionId);
      const response = await fetch("/api/learner/bookmarks", {
        method: isSaved ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      if (response.status === 401) { setAccountRequired(true); return; }
      await parseApiResponse(response, "Could not update saved questions.");
      setSavedIds((ids) => isSaved ? ids.filter((id) => id !== questionId) : [...ids, questionId]);
    } catch (bookmarkError) {
      const message = getErrorMessage(bookmarkError, "Could not update saved questions."); setError(message); notify.error(message);
    } finally {
      setSavingId(null);
    }
  }

  async function revealAnswer(questionId: number) {
    if (revealedAnswers[questionId] || pendingAnswerIds.includes(questionId)) return;
    setPendingAnswerIds((current) => [...current, questionId]);
    try {
      const response = await fetch(`/api/quiz/reveal?ids=${questionId}`, { cache: "no-store" });
      const data = await parseApiResponse<{ answers: RevealedAnswer[] }>(response, "Could not check this answer.");
      const answer = data.answers.find((item) => item.questionId === questionId);
      if (!answer?.correctChoice) throw new Error("This question is no longer available.");
      setRevealedAnswers((current) => ({ ...current, [questionId]: answer }));
    } catch (cause) {
      const message = getErrorMessage(cause, "Could not check this answer."); setError(message); notify.error(message);
    } finally {
      setPendingAnswerIds((current) => current.filter((id) => id !== questionId));
    }
  }

  function chooseAnswer(questionId: number, choice: string) {
    if (mode !== "quiz" || result || answers[questionId] || pendingAnswerIds.includes(questionId)) return;
    setAnswers((current) => ({ ...current, [questionId]: choice }));
    void revealAnswer(questionId);
  }

  function changeMode(nextMode: StudyMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setAnswers({});
    setRevealedAnswers({});
    setPendingAnswerIds([]);
    setError("");
    if (nextMode === "quiz") startedAt.current = Date.now();
  }

  async function submitQuiz() {
    if (loading || result || mode !== "quiz") return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/quiz/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: questions.filter((question) => Boolean(answers[question.id])).map((question) => ({ questionId: question.id, choice: answers[question.id] })),
          quizTitle: title,
          quizPath: quizPath ?? `/quiz/${quizSlug}`,
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)),
        }),
      });
      const data = await parseApiResponse<QuizResult>(response, "Could not submit the quiz.");
      setCurrentPage(1);
      setResult(data);
      if (data.attemptHistorySaved === false) notify.warning("Your quiz was scored, but it could not be saved to your account history.");
    } catch (submitError) {
      const message = getErrorMessage(submitError, "Could not submit the quiz."); setError(message); notify.error(message);
    } finally {
      setLoading(false);
    }
  }

  function changePage(page: number) {
    setCurrentPage(Math.max(1, Math.min(pageCount, page)));
    setError("");
  }

  function changeReviewPage(page: number) {
    setCurrentPage(Math.max(1, Math.min(reviewPageCount, page)));
    setError("");
  }

  function removeWrongQuestion(questionId: number) {
    onRemoveQuestion?.(questionId);
    setCurrentPage(1);
    setAnswers((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setRevealedAnswers((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  }

  if (!questions.length) {
    return <div className="empty-state"><span className="empty-icon">✓</span><h2>Questions are on the way</h2><p>This topic does not have published questions yet.</p></div>;
  }

  if (result) {
    return (
      <section className="quiz-result">
        <div className="result-summary">
          <span className="eyebrow">TEST COMPLETE</span>
          <h2>{result.score} <span>/ {result.total}</span></h2>
          <p className="result-percentage">{result.total ? Math.round((result.score / result.total) * 100) : 0}% correct from answered questions</p>
          <p>You answered {result.total} questions. Review the answers and explanations below.</p>
          <button className="button button-primary" onClick={() => { setAnswers({}); setResult(null); setCurrentPage(1); setMode("quiz"); setRevealedAnswers({}); startedAt.current = Date.now(); }}>Try again</button>
        </div>
        <div className="review-list">
          <h3>Answer review · questions {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, reviewQuestions.length)} of {reviewQuestions.length}</h3>
          {visibleReviewQuestions.map((question, index) => {
            const answer = result.results.find((item) => item.questionId === question.id);
            return (
              <article className="review-item" key={question.id}>
                <div className="review-heading"><span>QUESTION {String((currentPage - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}</span><b className={answer?.correct ? "status-correct" : "status-wrong"}>{answer?.correct ? "Correct" : answer ? "Review" : "Not answered"}</b></div>
                <h4><LocalizedText>{question.prompt}</LocalizedText></h4>
                {question.questionImageUrl && <MCQImage src={question.questionImageUrl} alt="Question image" size="question" />}
                <p className="question-source">Source: {question.sourceNote}</p>
                {canBookmark && <button className="question-save-button" onClick={() => void toggleBookmark(question.id)} disabled={savingId === question.id}>{savedIds.includes(question.id) ? "★ Saved question" : "☆ Save question"}</button>}
                <p className="review-answer">{answer?.selectedChoice ? `Your answer: ${answer.selectedChoice} · ` : "Not answered · "}Correct answer: {answer?.correctChoice}</p>
                <ul className="review-choice-list">{question.choices.map((choice) => <li className={choice.label === answer?.correctChoice ? "is-correct" : choice.label === answer?.selectedChoice ? "is-selected" : ""} key={choice.label}><b>{choice.label}.</b>{choice.text && <LocalizedText>{choice.text}</LocalizedText>}{choice.imageUrl && <MCQImage src={choice.imageUrl} alt={`Option ${choice.label} image`} size="option" />}</li>)}</ul>
                {(answer?.explanation || question.explanation) && <details className="question-explanation">
                  <summary>Show explanation</summary>
                  <RichText value={answer?.explanation || question.explanation} />
                </details>}
                {onRemoveQuestion && <button type="button" className="account-wrong-remove" disabled={removingQuestionId === question.id} onClick={() => removeWrongQuestion(question.id)}>{removingQuestionId === question.id ? "Removing…" : "Remove from wrong questions"}</button>}
              </article>
            );
          })}
          <LearnerPagination currentPage={currentPage} pageCount={reviewPageCount} total={reviewQuestions.length} onChange={changeReviewPage} />
        </div>
      </section>
    );
  }

  return (
    <div className="quiz-layout">
      <div className="quiz-main">
        <div className="study-mode-toolbar" role="group" aria-label="Choose study mode">
          <div><strong>Choose how to study</strong><span>{mode === "read" ? "Answers are visible as you read." : "Choose an option to reveal its answer, or submit the full set for your score."}</span></div>
          <div className="study-mode-buttons">
            <button type="button" aria-pressed={mode === "read"} className={mode === "read" ? "is-active" : ""} onClick={() => changeMode("read")}>Read mode</button>
            <button type="button" aria-pressed={mode === "quiz"} className={mode === "quiz" ? "is-active" : ""} onClick={() => changeMode("quiz")}>Quiz mode</button>
          </div>
        </div>
        {mode === "quiz" && <>
          <div className="quiz-progress-row"><span>{answered} of {questions.length} answered</span><span>{progress}% complete</span></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        </>}
        <div className="quiz-question-list">
          {visibleQuestions.map((question, index) => {
            const revealed = revealedAnswers[question.id];
            const pending = pendingAnswerIds.includes(question.id);
            const locked = mode === "quiz" && Boolean(answers[question.id]);
            const questionNumber = (currentPage - 1) * PAGE_SIZE + index + 1;
            return (
              <article className="quiz-question" key={question.id}>
                <div className="question-number">QUESTION {String(questionNumber).padStart(2, "0")} <span>{questionNumber}/{questions.length}</span></div>
                <h2><LocalizedText>{question.prompt}</LocalizedText></h2>
                {question.questionImageUrl && <MCQImage src={question.questionImageUrl} alt="Question image" size="question" />}
                <p className="question-source">Source: {question.sourceNote}</p>
                {canBookmark && <button className="question-save-button" onClick={() => void toggleBookmark(question.id)} disabled={savingId === question.id}>{savingId === question.id ? "Saving…" : savedIds.includes(question.id) ? "★ Saved question" : "☆ Save question"}</button>}
                <div className={mode === "read" ? "choice-list choice-list-readonly" : "choice-list"}>
                  {question.choices.map((choice) => {
                    const inputId = `question-${question.id}-${choice.label}`;
                    const selected = answers[question.id] === choice.label;
                    const isCorrect = revealed?.correctChoice === choice.label;
                    const isWrong = Boolean(revealed && selected && !isCorrect);
                    const classNames = ["choice-option", selected && "selected", revealed && isCorrect && "is-revealed-correct", isWrong && "is-revealed-wrong"].filter(Boolean).join(" ");
                    return <div className={classNames} key={choice.label} onClick={(event) => { if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLButtonElement)) chooseAnswer(question.id, choice.label); }}>
                      {mode === "quiz" && <input id={inputId} type="radio" name={`question-${question.id}`} aria-label={`Option ${choice.label}`} value={choice.label} checked={selected} disabled={loading || pending || locked} onChange={() => chooseAnswer(question.id, choice.label)} />}
                      <span className={`choice-label${isWrong ? " is-wrong" : ""}`}>{choice.label}</span><div className="choice-content">{choice.text && <span className="choice-text"><LocalizedText>{choice.text}</LocalizedText></span>}{choice.imageUrl && <MCQImage src={choice.imageUrl} alt={`Option ${choice.label} image`} size="option" onActivate={mode === "quiz" ? () => chooseAnswer(question.id, choice.label) : undefined} />}</div>
                    </div>;
                  })}
                </div>
                {mode === "read" && (revealed ? <div className="revealed-answer" role="status"><strong>Correct answer: {revealed.correctChoice}</strong></div> : <p className="answer-loading" role="status">{error ? "Answer could not be loaded. Refresh to try again." : "Loading answer…"}</p>)}
                {mode === "quiz" && revealed && <span className="sr-only" role="status">Answer checked.</span>}
                {question.explanation && <details className="question-explanation">
                  <summary>Show explanation</summary>
                  <RichText value={question.explanation} />
                </details>}
                {onRemoveQuestion && <button type="button" className="account-wrong-remove" disabled={removingQuestionId === question.id} onClick={() => removeWrongQuestion(question.id)}>{removingQuestionId === question.id ? "Removing…" : "Remove from wrong questions"}</button>}
              </article>
            );
          })}
        </div>
        <LearnerPagination currentPage={currentPage} pageCount={pageCount} total={questions.length} onChange={changePage} />
        {error && <p className="form-error" role="alert">{error}</p>}
        {accountRequired && <p className="form-hint">Your learner session expired. <Link href="/account">Sign in again</Link>.</p>}
        {mode === "quiz" && <div className="quiz-submit-row"><span>Your score is calculated from the questions you answer.</span><button className="button button-primary" onClick={() => void submitQuiz()} disabled={loading || answered === 0}>{loading ? "Checking…" : "Submit quiz"} <span aria-hidden>→</span></button></div>}
      </div>
      <aside className="quiz-aside">
        <span className="aside-label">STUDY SET</span>
        <h3>{title}</h3>
        <div className="aside-stat"><span>Questions</span><strong>{questions.length}</strong></div>
        <div className="aside-stat"><span>Current page</span><strong>{currentPage} / {pageCount}</strong></div>
        {mode === "quiz" && <div className="aside-stat"><span>Answered</span><strong>{answered} / {questions.length}</strong></div>}
        <p>{mode === "read" ? "Read through each question with its answer and explanation." : "Choose an answer to see the correct answer, or submit when you finish."}</p>
      </aside>
    </div>
  );
}
