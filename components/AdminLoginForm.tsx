"use client";

import { RotateCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshCaptcha() {
    setCaptchaAnswer("");
    try {
      const response = await fetch("/api/admin/captcha", { cache: "no-store" });
      const data = await parseApiResponse<{ code: string }>(response, "Could not load the security code.");
      setCaptchaCode(data.code);
    } catch (cause) {
      setCaptchaCode("");
      const message = getErrorMessage(cause, "Could not load the security code.");
      setError(message);
    }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/captcha", { cache: "no-store" })
      .then((response) => parseApiResponse<{ code: string }>(response, "Could not load the security code."))
      .then((data) => { if (active) setCaptchaCode(data.code); })
      .catch((cause) => {
        if (!active) return;
        setCaptchaCode("");
        setError(getErrorMessage(cause, "Could not load the security code."));
      });
    return () => { active = false; };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, captchaAnswer }),
      });
      await parseApiResponse(response, "Sign-in failed.");
      router.refresh();
    } catch (signInError) {
      const message = getErrorMessage(signInError, "Sign-in failed."); setError(message); notify.error(message);
    } finally {
      setBusy(false);
      void refreshCaptcha();
    }
  }

  return (
    <form className="admin-form login-form admin-login-form" onSubmit={signIn}>
      <label htmlFor="admin-email">Email address</label>
      <input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="name@company.com" required />
      <label htmlFor="admin-password">Password</label>
      <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" required />
      <div className="admin-captcha-row"><div className="admin-captcha-code" role="img" aria-label={`Security code ${captchaCode || "not loaded"}`}>{captchaCode || "----"}</div><button className="admin-captcha-refresh" type="button" aria-label="Get a new security code" onClick={() => void refreshCaptcha()}><RotateCw size={18} /></button><input id="admin-captcha-answer" aria-label="Four-digit CAPTCHA" type="text" inputMode="numeric" pattern="[0-9]{4}" autoComplete="off" maxLength={4} placeholder="Enter 4-digit code" value={captchaAnswer} onChange={(event) => setCaptchaAnswer(event.target.value.replace(/\D/g, "").slice(0, 4))} required /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <span aria-hidden>→</span></button>
    </form>
  );
}
