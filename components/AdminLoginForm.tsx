"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Sign-in failed.");
      router.refresh();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form login-form" onSubmit={signIn}>
      <label htmlFor="admin-email">Email address</label>
      <input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
      <label htmlFor="admin-password">Password</label>
      <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <span aria-hidden>→</span></button>
    </form>
  );
}
