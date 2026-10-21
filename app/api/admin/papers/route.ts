import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, hasPermission } from "@/lib/admin-auth";
import { requestedStatus, slugify, validSlug } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";

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
  const type = body?.type === "Past paper" ? "Past paper" : body?.type === "Practice set" ? "Practice set" : null;
  const slug = typeof body?.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(title);
  const questionIds = Array.isArray(body?.questionIds) ? [...new Set(body.questionIds.map(Number))] : [];
  if (examName.length < 2 || examName.length > 160 || title.length < 3 || title.length > 220 || description.length < 3 || description.length > 3000 || !Number.isInteger(year) || year < 1900 || year > 2200 || !type || !validSlug(slug) || questionIds.length < 1 || questionIds.length > 300 || questionIds.some((id) => !Number.isInteger(id) || id < 1)) return null;
  return { examName, title, description, year, type, slug, questionIds };
}

export async function GET() {
  const principal = await getAdminPrincipal();
  if (!principal || !hasPermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return noDatabase();
  const [papers] = await db.execute<Array<RowDataPacket & { id: number; exam_id: number; exam_name: string; title: string; slug: string; year: number; type: string; description: string; status: string; question_count: number }>>(
    `SELECT p.id, p.exam_id, e.name AS exam_name, p.title, p.slug, p.year,
            p.paper_type AS type, p.description, p.status, COUNT(pq.question_id) AS question_count
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
    status: paper.status, questionCount: Number(paper.question_count),
    questionIds: links.filter((link) => link.paper_id === paper.id).map((link) => link.question_id),
  })) }, { headers: { "Cache-Control": "no-store" } });
}

async function savePaper(body: Record<string, unknown> | null, update: boolean) {
  const principal = await getAdminPrincipal();
  if (!principal) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  if (!hasPermission(principal, "papers:manage")) {
    if (update && hasPermission(principal, "content:publish") && (body?.status === "published" || body?.status === "archived")) {
      if (!hasDatabase || !db) return noDatabase();
      const id = Number(body?.id);
      if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid past paper." }, { status: 400 });
      if (body.status === "published") {
        const [draftQuestions] = await db.execute<Array<RowDataPacket & { count: number }>>(
          `SELECT COUNT(*) AS count FROM paper_questions pq JOIN questions q ON q.id = pq.question_id
           WHERE pq.paper_id = ? AND q.status != 'published'`, [id],
        );
        if (Number(draftQuestions[0]?.count ?? 0) > 0) return NextResponse.json({ error: "Publish or remove every draft question before publishing this paper." }, { status: 400 });
      }
      const [exists] = await db.execute<Array<RowDataPacket & { id: number }>>("SELECT id FROM papers WHERE id = ? LIMIT 1", [id]);
      if (!exists[0]) return NextResponse.json({ error: "Past paper not found." }, { status: 404 });
      await db.execute("UPDATE papers SET status = ? WHERE id = ?", [body?.status, id]);
      refreshPapers();
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Your role cannot manage past papers." }, { status: 403 });
  }
  if (!hasDatabase || !db) return noDatabase();
  const paper = parsePaper(body);
  const id = Number(body?.id);
  if (!paper || (update && (!Number.isInteger(id) || id < 1))) return NextResponse.json({ error: "Complete the exam, title, year, description, slug, and select at least one question." }, { status: 400 });
  const status = requestedStatus(body?.status, principal);
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
      const [exists] = await connection.execute<Array<RowDataPacket & { id: number }>>("SELECT id FROM papers WHERE id = ? LIMIT 1", [id]);
      if (!exists[0]) {
        await connection.rollback();
        return NextResponse.json({ error: "Past paper not found." }, { status: 404 });
      }
      await connection.execute(
        "UPDATE papers SET exam_id = ?, title = ?, slug = ?, year = ?, paper_type = ?, description = ?, status = ? WHERE id = ?",
        [examId, paper.title, paper.slug, paper.year, paper.type, paper.description, status, id],
      );
      await connection.execute("DELETE FROM paper_questions WHERE paper_id = ?", [id]);
    } else {
      const [insert] = await connection.execute(
        "INSERT INTO papers (exam_id, title, slug, year, paper_type, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [examId, paper.title, paper.slug, paper.year, paper.type, paper.description, status],
      );
      paperId = (insert as { insertId: number }).insertId;
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
  refreshPapers();
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  return savePaper(await request.json().catch(() => null), false);
}

export async function PATCH(request: Request) {
  return savePaper(await request.json().catch(() => null), true);
}

export async function DELETE(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal || !hasPermission(principal, "content:publish")) return NextResponse.json({ error: "Only reviewers and admins can archive past papers." }, { status: 403 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid past paper." }, { status: 400 });
  await db.execute("UPDATE papers SET status = 'archived' WHERE id = ?", [id]);
  refreshPapers();
  return NextResponse.json({ ok: true });
}
