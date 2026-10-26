import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { hashLearnerActionToken, hashLearnerPassword } from "@/lib/learner-auth";
import { db, hasDatabase } from "@/lib/db";

export async function POST(request: Request) {
  if (!hasDatabase || !db) return NextResponse.json({ error: "Learner accounts require MySQL." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 128) return NextResponse.json({ error: "Use a password of 8–128 characters." }, { status: 400 });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<Array<RowDataPacket & { id: number; learner_id: number }>>(
      "SELECT id, learner_id FROM learner_action_tokens WHERE token_hash = ? AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE", [hashLearnerActionToken(token)],
    );
    if (!rows[0]) { await connection.rollback(); return NextResponse.json({ error: "This reset link is invalid or expired." }, { status: 400 }); }
    await connection.execute("UPDATE learners SET password_hash = ?, session_version = session_version + 1 WHERE id = ?", [hashLearnerPassword(password), rows[0].learner_id]);
    await connection.execute("UPDATE learner_action_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?", [rows[0].id]);
    await connection.commit();
    return NextResponse.json({ message: "Password updated. Sign in with your new password." });
  } catch (error) { await connection.rollback(); console.error("Learner password reset failed", error); return NextResponse.json({ error: "Could not update the password." }, { status: 500 }); }
  finally { connection.release(); }
}
