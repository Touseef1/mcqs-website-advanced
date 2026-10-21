import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  adminLoginConfigured,
  createAdminSession,
  verifyBootstrapPassword,
  verifyPasswordHash,
  type AdminPrincipal,
} from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

export async function POST(request: Request) {
  if (!adminLoginConfigured()) {
    return NextResponse.json({ error: "Set ADMIN_PASSWORD and SESSION_SECRET in .env.local first." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  let principal: AdminPrincipal | null = null;

  if (email && password && verifyBootstrapPassword(email, password)) {
    principal = { id: "env-root", name: "Bootstrap Super Admin", email, role: "super_admin" };
  } else if (email && password && hasDatabase && db) {
    const [users] = await db.execute<Array<RowDataPacket & { id: number; name: string; email: string; role: AdminPrincipal["role"]; password_hash: string; status: string }>>(
      "SELECT id, name, email, role, password_hash, status FROM admin_users WHERE email = ? LIMIT 1",
      [email],
    );
    const user = users[0];
    if (user?.status === "active" && verifyPasswordHash(password, user.password_hash)) {
      principal = { id: String(user.id), name: user.name, email: user.email, role: user.role };
    }
  }

  if (!principal) {
    return NextResponse.json({ error: "The email or password is incorrect." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, createAdminSession(principal), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });
  return response;
}
