import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { requestedStatus } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";
import { auditAdmin } from "@/lib/admin-security";

import { csrfFailure } from "@/lib/admin-security";
const labels = ["A", "B", "C", "D"] as const;

function noDatabase() {
  return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 });
}

function refreshQuestions() {
  revalidatePath("/");
  revalidatePath("/subjects");
  revalidatePath("/past-papers");
  revalidateTag("questions", "max");
  revalidateTag("subjects", "max");
  revalidateTag("topics", "max");
  revalidateTag("papers", "max");
}

function parseQuestion(body: Record<string, unknown> | null) {
  const topicId = Number(body?.topicId);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const explanation = typeof body?.explanation === "string" ? body.explanation.trim() : "";
  const sourceNote = typeof body?.sourceNote === "string" ? body.sourceNote.trim() : "";
  const choices = Array.isArray(body?.choices) ? body.choices.map((choice) => typeof choice === "string" ? choice.trim() : "") : [];
  const correctChoice = typeof body?.correctChoice === "string" ? body.correctChoice : "";
  const questionImageUrl = typeof body?.questionImageUrl === "string" && body.questionImageUrl ? body.questionImageUrl : null;
  const choiceImageUrls = Array.isArray(body?.choiceImageUrls) ? body.choiceImageUrls.map((url) => typeof url === "string" && url ? url : null) : [null, null, null, null];
  const difficulty = body?.difficulty === "easy" || body?.difficulty === "hard" ? body.difficulty : "medium";
  const paperIds = body && Object.hasOwn(body, "paperIds")
    ? Array.isArray(body.paperIds) ? [...new Set(body.paperIds.map(Number))] : null
    : undefined;
  const normalizedChoices = choices.map((choice) => choice.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase());
  const validImage = (url: unknown) => url == null || (typeof url === "string" && /^\/uploads\/mcqs\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(url));
  if (!Number.isInteger(topicId) || topicId < 1 || prompt.length < 8 || prompt.length > 1500 || explanation.length > 3000 || sourceNote.length < 4 || sourceNote.length > 500 || choices.length !== 4 || choices.some((choice) => choice.length < 1 || choice.length > 800) || new Set(normalizedChoices).size !== 4 || !labels.includes(correctChoice as typeof labels[number]) || choiceImageUrls.length !== 4 || !validImage(questionImageUrl) || choiceImageUrls.some((url) => !validImage(url)) || paperIds === null || (paperIds && (paperIds.length > 50 || paperIds.some((id) => !Number.isSafeInteger(id) || id < 1)))) return null;
  return { topicId, prompt, explanation, sourceNote, choices, choiceImageUrls, questionImageUrl, correctChoice, difficulty, paperIds };
}

async function validatePaperIds(connection: import("mysql2/promise").PoolConnection, paperIds: number[]) {
  if (!paperIds.length) return true;
  const [rows] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>(
    `SELECT id, status FROM papers WHERE id IN (${paperIds.map(() => "?").join(",")})`, paperIds,
  );
  return rows.length === paperIds.length && rows.every((paper) => paper.status !== "archived");
}

async function syncQuestionPapers(connection: import("mysql2/promise").PoolConnection, questionId: number, paperIds: number[]) {
  const [existing] = await connection.execute<Array<RowDataPacket & { paper_id: number; question_order: number }>>(
    "SELECT paper_id, question_order FROM paper_questions WHERE question_id = ?", [questionId],
  );
  const oldOrder = new Map(existing.map((row) => [row.paper_id, row.question_order]));
  const wanted = new Set(paperIds);
  for (const row of existing) {
    if (!wanted.has(row.paper_id)) await connection.execute("DELETE FROM paper_questions WHERE paper_id = ? AND question_id = ?", [row.paper_id, questionId]);
  }
  for (const paperId of paperIds) {
    if (oldOrder.has(paperId)) continue;
    const [papers] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>(
      "SELECT id, status FROM papers WHERE id = ? FOR UPDATE", [paperId],
    );
    if (!papers[0] || papers[0].status === "archived") throw new Error("The selected paper is no longer active.");
    const [maxRows] = await connection.execute<Array<RowDataPacket & { max_order: number | null }>>(
      "SELECT MAX(question_order) AS max_order FROM paper_questions WHERE paper_id = ?", [paperId],
    );
    const order = Number(maxRows[0]?.max_order ?? 0) + 1;
    await connection.execute("INSERT INTO paper_questions (paper_id, question_id, question_order) VALUES (?, ?, ?)", [paperId, questionId, order]);
  }
}

