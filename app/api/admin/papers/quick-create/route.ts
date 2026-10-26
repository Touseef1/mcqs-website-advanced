import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { slugify, validSlug } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";

import { auditAdmin, csrfFailure } from "@/lib/admin-security";
export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "paper.manage")) return NextResponse.json({ error: "Your role cannot create past papers." }, { status: 403 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const examName = typeof body?.examName === "string" ? body.examName.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const year = Number(body?.year);
  const slug = slugify(title);
  if (examName.length < 2 || examName.length > 160 || title.length < 3 || title.length > 220 || !Number.isInteger(year) || year < 1900 || year > 2200 || !validSlug(slug)) {
    return NextResponse.json({ error: "Enter an exam, a paper title, and a valid year." }, { status: 400 });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [examResult] = await connection.execute(
      `INSERT INTO exams (name, slug) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), id = LAST_INSERT_ID(id)`,
      [examName, slugify(examName)],
    );
    const examId = Number((examResult as { insertId: number }).insertId);
    const description = `${examName} ${year} past paper. Add source details and verified MCQs before publishing.`;
    const [paperResult] = await connection.execute(
      `INSERT INTO papers (exam_id, title, slug, year, paper_type, description, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'Past paper', ?, 'draft', ?, ?)`,
      [examId, title, slug, year, description, principal.id, principal.id],
    );
    const id = Number((paperResult as { insertId: number }).insertId);
    const [rows] = await connection.execute<Array<RowDataPacket & { exam_name: string }>>("SELECT name AS exam_name FROM exams WHERE id = ? LIMIT 1", [examId]);
    await connection.commit();
    await auditAdmin(principal, request, "create", "paper", id, null, { title, examName, year, status: "draft" });
    return NextResponse.json({ ok: true, paper: { id, examId, examName: rows[0]?.exam_name ?? examName, title, slug, year, type: "Past paper", description, status: "draft", questionCount: 0, questionIds: [] } }, { status: 201 });
  } catch (cause) {
    await connection.rollback();
    if ((cause as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "A paper already uses this title as its URL. Edit the title and try again." }, { status: 409 });
    console.error("Quick past-paper creation failed", cause);
    return NextResponse.json({ error: "The past paper could not be created." }, { status: 500 });
  } finally {
    connection.release();
  }
}
