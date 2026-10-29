import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { requestedStatus, slugify, validSlug } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";

import { auditAdmin, csrfFailure } from "@/lib/admin-security";
function noDatabase() {
  return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 });
}

function refreshPapers() {
  revalidatePath("/past-papers");
  revalidateTag("papers", "max");
  revalidateTag("questions", "max");
}

function parsePaper(body: Record<string, unknown> | null) {
  const examName = typeof body?.examName === "string" ? body.examName.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const year = Number(body?.year);
  const type = ["Past paper", "Model paper", "Mock test"].includes(String(body?.type)) ? String(body?.type) : null;
  const shiftSession = typeof body?.shiftSession === "string" ? body.shiftSession.trim() : "";
  const expectedQuestionCount = body?.expectedQuestionCount === "" || body?.expectedQuestionCount == null ? null : Number(body.expectedQuestionCount);
  const slug = typeof body?.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(title);
  const questionIds = Array.isArray(body?.questionIds) ? [...new Set(body.questionIds.map(Number))] : [];
  if (examName.length < 2 || examName.length > 160 || title.length < 3 || title.length > 220 || description.length < 3 || description.length > 3000 || !Number.isInteger(year) || year < 1900 || year > 2200 || !type || shiftSession.length > 120 || (expectedQuestionCount !== null && (!Number.isInteger(expectedQuestionCount) || expectedQuestionCount < 1 || expectedQuestionCount > 500)) || !validSlug(slug) || questionIds.length < 1 || questionIds.length > 300 || questionIds.some((id) => !Number.isInteger(id) || id < 1)) return null;
  return { examName, title, description, year, type, shiftSession: shiftSession || null, expectedQuestionCount, slug, questionIds };
}

export async function GET() {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return noDatabase();
  const [papers] = await db.execute<Array<RowDataPacket & { id: number; exam_id: number; exam_name: string; title: string; slug: string; year: number; type: string; description: string; status: string; question_count: number; shift_session: string | null; expected_question_count: number | null }>>(
    `SELECT p.id, p.exam_id, e.name AS exam_name, p.title, p.slug, p.year,
            p.paper_type AS type, p.description, p.status, p.shift_session, p.expected_question_count, COUNT(pq.question_id) AS question_count
     FROM papers p JOIN exams e ON e.id = p.exam_id
     LEFT JOIN paper_questions pq ON pq.paper_id = p.id
     GROUP BY p.id ORDER BY p.year DESC, p.id DESC`,
  );
  const [links] = await db.execute<Array<RowDataPacket & { paper_id: number; question_id: number }>>(
    "SELECT paper_id, question_id FROM paper_questions ORDER BY paper_id, question_order",
  );
  return NextResponse.json({ papers: papers.map((paper) => ({
    id: paper.id, examId: paper.exam_id, examName: paper.exam_name, title: paper.title,
    slug: paper.slug, year: paper.year, type: paper.type, description: paper.description,
    status: paper.status, shiftSession: paper.shift_session, expectedQuestionCount: paper.expected_question_count == null ? null : Number(paper.expected_question_count), questionCount: Number(paper.question_count),
    questionIds: links.filter((link) => link.paper_id === paper.id).map((link) => link.question_id),
  })) }, { headers: { "Cache-Control": "no-store" } });
}

