import type { ResultSetHeader } from "mysql2";
import { NextResponse } from "next/server";
import { createLearnerSession, hashLearnerPassword, learnerCookieOptions } from "@/lib/learner-auth";
import { clearLearnerCaptchaCookie, verifyLearnerCaptcha } from "@/lib/learner-captcha";
import { db, hasDatabase } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const respond = (body: Record<string, unknown>, status = 200) => clearLearnerCaptchaCookie(NextResponse.json(body, { status }));
  const limit = await rateLimit(request, "learner-register", 5, 900);
  if (!limit.allowed) return respond({ error: "Too many registration attempts. Try again later." }, 429);
  if (!hasDatabase || !db) return respond({ error: "Learner accounts require the MySQL database. Configure it and run migration 003." }, 503);
  if (!process.env.SESSION_SECRET) return respond({ error: "Set SESSION_SECRET in .env.local before enabling accounts." }, 503);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return respond({ error: "Enter your name, email, password, and four-digit security code." }, 400);
  const input = body as Record<string, unknown>;
  if (!verifyLearnerCaptcha(request, input.captchaAnswer)) return respond({ error: "Enter the current four-digit security code." }, 400);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (name.length < 2 || name.length > 140 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190 || password.length < 8 || password.length > 128) {
    return respond({ error: "Use a name, valid email, and password of 8–128 characters." }, 400);
  }
  try {
    const [result] = await db.execute<ResultSetHeader>(
      "INSERT INTO learners (name, email, password_hash, email_verified_at) VALUES (?, ?, ?, UTC_TIMESTAMP())", [name, email, hashLearnerPassword(password)],
    );
    const learner = { id: String(result.insertId), name, email, sessionVersion: 1 };
    const response = respond({ message: "Account created. Your email is verified and you are signed in.", learner }, 201);
    response.cookies.set("mcqpath_learner", createLearnerSession(learner, 1), learnerCookieOptions);
    return response;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return respond({ error: "An account with that email already exists. Sign in instead." }, 409);
    console.error("Learner registration failed", error);
    return respond({ error: "Could not create your account. Please try again." }, 500);
  }
}
