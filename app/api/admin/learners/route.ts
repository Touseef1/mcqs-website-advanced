import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { auditAdmin, csrfFailure } from "@/lib/admin-security";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";
import { hashLearnerPassword } from "@/lib/learner-auth";

const PAGE_SIZE = 25;

function unavailable() {
  return NextResponse.json({ error: "Configure MySQL and apply the learner account migrations first." }, { status: 503 });
}

function normalizedName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validProfile(name: string, email: string) {
  return name.length >= 2 && name.length <= 140 && email.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function authorized() {
  const principal = await getAdminPrincipal();
  return principal && requirePermission(principal, "user.manage") ? principal : null;
}

export async function GET(request: Request) {
  const principal = await authorized();
  if (!principal) return NextResponse.json({ error: "You do not have permission to manage learner accounts." }, { status: 403 });
  if (!hasDatabase || !db) return unavailable();

  const params = new URL(request.url).searchParams;
  const query = (params.get("search") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const where = query ? "WHERE name LIKE ? OR email LIKE ?" : "";
  const values = query ? [`%${query}%`, `%${query}%`] : [];
  const [countRows] = await db.execute<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total FROM learners ${where}`, values,
  );
  const total = Number(countRows[0]?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const [learners] = await db.execute<Array<RowDataPacket & {
    id: number; name: string; email: string; status: "active" | "inactive"; created_at: string; email_verified_at: string | null;
  }>>(
    `SELECT id, name, email, status, created_at, email_verified_at FROM learners ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...values, PAGE_SIZE, (currentPage - 1) * PAGE_SIZE],
  );

  return NextResponse.json({ learners: learners.map((learner) => ({ ...learner, id: String(learner.id) })), total, page: currentPage, pageSize: PAGE_SIZE, pageCount }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await authorized();
  if (!principal) return NextResponse.json({ error: "You do not have permission to create learner accounts." }, { status: 403 });
  if (!hasDatabase || !db) return unavailable();

  const body = await request.json().catch(() => null);
  const name = normalizedName(body?.name);
  const email = normalizedEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!validProfile(name, email) || password.length < 8 || password.length > 128) {
    return NextResponse.json({ error: "Enter a name, valid email, and password of 8–128 characters." }, { status: 400 });
  }

  try {
    const [result] = await db.execute<ResultSetHeader>(
      "INSERT INTO learners (name, email, password_hash, email_verified_at) VALUES (?, ?, ?, UTC_TIMESTAMP())",
      [name, email, hashLearnerPassword(password)],
    );
    const id = Number(result.insertId);
    await auditAdmin(principal, request, "create", "learner", id, null, { name, email, status: "active" });
    return NextResponse.json({ ok: true, id: String(id) }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "A learner account already uses that email address." }, { status: 409 });
    console.error("Admin learner creation failed", error);
    return NextResponse.json({ error: "The learner account could not be created." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await authorized();
  if (!principal) return NextResponse.json({ error: "You do not have permission to update learner accounts." }, { status: 403 });
  if (!hasDatabase || !db) return unavailable();

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const name = normalizedName(body?.name);
  const email = normalizedEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const status = body?.status === "active" || body?.status === "inactive" ? body.status : null;
  if (!Number.isSafeInteger(id) || id < 1 || !validProfile(name, email) || (password && (password.length < 8 || password.length > 128)) || (body?.status !== undefined && !status)) {
    return NextResponse.json({ error: "Enter a valid learner name, email, status, and optional 8–128 character password." }, { status: 400 });
  }

  try {
    const [rows] = await db.execute<Array<RowDataPacket & { id: number; name: string; email: string; status: "active" | "inactive" }>>(
      "SELECT id, name, email, status FROM learners WHERE id = ? LIMIT 1", [id],
    );
    const existing = rows[0];
    if (!existing) return NextResponse.json({ error: "Learner account not found." }, { status: 404 });
    const nextStatus = status ?? existing.status;
    const sessionInvalidation = Boolean(password) || nextStatus !== existing.status;
    if (password) {
      await db.execute(
        "UPDATE learners SET name = ?, email = ?, password_hash = ?, status = ?, session_version = session_version + 1 WHERE id = ?",
        [name, email, hashLearnerPassword(password), nextStatus, id],
      );
      await db.execute("UPDATE learner_action_tokens SET used_at = UTC_TIMESTAMP() WHERE learner_id = ? AND used_at IS NULL", [id]);
    } else {
      await db.execute(
        `UPDATE learners SET name = ?, email = ?, status = ?, session_version = session_version + ? WHERE id = ?`,
        [name, email, nextStatus, sessionInvalidation ? 1 : 0, id],
      );
    }
    await auditAdmin(principal, request, "update", "learner", id, { name: existing.name, email: existing.email, status: existing.status }, { name, email, status: nextStatus, passwordChanged: Boolean(password), sessionsRevoked: sessionInvalidation });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "A learner account already uses that email address." }, { status: 409 });
    console.error("Admin learner update failed", error);
    return NextResponse.json({ error: "The learner account could not be updated." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await authorized();
  if (!principal) return NextResponse.json({ error: "You do not have permission to deactivate learner accounts." }, { status: 403 });
  if (!hasDatabase || !db) return unavailable();

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid learner account." }, { status: 400 });
  try {
    const [rows] = await db.execute<Array<RowDataPacket & { id: number; name: string; email: string; status: "active" | "inactive" }>>(
      "SELECT id, name, email, status FROM learners WHERE id = ? LIMIT 1", [id],
    );
    const existing = rows[0];
    if (!existing) return NextResponse.json({ error: "Learner account not found." }, { status: 404 });
    if (existing.status !== "inactive") {
      await db.execute("UPDATE learners SET status = 'inactive', session_version = session_version + 1 WHERE id = ?", [id]);
      await auditAdmin(principal, request, "deactivate", "learner", id, { status: existing.status }, { status: "inactive", name: existing.name, email: existing.email, sessionsRevoked: true });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Admin learner deactivation failed", error);
    return NextResponse.json({ error: "The learner account could not be deactivated." }, { status: 500 });
  }
}
