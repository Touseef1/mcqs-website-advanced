import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { createLearnerActionToken } from "@/lib/learner-auth";
import { db, hasDatabase } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limit = await rateLimit(request, "learner-password-reset", 5, 900);
  if (!limit.allowed) return NextResponse.json({ error: "Please wait before requesting another reset email." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Learner accounts require MySQL." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 190) {
    const [rows] = await db.execute<Array<RowDataPacket & { id: number; email: string; status: string }>>("SELECT id,email,status FROM learners WHERE email = ? LIMIT 1", [email]);
    if (rows[0]?.status === "active") {
      try { await createLearnerActionToken(rows[0].id, rows[0].email, "reset_password"); }
      // Keep the public response identical for known and unknown emails to prevent account enumeration.
      catch (error) { console.error("Learner reset email delivery failed", error); }
    }
  }
  return NextResponse.json({ message: "If that address belongs to an active account, a password reset link will be sent." });
}