export async function GET(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return noDatabase();
  const params = new URL(request.url).searchParams;
  const idsParam = params.get("ids");
  const ids = idsParam ? [...new Set(idsParam.split(",").map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 500) : [];
  const search = (params.get("search") ?? "").trim().slice(0, 160);
  const topicId = Number(params.get("topicId"));
  const status = params.get("status") ?? "all";
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  const pageSize = Math.max(10, Math.min(100, Number(params.get("pageSize")) || (search || params.has("page") ? 25 : 500)));
  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (!requirePermission(principal, "mcq.edit_any")) { conditions.push("q.created_by = ?"); values.push(Number(principal.id)); }
  if (idsParam) {
    if (!ids.length) return NextResponse.json({ questions: [], total: 0, page, pageSize });
    conditions.push(`q.id IN (${ids.map(() => "?").join(",")})`);
    values.push(...ids);
  }
  if (search) {
    conditions.push("(q.question_text LIKE ? OR q.source_note LIKE ? OR t.name LIKE ? OR s.name LIKE ?)");
    const term = `%${search}%`;
    values.push(term, term, term, term);
  }
  if (Number.isSafeInteger(topicId) && topicId > 0) { conditions.push("t.id = ?"); values.push(topicId); }
  if (["draft", "in_review", "approved", "published", "rejected", "archived"].includes(status)) { conditions.push("q.status = ?"); values.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const from = "FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id";
  const [countRows] = await db.execute<Array<RowDataPacket & { total: number }>>(`SELECT COUNT(*) AS total ${from} ${where}`, values);
  const total = Number(countRows[0]?.total ?? 0);
  const offset = (page - 1) * pageSize;
  const [questions] = await db.execute<Array<RowDataPacket & { id: number; topic_id: number; topic_name: string; subject_name: string; prompt: string; explanation: string; source_note: string; correct_choice: string; difficulty: string; status: string; review_note: string | null; created_by: number | null; updated_at: string; question_image_url: string | null }>>(
    `SELECT q.id, q.topic_id, t.name AS topic_name, s.name AS subject_name,
            q.question_text AS prompt, q.explanation, q.source_note, q.correct_choice, q.difficulty, q.status, q.review_note, q.created_by, q.updated_at, q.question_image_url
     ${from} ${where}
     ORDER BY q.updated_at DESC, q.id DESC LIMIT ? OFFSET ?`,
    [...values, pageSize, offset],
  );
  const questionIds = questions.map((question) => question.id);
  const [paperLinks] = questionIds.length
    ? await db.execute<Array<RowDataPacket & { question_id: number; paper_id: number }>>(
      `SELECT pq.question_id, pq.paper_id FROM paper_questions pq JOIN papers p ON p.id = pq.paper_id
       WHERE pq.question_id IN (${questionIds.map(() => "?").join(",")}) AND p.status != 'archived'`, questionIds,
    )
    : [[] as Array<RowDataPacket & { question_id: number; paper_id: number }>];
  const paperIdMap = new Map<number, number[]>();
  for (const link of paperLinks) paperIdMap.set(link.question_id, [...(paperIdMap.get(link.question_id) ?? []), link.paper_id]);
  const [choices] = questionIds.length
    ? await db.execute<Array<RowDataPacket & { question_id: number; label: string; choice_text: string; image_url: string | null }>>(
      `SELECT question_id, label, choice_text, image_url FROM choices
       WHERE question_id IN (${questionIds.map(() => "?").join(",")}) ORDER BY question_id DESC, label`, questionIds,
    )
    : [[] as Array<RowDataPacket & { question_id: number; label: string; choice_text: string }>];
  const choiceMap = new Map<number, Array<{ label: string; text: string; imageUrl: string | null }>>();
  for (const choice of choices) {
    const list = choiceMap.get(choice.question_id) ?? [];
    list.push({ label: choice.label, text: choice.choice_text, imageUrl: choice.image_url });
    choiceMap.set(choice.question_id, list);
  }
  const orderedQuestions = idsParam ? [...questions].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) : questions;
  return NextResponse.json({ questions: orderedQuestions.map((question) => ({
    id: question.id, topicId: question.topic_id, topicName: question.topic_name, subjectName: question.subject_name,
    prompt: question.prompt, explanation: question.explanation, sourceNote: question.source_note, correctChoice: question.correct_choice, questionImageUrl: question.question_image_url,
    difficulty: question.difficulty, status: question.status, reviewNote: question.review_note, createdBy: question.created_by, paperIds: paperIdMap.get(question.id) ?? [],
    choices: choiceMap.get(question.id) ?? [],
  })), total, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "mcq.create")) return NextResponse.json({ error: "Your role cannot add questions." }, { status: 403 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const parsed = parseQuestion(body);
  if (!parsed) return NextResponse.json({ error: "Add a source reference and check the topic, question, four choices, correct answer, and explanation." }, { status: 400 });
  if (parsed.paperIds !== undefined && !requirePermission(principal, "paper.manage")) return NextResponse.json({ error: "Your role cannot assign questions to past papers." }, { status: 403 });
  const status = "draft" as const;
  const connection = await db.getConnection();
  let questionId = 0;
  try {
    await connection.beginTransaction();
    const paperIds = parsed.paperIds ?? [];
    if (!await validatePaperIds(connection, paperIds)) {
      await connection.rollback();
      return NextResponse.json({ error: "Choose active past papers. Archived papers cannot receive MCQs." }, { status: 400 });
    }
    const [insert] = await connection.execute(
      `INSERT INTO questions (topic_id, question_text, explanation, source_note, question_image_url, correct_choice, difficulty, status, created_by, updated_by)
       SELECT t.id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM topics t JOIN subjects s ON s.id = t.subject_id
       WHERE t.id = ? AND t.status != 'archived' AND s.status != 'archived'
         AND (? != 'published' OR (t.status = 'published' AND s.status = 'published'))`,
      [parsed.prompt, parsed.explanation, parsed.sourceNote, parsed.questionImageUrl, parsed.correctChoice, parsed.difficulty, status, principal.id, principal.id, parsed.topicId, status],
    );
    questionId = (insert as { insertId: number }).insertId;
    if (!questionId) {
      await connection.rollback();
      return NextResponse.json({ error: "Choose a valid subject and topic. Published questions need a published topic." }, { status: 400 });
    }
    for (let index = 0; index < labels.length; index++) {
      await connection.execute("INSERT INTO choices (question_id, label, choice_text, image_url) VALUES (?, ?, ?, ?)", [questionId, labels[index], parsed.choices[index], parsed.choiceImageUrls[index]]);
    }
    await syncQuestionPapers(connection, questionId, paperIds);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error("Admin question creation failed", error);
    return NextResponse.json({ error: "The question could not be saved." }, { status: 500 });
  } finally {
    connection.release();
  }
  await auditAdmin(principal, request, "create", "question", questionId, null, { topicId: parsed.topicId, status });
  refreshQuestions();
  return NextResponse.json({ ok: true, id: questionId });
}

export async function PATCH(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid question." }, { status: 400 });

  if (["draft", "in_review", "approved", "rejected"].includes(String(body?.status))) {
    const target = String(body.status);
    const [rows] = await db.execute<Array<RowDataPacket & { status: string; created_by: number | null }>>("SELECT status, created_by FROM questions WHERE id = ? LIMIT 1", [id]);
    const item = rows[0];
    if (!item) return NextResponse.json({ error: "Question not found." }, { status: 404 });
    if (target === "draft") {
      if (!requirePermission(principal, "mcq.edit_own") || String(item.created_by) !== principal.id || item.status !== "rejected") return NextResponse.json({ error: "Only the author can reopen their own rejected MCQ." }, { status: 403 });
      await db.execute("UPDATE questions SET status = 'draft', updated_by = ? WHERE id = ?", [principal.id, id]);
      await auditAdmin(principal, request, "reopen_rejected", "question", id, { status: item.status }, { status: "draft", reviewNote: body.reviewNote ?? null });
    } else if (target === "in_review") {
      if (!requirePermission(principal, "mcq.edit_own") || String(item.created_by) !== principal.id || item.status !== "draft") return NextResponse.json({ error: "Only the author can submit their own draft for review." }, { status: 403 });
      await db.execute("UPDATE questions SET status = 'in_review', updated_by = ? WHERE id = ?", [principal.id, id]);
      await auditAdmin(principal, request, "submit_for_review", "question", id, { status: item.status }, { status: target });
    } else {
      if (!requirePermission(principal, "mcq.review") || item.status !== "in_review") return NextResponse.json({ error: "Only reviewers can decide submitted MCQs." }, { status: 403 });
      const note = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
      if (!note) return NextResponse.json({ error: "Add a review comment when approving or rejecting an MCQ." }, { status: 400 });
      await db.execute("UPDATE questions SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?, updated_by = ? WHERE id = ?", [target, principal.id, note || null, principal.id, id]);
      await auditAdmin(principal, request, target, "question", id, { status: item.status }, { status: target, reviewNote: note || null });
    }
    refreshQuestions();
    return NextResponse.json({ ok: true });
  }
  if (body?.status === "published" || body?.status === "archived") {
    const permission = body.status === "published" ? "mcq.publish" : "mcq.archive";
    if (!requirePermission(principal, permission)) return NextResponse.json({ error: body.status === "published" ? "Only Paper Managers and Super Admins can publish questions." : "Only the Super Admin can archive questions." }, { status: 403 });
    const status = body.status;
    const [current] = await db.execute<Array<RowDataPacket & { id: number; topic_status: string; subject_status: string; source_note: string; status: string }>>(
      `SELECT q.id, t.status AS topic_status, s.status AS subject_status, q.source_note, q.status
       FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
       WHERE q.id = ? LIMIT 1`, [id],
    );
    if (!current[0]) return NextResponse.json({ error: "Question not found." }, { status: 404 });
    if (status === "published") {
      const [state] = await db.execute<Array<RowDataPacket & { status: string }>>("SELECT status FROM questions WHERE id = ?", [id]);
      if (state[0]?.status !== "approved") return NextResponse.json({ error: "Only approved MCQs can be published." }, { status: 403 });
    }
    if (status === "published" && !current[0].source_note.trim()) return NextResponse.json({ error: "Add the exam and source reference before publishing this MCQ." }, { status: 400 });
    if (status === "published" && (current[0].topic_status !== "published" || current[0].subject_status !== "published")) {
      return NextResponse.json({ error: "Publish its subject and topic before publishing this question." }, { status: 400 });
    }
    const sql = status === "published"
      ? `UPDATE questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
         SET q.status = 'published', q.updated_by = ? WHERE q.id = ? AND t.status = 'published' AND s.status = 'published'`
      : "UPDATE questions SET status = 'archived', updated_by = ? WHERE id = ?";
    await db.execute(sql, [principal.id, id]);
    await auditAdmin(principal, request, status, "question", id, { status: current[0].status }, { status });
    refreshQuestions();
    return NextResponse.json({ ok: true });
  }

  if (!requirePermission(principal, "mcq.edit_any") && !requirePermission(principal, "mcq.edit_own")) return NextResponse.json({ error: "Your role cannot edit questions." }, { status: 403 });
  const parsed = parseQuestion(body);
  if (!parsed) return NextResponse.json({ error: "Add a source reference and check the topic, question, four choices, correct answer, and explanation." }, { status: 400 });
  if (parsed.paperIds !== undefined && !requirePermission(principal, "paper.manage")) return NextResponse.json({ error: "Your role cannot assign questions to past papers." }, { status: 403 });
  const status = requestedStatus(body?.status, principal);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<Array<RowDataPacket & { id: number; status: string; created_by: number | null }>>("SELECT id, status, created_by FROM questions WHERE id = ? LIMIT 1 FOR UPDATE", [id]);
    if (!existing[0]) {
      await connection.rollback();
      return NextResponse.json({ error: "Question not found." }, { status: 404 });
    }
    if (!requirePermission(principal, "mcq.edit_any") && !(requirePermission(principal, "mcq.edit_own") && String(existing[0].created_by) === principal.id && existing[0].status === "draft")) {
      await connection.rollback();
      return NextResponse.json({ error: "Your role can edit draft questions only." }, { status: 403 });
    }
    const [topic] = await connection.execute<Array<RowDataPacket & { id: number }>>(
      `SELECT t.id FROM topics t JOIN subjects s ON s.id = t.subject_id
       WHERE t.id = ? AND t.status != 'archived' AND s.status != 'archived'
         AND (? != 'published' OR (t.status = 'published' AND s.status = 'published'))`,
      [parsed.topicId, status],
    );
    if (!topic[0]) {
      await connection.rollback();
      return NextResponse.json({ error: "Choose a valid topic. Published questions need a published topic." }, { status: 400 });
    }
    if (parsed.paperIds && !await validatePaperIds(connection, parsed.paperIds)) {
      await connection.rollback();
      return NextResponse.json({ error: "Choose active past papers. Archived papers cannot receive MCQs." }, { status: 400 });
    }
    await connection.execute(
      "UPDATE questions SET topic_id = ?, question_text = ?, explanation = ?, source_note = ?, question_image_url = ?, correct_choice = ?, difficulty = ?, updated_by = ? WHERE id = ?",
      [parsed.topicId, parsed.prompt, parsed.explanation, parsed.sourceNote, parsed.questionImageUrl, parsed.correctChoice, parsed.difficulty, principal.id, id],
    );
    await connection.execute("DELETE FROM choices WHERE question_id = ?", [id]);
    for (let index = 0; index < labels.length; index++) {
      await connection.execute("INSERT INTO choices (question_id, label, choice_text, image_url) VALUES (?, ?, ?, ?)", [id, labels[index], parsed.choices[index], parsed.choiceImageUrls[index]]);
    }
    if (parsed.paperIds) await syncQuestionPapers(connection, id, parsed.paperIds);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error("Admin question update failed", error);
    return NextResponse.json({ error: "The question could not be updated." }, { status: 500 });
  } finally {
    connection.release();
  }
  await auditAdmin(principal, request, "update", "question", id, null, { topicId: parsed.topicId });
  refreshQuestions();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "mcq.archive")) return NextResponse.json({ error: "Only the Super Admin can archive questions." }, { status: 403 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid question." }, { status: 400 });
  await db.execute("UPDATE questions SET status = 'archived', updated_by = ? WHERE id = ?", [principal.id, id]);
  await auditAdmin(principal, request, "archive", "question", id, null, { status: "archived" });
  refreshQuestions();
  return NextResponse.json({ ok: true });
}
