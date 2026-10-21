"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PublicQuestion } from "@/lib/data";

type QuizResult = {
  score: number;
  total: number;
  results: Array<{
    questionId: number;
    selectedChoice: string;
    correctChoice: string;
    correct: boolean;
    explanation: string;
  }>;
};

export function QuizRunner({ questions, title, quizSlug, quizPath }: { questions: PublicQuestion[]; title: string; quizSlug: string; quizPath?: string }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(questions.length * 60);
  const [error, setError] = useState("");
  const [savedIds, setSavedIds] = useState<number[]>([]);
  const [accountRequired, setAccountRequired] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const answered = Object.keys(answers).length;
  const progress = questions.length ? Math.round((answered / questions.length) * 100) : 0;
  const clock = useMemo(() => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`, [seconds]);

  useEffect(() => {
    if (result || questions.length === 0) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [result, questions.length]);

  useEffect(() => {
    if (!questions.length) return;
    void fetch(`/api/learner/bookmarks?ids=${questions.map((question) => question.id).join(",")}`)
      .then(async (response) => {
        if (response.status === 401) return;
        if (!response.ok) return;
        const data = await response.json() as { bookmarks: Array<{ questionId: number }> };
        setSavedIds(data.bookmarks.map((item) => item.questionId));
      }).catch(() => undefined);
  }, [questions]);

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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update saved questions.");
      setSavedIds((ids) => isSaved ? ids.filter((id) => id !== questionId) : [...ids, questionId]);
    } catch (bookmarkError) {
      setError(bookmarkError instanceof Error ? bookmarkError.message : "Could not update saved questions.");
    } finally {
      setSavingId(null);
    }
  }

  useEffect(() => {
    if (seconds === 0 && !result && !loading) void submitQuiz();
    // submitQuiz is intentionally invoked once when the timer reaches zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, result, loading]);

  async function submitQuiz() {
    if (loading || result) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/quiz/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: questions.map((question) => ({ questionId: question.id, choice: answers[question.id] ?? "" })),
          quizTitle: title,
          quizPath: quizPath ?? `/quiz/${quizSlug}`,
          elapsedSeconds: Math.max(0, questions.length * 60 - seconds),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not submit the quiz.");
      setResult(data as QuizResult);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit the quiz.");
    } finally {
      setLoading(false);
    }
  }

  if (!questions.length) {
    return <div className="empty-state"><span className="empty-icon">✓</span><h2>Questions are on the way</h2><p>This topic does not have published questions yet.</p></div>;
  }

  if (result) {
    return (
      <section className="quiz-result">
        <div className="result-summary">
          <span className="eyebrow">TEST COMPLETE</span>
          <h2>{result.score} <span>/ {questions.length}</span></h2>
          <p>You answered {result.total} of {questions.length} questions. Review the explanations below to strengthen your understanding.</p>
          <button className="button button-primary" onClick={() => { setAnswers({}); setResult(null); setSeconds(questions.length * 60); }}>Try again</button>
        </div>
        <div className="review-list">
          <h3>Answer review</h3>
          {questions.map((question, index) => {
            const answer = result.results.find((item) => item.questionId === question.id);
            return (
              <article className="review-item" key={question.id}>
                <div className="review-heading"><span>QUESTION {String(index + 1).padStart(2, "0")}</span><b className={answer?.correct ? "status-correct" : "status-wrong"}>{answer?.correct ? "Correct" : answer ? "Review" : "Not answered"}</b></div>
                <h4>{question.prompt}</h4>
                <p className="question-source">Source: {question.sourceNote}</p>
                <button className="question-save-button" onClick={() => void toggleBookmark(question.id)} disabled={savingId === question.id}>{savedIds.includes(question.id) ? "★ Saved question" : "☆ Save question"}</button>
                <p className="review-answer">{answer?.selectedChoice ? `Your answer: ${answer.selectedChoice} · ` : "Not answered · "}Correct answer: {answer?.correctChoice}</p>
                <p>{answer?.explanation ?? "You skipped this question. Review the correct answer and explanation."}</p>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="quiz-layout">
      <div className="quiz-main">
        <div className="quiz-progress-row"><span>{answered} of {questions.length} answered</span><span className="timer"><span aria-hidden>◷</span> {clock}</span></div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
        <div className="quiz-question-list">
          {questions.map((question, index) => (
            <article className="quiz-question" key={question.id}>
              <div className="question-number">QUESTION {String(index + 1).padStart(2, "0")} <span>{index + 1}/{questions.length}</span></div>
              <h2>{question.prompt}</h2>
              <p className="question-source">Source: {question.sourceNote}</p>
              <button className="question-save-button" onClick={() => void toggleBookmark(question.id)} disabled={savingId === question.id}>{savingId === question.id ? "Saving…" : savedIds.includes(question.id) ? "★ Saved question" : "☆ Save question"}</button>
              <div className="choice-list">
                {question.choices.map((choice) => (
                  <label className={answers[question.id] === choice.label ? "choice-option selected" : "choice-option"} key={choice.label}>
                    <input type="radio" name={`question-${question.id}`} value={choice.label} checked={answers[question.id] === choice.label} onChange={() => setAnswers((current) => ({ ...current, [question.id]: choice.label }))} />
                    <span className="choice-label">{choice.label}</span><span>{choice.text}</span>
                  </label>
                ))}
              </div>
            </article>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {accountRequired && <p className="form-hint">Create an account to save questions. <Link href="/account">Go to your account →</Link></p>}
        <div className="quiz-submit-row"><span>Answers are checked when you submit.</span><button className="button button-primary" onClick={() => void submitQuiz()} disabled={loading}>{loading ? "Checking…" : "Submit test"} <span aria-hidden>→</span></button></div>
      </div>
      <aside className="quiz-aside">
        <span className="aside-label">YOUR TEST</span>
        <h3>{title}</h3>
        <div className="aside-stat"><span>Questions</span><strong>{questions.length}</strong></div>
        <div className="aside-stat"><span>Time limit</span><strong>{Math.max(1, questions.length)} min</strong></div>
        <div className="aside-stat"><span>Answered</span><strong>{answered} / {questions.length}</strong></div>
        <p>Take your time. Read each question carefully and review the explanations after submitting.</p>
      </aside>
    </div>
  );
}
