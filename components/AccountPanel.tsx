"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { LearnerPrincipal } from "@/lib/learner-auth";

type Progress = {
  summary: { attempts: number; averageScore: number; savedQuestions: number };
  attempts: Array<{ id: number; quiz_title: string; quiz_path: string; score: number; question_count: number; completed_at: string }>;
};
type SavedQuestion = { questionId: number; topicSlug: string; prompt: string; choices: Array<{ label: string; text: string }> };

export function AccountPanel({ learner }: { learner: LearnerPrincipal | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [saved, setSaved] = useState<SavedQuestion[]>([]);

  useEffect(() => {
    if (!learner) return;
    void Promise.all([
      fetch("/api/learner/progress").then((response) => response.ok ? response.json() as Promise<Progress> : null),
      fetch("/api/learner/bookmarks").then((response) => response.ok ? response.json() as Promise<{ bookmarks: SavedQuestion[] }> : null),
    ]).then(([summary, bookmarks]) => {
      if (summary) setProgress(summary);
      if (bookmarks) setSaved(bookmarks.bookmarks);
    }).catch(() => setError("Could not load your account activity."));
  }, [learner]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/learner/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not sign in.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/learner/logout", { method: "POST" });
    router.refresh();
  }

  async function removeBookmark(questionId: number) {
    const response = await fetch("/api/learner/bookmarks", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId }),
    });
    if (response.ok) setSaved((items) => items.filter((item) => item.questionId !== questionId));
  }

  if (!learner) {
    return (
      <section className="account-auth-card">
        <span className="eyebrow">YOUR STUDY SPACE</span>
        <h1>{mode === "register" ? "Create your free account" : "Welcome back"}</h1>
        <p>Save useful questions and keep track of your practice results.</p>
        <form className="account-form" onSubmit={submit}>
          {mode === "register" && <label>Your name<input autoComplete="name" required minLength={2} maxLength={140} value={name} onChange={(event) => setName(event.target.value)} /></label>}
          <label>Email address<input type="email" autoComplete="email" required maxLength={190} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 8 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />{mode === "register" && <small>Use at least 8 characters.</small>}</label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={busy}>{busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}<span aria-hidden>→</span></button>
        </form>
        <p className="account-switch">{mode === "register" ? "Already have an account?" : "New to MCQPath?"} <button onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>{mode === "register" ? "Sign in" : "Create an account"}</button></p>
        <p className="account-note">You can still practise quizzes without an account.</p>
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
        {!progress ? <p className="account-empty">Loading your quiz history…</p> : progress.attempts.length ? <div className="account-attempt-list">{progress.attempts.map((attempt) => <article key={attempt.id}><div><strong>{attempt.quiz_title}</strong><small>{new Date(attempt.completed_at).toLocaleDateString()}</small></div><b>{attempt.score}/{attempt.question_count}<small>{attempt.question_count ? Math.round(attempt.score / attempt.question_count * 100) : 0}%</small></b><Link href={attempt.quiz_path}>Practise again</Link></article>)}</div> : <p className="account-empty">Your completed quizzes will appear here. <Link href="/subjects">Start practising</Link></p>}
      </section>
      <section className="account-section"><div className="account-section-heading"><div><span className="eyebrow">REVISIT ANYTIME</span><h2>Saved questions</h2></div></div>
        {saved.length ? <div className="account-saved-list">{saved.map((question) => <article key={question.questionId}><div><p>{question.prompt}</p><small>{question.choices.map((choice) => `${choice.label}. ${choice.text}`).join(" · ")}</small></div><div className="account-saved-actions"><Link href={`/quiz/${encodeURIComponent(question.topicSlug)}`}>Open topic</Link><button onClick={() => void removeBookmark(question.questionId)}>Remove</button></div></article>)}</div> : <p className="account-empty">Save a question during a quiz and it will show up here.</p>}
      </section>
    </div>
  );
}
