import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission, hashAdminPassword, type AdminRole } from "@/lib/admin-auth";
import { safeRole } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";

import { auditAdmin, csrfFailure } from "@/lib/admin-security";
function unavailable() {
  return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 });
}

function userName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "user.manage")) return NextResponse.json({ error: "Only admins can manage user accounts." }, { status: 403 });
  if (!hasDatabase || !db) return unavailable();
  const [users] = await db.execute<Array<RowDataPacket & { id: number; name: string; email: string; role: AdminRole; status: string; created_at: string; last_login_at: string | null }>>(
    principal.role === "super_admin"
      ? "SELECT id, name, email, role, status, created_at, last_login_at FROM admin_users ORDER BY created_at DESC, id DESC"
      : "SELECT id, name, email, role, status, created_at, last_login_at FROM admin_users WHERE role != 'super_admin' ORDER BY created_at DESC, id DESC",
  );
  return NextResponse.json({ users: users.map((user) => ({ ...user, id: String(user.id) })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "user.manage")) return NextResponse.json({ error: "Only admins can create user accounts." }, { status: 403 });
  if (!hasDatabase || !db) return unavailable();
  const body = await request.json().catch(() => null);
  const name = userName(body?.name);
  const email = userName(body?.email).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role;
  if (name.length < 2 || name.length > 140 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190 || password.length < 12 || password.length > 200 || !safeRole(role)) {
    return NextResponse.json({ error: "Enter a name, valid email, role, and a password with at least 12 characters." }, { status: 400 });
  }
  if (role === "super_admin" && principal.role !== "super_admin") return NextResponse.json({ error: "Only a Super Admin can create another Super Admin." }, { status: 403 });
  if (role === "admin" && principal.role !== "super_admin") return NextResponse.json({ error: "Only a Super Admin can assign the Admin role." }, { status: 403 });
  try {
    const [insert] = await db.execute("INSERT INTO admin_users (name, email, password_hash, role, status, must_change_password) VALUES (?, ?, ?, ?, 'active', 1)", [name, email, hashAdminPassword(password), role]);
    await auditAdmin(principal, request, "create", "admin_user", Number((insert as { insertId: number }).insertId), null, { name, email, role, status: "active" });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "An account already uses that email address." }, { status: 409 });
    console.error("Admin user creation failed", error);
    return NextResponse.json({ error: "The user account could not be created." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "user.manage")) return NextResponse.json({ error: "Only admins can update user accounts." }, { status: 403 });
  if (!hasDatabase || !db) return unavailable();
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const name = userName(body?.name);
  const email = userName(body?.email).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role;
  const status = body?.status === "inactive" ? "inactive" : body?.status === "active" ? "active" : "";
  if (!Number.isInteger(id) || id < 1 || name.length < 2 || name.length > 140 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190 || !safeRole(role) || !status || (password && (password.length < 12 || password.length > 200))) {
    return NextResponse.json({ error: "Enter valid account details. A new password must have at least 12 characters." }, { status: 400 });
  }
  if (String(id) === principal.id && (status !== "active" || role !== principal.role || Boolean(password))) return NextResponse.json({ error: "You cannot disable or change the role of your own account." }, { status: 400 });
  if (role === "super_admin" && principal.role !== "super_admin") return NextResponse.json({ error: "Only a Super Admin can create another Super Admin." }, { status: 403 });
  if (role === "admin" && principal.role !== "super_admin") return NextResponse.json({ error: "Only a Super Admin can assign the Admin role." }, { status: 403 });
  try {
    const sql = password
      ? "UPDATE admin_users SET name = ?, email = ?, password_hash = ?, must_change_password = 1, role = ?, status = ?, session_version = session_version + 1 WHERE id = ?"
      : "UPDATE admin_users SET name = ?, email = ?, role = ?, status = ?, session_version = session_version + 1 WHERE id = ?";
    const values = password
      ? [name, email, hashAdminPassword(password), role, status, id]
      : [name, email, role, status, id];
    const [exists] = await db.execute<Array<RowDataPacket & { id: number; role: AdminRole }>>("SELECT id, role FROM admin_users WHERE id = ? LIMIT 1", [id]);
    if (!exists[0]) return NextResponse.json({ error: "User account not found." }, { status: 404 });
    if ((exists[0].role === "admin" || exists[0].role === "super_admin") && principal.role !== "super_admin") return NextResponse.json({ error: "Only the bootstrap super admin can update Admin accounts." }, { status: 403 });
    await db.execute(sql, values);
    await auditAdmin(principal, request, "update", "admin_user", id, { role: exists[0].role }, { name, email, role, status, passwordReset: Boolean(password) });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "An account already uses that email address." }, { status: 409 });
    console.error("Admin user update failed", error);
    return NextResponse.json({ error: "The user account could not be updated." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
