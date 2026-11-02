"use client";

import Link from "next/link";
import { BookOpen, Bookmark, CircleCheck, ChartNoAxesColumnIncreasing, Eye, EyeOff, ArrowRight, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { LearnerPrincipal } from "@/lib/learner-auth";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";
import { MCQImage } from "@/components/MCQImage";
import { LocalizedText } from "@/components/LocalizedText";
import { WrongQuestionsPanel } from "@/components/WrongQuestionsPanel";

type Progress = {
  summary: { attempts: number; averageScore: number; savedQuestions: number };
  attempts: Array<{ id: number; quiz_title: string; quiz_path: string; score: number; question_count: number; completed_at: string }>;
  weakTopics?: Array<{ slug: string; topic_name: string; subject_name: string; attempted: number; correct: number }>;
  subjectPerformance?: Array<{
    subjectId: number;
    subjectName: string;
    attempted: number;
    correct: number;
    percentage: number;
    topics: Array<{ id: number; slug: string; name: string; attempted: number; correct: number; percentage: number }>;
  }>;
};
type SavedQuestion = { questionId: number; topicSlug: string; prompt: string; language?: "en" | "ur"; questionImageUrl?: string | null; choices: Array<{ label: string; text: string; imageUrl?: string | null }> };

export function AccountPanel({ learner }: { learner: LearnerPrincipal | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [saved, setSaved] = useState<SavedQuestion[]>([]);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaAnswer("");
    try {
      const response = await fetch("/api/learner/captcha", { cache: "no-store" });
      const data = await parseApiResponse<{ code: string }>(response, "Could not load the security code.");
      setCaptchaCode(data.code);
    } catch (cause) {
      setCaptchaCode("");
      const text = getErrorMessage(cause, "Could not load the security code.");
      setError(text);
    }
  }, []);

  useEffect(() => {
    if (learner) return;
    const controller = new AbortController();
    void fetch("/api/learner/captcha", { cache: "no-store", signal: controller.signal })
      .then((response) => parseApiResponse<{ code: string }>(response, "Could not load the security code."))
      .then((data) => setCaptchaCode(data.code))
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setCaptchaCode("");
        setError(getErrorMessage(cause, "Could not load the security code."));
      });
    return () => controller.abort();
  }, [learner]);

  useEffect(() => {
    if (!learner) return;
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/learner/progress", { signal: controller.signal }).then((response) => parseApiResponse<Progress>(response, "Could not load your quiz history.")),
      fetch("/api/learner/bookmarks", { signal: controller.signal }).then((response) => parseApiResponse<{ bookmarks: SavedQuestion[] }>(response, "Could not load your saved questions.")),
    ]).then(([summary, bookmarks]) => {
      setProgress(summary); setSaved(bookmarks.bookmarks);
    }).catch((cause) => { if (!controller.signal.aborted) { const message = getErrorMessage(cause, "Could not load your account activity."); setError(message); notify.error(message); } });
    return () => controller.abort();
  }, [learner]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/learner/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, captchaAnswer }),
      });
      const data = await parseApiResponse<{ message?: string }>(response, "Could not sign in.");
      if (mode === "register") setMessage(data.message || "Account created. Your email is verified and you are signed in.");
      router.refresh();
    } catch (submitError) {
      const message = getErrorMessage(submitError, "Could not sign in."); setError(message); notify.error(message);
    } finally {
      setBusy(false);
      if (!learner) void refreshCaptcha();
    }
  }

  async function signOut() {
    try { const response = await fetch("/api/learner/logout", { method: "POST" }); await parseApiResponse(response, "Could not sign out."); router.refresh(); }
    catch (cause) { notify.error(getErrorMessage(cause, "Could not sign out.")); }
  }

  async function removeBookmark(questionId: number) {
    try {
      const response = await fetch("/api/learner/bookmarks", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId }),
      });
      await parseApiResponse(response, "Could not remove the saved question.");
      setSaved((items) => items.filter((item) => item.questionId !== questionId));
    } catch (cause) { notify.error(getErrorMessage(cause, "Could not remove the saved question.")); }
  }

  if (!learner) {
    return (
      <section className="learner-auth-shell">
        <aside className="learner-auth-story"><Link href="/" className="auth-wordmark">MCQPath</Link><h2>Your next step<br />starts here.</h2><ul><li><Bookmark aria-hidden="true" />Save useful questions</li><li><CircleCheck aria-hidden="true" />Review your mistakes</li><li><ChartNoAxesColumnIncreasing aria-hidden="true" />Track subject progress</li></ul><BookOpen className="auth-book-art" strokeWidth={0.8} aria-hidden="true" /></aside>
        <div className="learner-auth-form">
          <div className="auth-mode-switch" role="group" aria-label="Account access">{(["login", "register"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => { setMode(value); setError(""); setMessage(""); setShowPassword(false); void refreshCaptcha(); }}>{value === "login" ? "Sign in" : "Create account"}</button>)}</div>
          <h1>{mode === "register" ? "Create your account" : "Welcome back"}</h1><p>{mode === "register" ? "Build a study routine that works for you." : "Sign in to continue your learning journey."}</p>
          <form className="account-form" onSubmit={submit}>
            {mode === "register" && <label>Your name<input autoComplete="name" placeholder="Your name" required minLength={2} maxLength={140} value={name} onChange={event => setName(event.target.value)} /></label>}
            <label>Email address<input type="email" placeholder="you@example.com" autoComplete="email" required maxLength={190} value={email} onChange={event => setEmail(event.target.value)} /></label>
            <div><label htmlFor="learner-password">Password</label><div className="auth-password-field"><input id="learner-password" type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={mode === "register" ? "At least 8 characters" : "Enter your password"} required minLength={mode === "register" ? 8 : 1} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>{mode === "register" && <small>Use at least 8 characters.</small>}</div>
            {mode === "login" && <Link className="auth-forgot" href="/account/forgot-password">Forgot password?</Link>}
            <div className="captcha-input-group"><span className="captcha-code" role="img" aria-label={`Security code ${captchaCode || "not loaded"}`}>{captchaCode || "----"}</span><button className="captcha-refresh" type="button" aria-label="Get a new security code" onClick={() => void refreshCaptcha()}><RotateCw size={17} /></button><input id="learner-captcha" aria-label="Four-digit CAPTCHA" inputMode="numeric" pattern="[0-9]{4}" autoComplete="off" maxLength={4} placeholder="Enter 4-digit code" value={captchaAnswer} onChange={event => setCaptchaAnswer(event.target.value.replace(/\D/g, "").slice(0, 4))} required /></div>
            {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
            <button className="button button-primary" disabled={busy}>{busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}<ArrowRight size={18} aria-hidden="true" /></button>
          </form>
          {mode === "register" && <p className="auth-resend">Your email is verified automatically when you create your account.</p>}<Link className="auth-guest" href="/subjects">Continue practising without an account</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="account-dashboard">
      <div className="account-heading"><div><span className="eyebrow">YOUR STUDY SPACE</span><h1>Hello, {learner.name}</h1><p>{learner.email}</p></div><button className="button button-outline" onClick={() => void signOut()}>Sign out</button></div>
      <div className="account-metrics">
        <article><span>Quiz attempts</span><strong>{progress?.summary.attempts ?? "—"}</strong></article>
        <article><span>Average score</span><strong>{progress ? `${progress.summary.averageScore}%` : "—"}</strong></article>
        <article><span>Saved questions</span><strong>{progress?.summary.savedQuestions ?? saved.length}</strong></article>
      </div>
      <section className="account-section"><div className="account-section-heading"><div><span className="eyebrow">KEEP IMPROVING</span><h2>Recent practice</h2></div><Link href="/subjects">Find a quiz →</Link></div>
        {!progress ? <p className="account-empty">Loading your quiz history…</p> : progress.attempts.length ? <div className="account-attempt-list">{progress.attempts.map((attempt) => <article key={attempt.id}><div><strong>{attempt.quiz_title}</strong><small>{new Date(attempt.completed_at).toLocaleDateString()}</small></div><b>{attempt.score} out of {attempt.question_count}<small>{attempt.question_count ? Math.round(attempt.score / attempt.question_count * 100) : 0}%</small></b><Link href={attempt.quiz_path}>Practise again</Link></article>)}</div> : <p className="account-empty">Your completed quizzes will appear here. <Link href="/subjects">Start practising</Link></p>}
      </section>
      {!!progress?.subjectPerformance?.length && <section className="account-section"><div className="account-section-heading"><div><span className="eyebrow">YOUR PROGRESS</span><h2>Subject performance</h2></div><span>Based on answered questions</span></div><div className="subject-performance-grid">{progress.subjectPerformance.map((subject) => <article className="subject-performance-card" key={subject.subjectId}><div className="subject-performance-heading"><div><h3>{subject.subjectName}</h3><small>{subject.correct} correct out of {subject.attempted}</small></div><strong>{subject.percentage}%</strong></div><div className="subject-performance-track" role="progressbar" aria-label={`${subject.subjectName} correct answer rate`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={subject.percentage}><span style={{ width: `${subject.percentage}%` }} /></div><details className="subject-topic-breakdown"><summary>Topic breakdown ({subject.topics.length})</summary><ul>{subject.topics.map((topic) => <li key={topic.id}><span>{topic.name}</span><b>{topic.correct}/{topic.attempted} · {topic.percentage}%</b></li>)}</ul></details></article>)}</div></section>}
      {!!progress?.weakTopics?.length && <section className="account-section"><div className="account-section-heading"><div><span className="eyebrow">PERSONALIZED PRACTICE</span><h2>Topics to strengthen</h2></div></div><div className="account-attempt-list">{progress.weakTopics.map((topic) => <article key={topic.slug}><div><strong>{topic.subject_name} · {topic.topic_name}</strong><small>{topic.correct} correct out of {topic.attempted}</small></div><Link href={`/quiz/${encodeURIComponent(topic.slug)}`}>Practise topic</Link></article>)}</div></section>}
      <WrongQuestionsPanel />
      <section className="account-section"><div className="account-section-heading"><div><span className="eyebrow">REVISIT ANYTIME</span><h2>Saved questions</h2></div></div>
        {saved.length ? <div className="account-saved-list">{saved.map((question) => <article key={question.questionId}><div className="account-saved-content"><p><LocalizedText>{question.prompt}</LocalizedText></p>{question.questionImageUrl && <MCQImage src={question.questionImageUrl} alt="Question image" size="compact" />}{question.choices.map((choice) => <div className="account-saved-choice" key={choice.label}><b>{choice.label}.</b>{choice.text && <LocalizedText>{choice.text}</LocalizedText>}{choice.imageUrl && <MCQImage src={choice.imageUrl} alt={`Option ${choice.label} image`} size="compact" />}</div>)}</div><div className="account-saved-actions"><Link href={`/quiz/${encodeURIComponent(question.topicSlug)}`}>Open topic</Link><button onClick={() => void removeBookmark(question.questionId)}>Remove</button></div></article>)}</div> : <p className="account-empty">Save a question during a quiz and it will show up here.</p>}
      </section>
    </div>
  );
}