async function savePaper(request: Request, body: Record<string, unknown> | null, update: boolean) {
  const principal = await getAdminPrincipal();
  if (!principal) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  if (update && (body?.status === "published" || body?.status === "archived")) {
    const permission = body.status === "published" ? "paper.publish" : "paper.manage";
    if (!requirePermission(principal, permission)) return NextResponse.json({ error: body.status === "published" ? "Only Publishers, Admins, and Super Admins can publish past papers." : "Your role cannot archive past papers." }, { status: 403 });
    if (!hasDatabase || !db) return noDatabase();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid past paper." }, { status: 400 });
    if (body.status === "published") {
      const [draftQuestions] = await db.execute<Array<RowDataPacket & { count: number }>>(
        `SELECT COUNT(*) AS count FROM paper_questions pq JOIN questions q ON q.id = pq.question_id
         WHERE pq.paper_id = ? AND q.status != 'published'`, [id],
      );
      if (Number(draftQuestions[0]?.count ?? 0) > 0) return NextResponse.json({ error: "Publish or remove every draft question before publishing this paper." }, { status: 400 });
    }
    const [exists] = await db.execute<Array<RowDataPacket & { id: number; title: string; status: string }>>("SELECT id, title, status FROM papers WHERE id = ? LIMIT 1", [id]);
    if (!exists[0]) return NextResponse.json({ error: "Past paper not found." }, { status: 404 });
    await db.execute("UPDATE papers SET status = ?, updated_by = ? WHERE id = ?", [body.status, principal.id, id]);
    await auditAdmin(principal, request, body.status, "paper", id, { status: exists[0].status, title: exists[0].title }, { status: body.status, title: exists[0].title });
    refreshPapers();
    return NextResponse.json({ ok: true });
  }
  if (!requirePermission(principal, "paper.manage")) return NextResponse.json({ error: "Your role cannot manage past papers." }, { status: 403 });
  if (!hasDatabase || !db) return noDatabase();
  const paper = parsePaper(body);
  const id = Number(body?.id);
  if (!paper || (update && (!Number.isInteger(id) || id < 1))) return NextResponse.json({ error: "Complete the exam, title, year, description, slug, and select at least one question." }, { status: 400 });
  const status = requestedStatus(body?.status, principal);
  let savedPaperId = id;
  let auditOld: Record<string, unknown> | null = null;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const examSlug = slugify(paper.examName);
    const [examResult] = await connection.execute(
      `INSERT INTO exams (name, slug) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), id = LAST_INSERT_ID(id)`,
      [paper.examName, examSlug],
    );
    const examId = (examResult as { insertId: number }).insertId;
    const marks = paper.questionIds.map(() => "?").join(",");
    const [selected] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>(
      `SELECT id, status FROM questions WHERE id IN (${marks})`, paper.questionIds,
    );
    if (selected.length !== paper.questionIds.length || selected.some((question) => question.status === "archived") || (status === "published" && selected.some((question) => question.status !== "published"))) {
      await connection.rollback();
      return NextResponse.json({ error: "Every selected question must exist and be active. A published paper can only contain published questions." }, { status: 400 });
    }
    let paperId = id;
    if (update) {
      const [exists] = await connection.execute<Array<RowDataPacket & { id: number; title: string; status: string }>>("SELECT id, title, status FROM papers WHERE id = ? LIMIT 1 FOR UPDATE", [id]);
      if (!exists[0]) {
        await connection.rollback();
        return NextResponse.json({ error: "Past paper not found." }, { status: 404 });
      }
      auditOld = { status: exists[0].status, title: exists[0].title };
      await connection.execute(
        "UPDATE papers SET exam_id = ?, title = ?, slug = ?, year = ?, paper_type = ?, shift_session = ?, expected_question_count = ?, description = ?, status = ?, updated_by = ? WHERE id = ?",
        [examId, paper.title, paper.slug, paper.year, paper.type, paper.shiftSession, paper.expectedQuestionCount, paper.description, status, principal.id, id],
      );
      await connection.execute("DELETE FROM paper_questions WHERE paper_id = ?", [id]);
    } else {
      const [insert] = await connection.execute(
        "INSERT INTO papers (exam_id, title, slug, year, paper_type, shift_session, expected_question_count, description, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [examId, paper.title, paper.slug, paper.year, paper.type, paper.shiftSession, paper.expectedQuestionCount, paper.description, status, principal.id, principal.id],
      );
      paperId = (insert as { insertId: number }).insertId;
      savedPaperId = paperId;
    }
    for (const [index, questionId] of paper.questionIds.entries()) {
      await connection.execute("INSERT INTO paper_questions (paper_id, question_id, question_order) VALUES (?, ?, ?)", [paperId, questionId, index + 1]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "That past-paper URL slug is already in use." }, { status: 409 });
    console.error("Admin past-paper save failed", error);
    return NextResponse.json({ error: "The past paper could not be saved." }, { status: 500 });
  } finally {
    connection.release();
  }
  await auditAdmin(principal, request, update ? "update" : "create", "paper", update ? id : savedPaperId, auditOld, { title: paper.title, status, questionIds: paper.questionIds });
  refreshPapers();
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  return savePaper(request, await request.json().catch(() => null), false);
}

export async function PATCH(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  return savePaper(request, await request.json().catch(() => null), true);
}

export async function DELETE(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "paper.manage")) return NextResponse.json({ error: "Your role cannot archive past papers." }, { status: 403 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid past paper." }, { status: 400 });
  const [existing] = await db.execute<Array<RowDataPacket & { title: string; status: string }>>("SELECT title, status FROM papers WHERE id = ? LIMIT 1", [id]);
  if (!existing[0]) return NextResponse.json({ error: "Past paper not found." }, { status: 404 });
  await db.execute("UPDATE papers SET status = 'archived', updated_by = ? WHERE id = ?", [principal.id, id]);
  await auditAdmin(principal, request, "archive", "paper", id, { title: existing[0].title, status: existing[0].status }, { title: existing[0].title, status: "archived" });
  refreshPapers();
  return NextResponse.json({ ok: true });
}
