import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { createLearnerSession, learnerCookieOptions, verifyLearnerPassword, type LearnerPrincipal } from "@/lib/learner-auth";
import { db, hasDatabase } from "@/lib/db";

export async function POST(request: Request) {
  if (!hasDatabase || !db) return NextResponse.json({ error: "Learner accounts require the MySQL database. Configure it and run migration 003." }, { status: 503 });
  if (!process.env.SESSION_SECRET) return NextResponse.json({ error: "Set SESSION_SECRET in .env.local before enabling accounts." }, { status: 503 });
  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !password || email.length > 190 || password.length > 128) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  const [rows] = await db.execute<(RowDataPacket & LearnerPrincipal & { password_hash: string; status: string })[]>(
    "SELECT id, name, email, password_hash, status FROM learners WHERE email = ? LIMIT 1", [email],
  );
  const learner = rows[0];
  if (!learner || learner.status !== "active" || !verifyLearnerPassword(password, learner.password_hash)) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }
  const principal = { id: String(learner.id), name: learner.name, email: learner.email };
  const response = NextResponse.json({ learner: principal });
  response.cookies.set("mcqpath_learner", createLearnerSession(principal), learnerCookieOptions);
  return response;
}
