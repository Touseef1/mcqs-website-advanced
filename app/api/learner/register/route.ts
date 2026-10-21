import type { ResultSetHeader } from "mysql2";
import { NextResponse } from "next/server";
import { createLearnerSession, hashLearnerPassword, learnerCookieOptions } from "@/lib/learner-auth";
import { db, hasDatabase } from "@/lib/db";

export async function POST(request: Request) {
  if (!hasDatabase || !db) return NextResponse.json({ error: "Learner accounts require the MySQL database. Configure it and run migration 003." }, { status: 503 });
  if (!process.env.SESSION_SECRET) return NextResponse.json({ error: "Set SESSION_SECRET in .env.local before enabling accounts." }, { status: 503 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Enter your name, email, and password." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (name.length < 2 || name.length > 140 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190 || password.length < 8 || password.length > 128) {
    return NextResponse.json({ error: "Use a name, valid email, and password of 8–128 characters." }, { status: 400 });
  }
  try {
    const [result] = await db.execute<ResultSetHeader>(
      "INSERT INTO learners (name, email, password_hash) VALUES (?, ?, ?)", [name, email, hashLearnerPassword(password)],
    );
    const principal = { id: String(result.insertId), name, email };
    const response = NextResponse.json({ learner: principal }, { status: 201 });
    response.cookies.set("mcqpath_learner", createLearnerSession(principal), learnerCookieOptions);
    return response;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "An account with that email already exists. Sign in instead." }, { status: 409 });
    console.error("Learner registration failed", error);
    return NextResponse.json({ error: "Could not create your account. Please try again." }, { status: 500 });
  }
}
