import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, adminLoginConfigured, createAdminSession, hashAdminPassword, verifyBootstrapPassword, verifyPasswordHash, type AdminPrincipal } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

import { auditAdmin, csrfFailure } from "@/lib/admin-security";
function clientIp(request: Request) { const value = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"; return /^[0-9a-f:.]{3,45}$/i.test(value) ? value : "unknown"; }
export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  if (!adminLoginConfigured() || !hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL, apply migrations through 009, then set ADMIN_PASSWORD and SESSION_SECRET." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const ip = clientIp(request);
  const [attempts] = await db.execute<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM admin_login_attempts WHERE created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND succeeded = 0 AND (email = ? OR ip = ?)", [email.slice(0,190), ip],
  );
  if (Number(attempts[0]?.count ?? 0) >= 10) return NextResponse.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });

  // On the first database-backed login, persist the environment bootstrap account for auditability.
  if (verifyBootstrapPassword(email, password)) {
    await db.execute(
      `INSERT INTO admin_users (name,email,password_hash,role,status,must_change_password)
       VALUES ('Bootstrap Super Admin', ?, ?, 'super_admin', 'active', 1)
       ON DUPLICATE KEY UPDATE email = VALUES(email)`,
      [email, hashAdminPassword(password)],
    );
  }
  const [users] = await db.execute<Array<RowDataPacket & { id: number; name: string; email: string; role: AdminPrincipal["role"]; password_hash: string; status: string; session_version: number; must_change_password: number; failed_login_attempts: number; locked_until: Date | null }>>(
    "SELECT id,name,email,role,password_hash,status,session_version,must_change_password,failed_login_attempts,locked_until FROM admin_users WHERE email = ? LIMIT 1", [email],
  );
  const user = users[0];
  if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) return NextResponse.json({ error: "This account is temporarily locked. Try again later." }, { status: 429 });
  const success = Boolean(user && user.status === "active" && verifyPasswordHash(password, user.password_hash));
  await db.execute("INSERT INTO admin_login_attempts (email,ip,succeeded) VALUES (?,?,?)", [email.slice(0,190), ip, success ? 1 : 0]);
  if (!success || !user) {
    if (user) await db.execute("UPDATE admin_users SET failed_login_attempts = failed_login_attempts + 1, locked_until = IF(failed_login_attempts >= 5, DATE_ADD(NOW(), INTERVAL 15 MINUTE), locked_until) WHERE id = ?", [user.id]);
    return NextResponse.json({ error: "The email or password is incorrect." }, { status: 401 });
  }
  await db.execute("UPDATE admin_users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP() WHERE id = ?", [user.id]);
  const principal: AdminPrincipal = { id: String(user.id), name: user.name, email: user.email, role: user.role, mustChangePassword: Boolean(user.must_change_password) };
  await auditAdmin(principal, request, "login", "admin_user", Number(principal.id), null, { email });
  const response = NextResponse.json({ ok: true, mustChangePassword: principal.mustChangePassword });
  response.cookies.set(ADMIN_COOKIE, createAdminSession(principal, Number(user.session_version)), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ADMIN_SESSION_SECONDS });
  return response;
}
