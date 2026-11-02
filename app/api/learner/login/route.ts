import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { createLearnerSession, learnerCookieOptions, verifyLearnerPassword, type LearnerPrincipal } from "@/lib/learner-auth";
import { db, hasDatabase } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { clearLearnerCaptchaCookie, verifyLearnerCaptcha } from "@/lib/learner-captcha";

export async function POST(request: Request) {
  const respond = (body: Record<string, unknown>, status = 200, headers?: HeadersInit) => clearLearnerCaptchaCookie(NextResponse.json(body, { status, headers }));
  const limit = await rateLimit(request, "learner-login", 8, 900);
  if (!limit.allowed) return respond({ error: "Too many sign-in attempts. Try again later." }, 429, { "Retry-After": String(limit.retryAfter) });
  if (!hasDatabase || !db) return respond({ error: "Learner accounts require the MySQL database. Configure it and run migration 003." }, 503);
  if (!process.env.SESSION_SECRET) return respond({ error: "Set SESSION_SECRET in .env.local before enabling accounts." }, 503);
  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!verifyLearnerCaptcha(request, input.captchaAnswer)) return respond({ error: "Enter the current four-digit security code." }, 400);
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !password || email.length > 190 || password.length > 128) return respond({ error: "Enter your email and password." }, 400);
  const [rows] = await db.execute<(RowDataPacket & LearnerPrincipal & { password_hash: string; status: string; email_verified_at: string | null; sessionVersion: number })[]>(
    "SELECT id, name, email, password_hash, status, session_version AS sessionVersion FROM learners WHERE email = ? LIMIT 1", [email],
  );
  const learner = rows[0];
  if (!learner || learner.status !== "active" || !verifyLearnerPassword(password, learner.password_hash)) {
    return respond({ error: "Email or password is incorrect." }, 401);
  }
  const principal = { id: String(learner.id), name: learner.name, email: learner.email, sessionVersion: Number(learner.sessionVersion) };
  const response = respond({ learner: principal }, 200, { "Cache-Control": "no-store" });
  response.cookies.set("mcqpath_learner", createLearnerSession(principal, principal.sessionVersion), learnerCookieOptions);
  return response;
}
