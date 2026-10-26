import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, createAdminSession, getAdminPrincipal, hashAdminPassword, verifyPasswordHash } from "@/lib/admin-auth";
import { auditAdmin, csrfFailure } from "@/lib/admin-security";
import { db } from "@/lib/db";

export async function PATCH(request: Request) {
  const csrf = csrfFailure(request); if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !db) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 12 || newPassword.length > 200) return NextResponse.json({ error: "Use a password between 12 and 200 characters." }, { status: 400 });
  const [rows] = await db.execute<Array<RowDataPacket & { password_hash: string; session_version: number }>>("SELECT password_hash,session_version FROM admin_users WHERE id = ?", [principal.id]);
  if (!rows[0] || !verifyPasswordHash(currentPassword, rows[0].password_hash)) return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  const nextVersion = Number(rows[0].session_version) + 1;
  await db.execute("UPDATE admin_users SET password_hash = ?, must_change_password = 0, session_version = ? WHERE id = ?", [hashAdminPassword(newPassword), nextVersion, principal.id]);
  await auditAdmin(principal, request, "password_change", "admin_user", Number(principal.id), null, { passwordChanged: true });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, createAdminSession({ ...principal, mustChangePassword: false }, nextVersion), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ADMIN_SESSION_SECONDS });
  return response;
}
