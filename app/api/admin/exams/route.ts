import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { slugify, validSlug } from "@/lib/admin-content";
import { auditAdmin, csrfFailure } from "@/lib/admin-security";
import { db, hasDatabase } from "@/lib/db";

export async function GET() {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply migrations first." }, { status: 503 });
  const [exams] = await db.execute<Array<RowDataPacket & { id: number; name: string; slug: string }>>("SELECT id, name, slug FROM exams ORDER BY name");
  return NextResponse.json({ exams }, { headers: { "Cache-Control": "no-store" } });
}

async function save(request: Request, update: boolean) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "paper.manage")) return NextResponse.json({ error: "Your role cannot manage exams." }, { status: 403 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply migrations first." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const slug = typeof body?.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(name);
  if (name.length < 2 || name.length > 160 || !validSlug(slug) || (update && (!Number.isInteger(id) || id < 1))) return NextResponse.json({ error: "Enter a valid exam name and URL slug." }, { status: 400 });
  try {
    let examId = id;
    if (update) {
      const [result] = await db.execute("UPDATE exams SET name = ?, slug = ? WHERE id = ?", [name, slug, id]);
      if (!(result as { affectedRows: number }).affectedRows) return NextResponse.json({ error: "Exam not found." }, { status: 404 });
    } else {
      const [result] = await db.execute("INSERT INTO exams (name, slug) VALUES (?, ?)", [name, slug]);
      examId = Number((result as { insertId: number }).insertId);
    }
    await auditAdmin(principal, request, update ? "update" : "create", "exam", examId, null, { name, slug });
    return NextResponse.json({ ok: true, exam: { id: examId, name, slug } }, { status: update ? 200 : 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "That exam name or URL slug already exists." }, { status: 409 });
    console.error("Admin exam save failed", error);
    return NextResponse.json({ error: "The exam could not be saved." }, { status: 500 });
  }
}

export function POST(request: Request) { return save(request, false); }
export function PATCH(request: Request) { return save(request, true); }
