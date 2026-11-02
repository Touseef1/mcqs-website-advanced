"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";

export function LearnerTokenForm({ token }: { token: string }) {
  const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/learner/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await parseApiResponse<{ message?: string }>(response, "The link could not be used."); setMessage(data.message ?? "The request succeeded.");
    } catch (cause) { const text = getErrorMessage(cause, "The request failed."); setError(text); notify.error(text); }
    finally { setBusy(false); }
  }
  return <section className="account-auth-card"><span className="eyebrow">ACCOUNT SECURITY</span><h1>Choose a new password</h1><form className="account-form" onSubmit={submit}><label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message} <Link href="/account">Go to your account</Link></p>}<button className="button button-primary" disabled={busy || !token}>{busy ? "Please wait…" : "Update password"}</button></form>{!token && <p className="form-error">This link is missing or invalid. Request a new one from your account page.</p>}</section>;
}

export function LearnerEmailAction() {
  const [email, setEmail] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/learner/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await parseApiResponse<{ message?: string }>(response, "Could not send the email."); setMessage(data.message ?? "The request succeeded.");
    } catch (cause) { const text = getErrorMessage(cause, "Could not send the email."); setError(text); notify.error(text); }
    finally { setBusy(false); }
  }
  return <section className="account-auth-card"><span className="eyebrow">ACCOUNT SECURITY</span><h1>Reset your password</h1><p>Enter the email address used for your MCQPath account.</p><form className="account-form" onSubmit={submit}><label>Email address<input type="email" autoComplete="email" maxLength={190} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}<button className="button button-primary" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button></form><p className="account-switch"><Link href="/account">Back to sign in</Link></p></section>;
}
