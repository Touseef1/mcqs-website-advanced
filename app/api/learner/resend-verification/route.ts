import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { createLearnerActionToken } from "@/lib/learner-auth";
import { db, hasDatabase } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limit = await rateLimit(request, "learner-verify-resend", 5, 900);
  if (!limit.allowed) return NextResponse.json({ error: "Please wait before requesting another verification email." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Learner accounts require MySQL." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 190) {
    const [rows] = await db.execute<Array<RowDataPacket & { id: number; email: string; status: string; email_verified_at: string | null }>>("SELECT id,email,status,email_verified_at FROM learners WHERE email = ? LIMIT 1", [email]);
    if (rows[0]?.status === "active" && !rows[0].email_verified_at) {
      // Keep the public response identical for known and unknown emails to prevent account enumeration.
      try { await createLearnerActionToken(rows[0].id, rows[0].email, "verify_email"); } catch (error) { console.error("Verification email delivery failed", error); }
    }
  }
  return NextResponse.json({ message: "If the address needs verification, a new email will be sent." });
}
