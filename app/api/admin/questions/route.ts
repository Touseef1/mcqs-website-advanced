import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { canActorEditQuestion, canActorTransition, getQuestionTransition, isSelfApproval, statusAfterQuestionEdit, type QuestionStatus } from "@/lib/admin-workflow";
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
  const [questions] = await db.execute<Array<RowDataPacket & { id: number; topic_id: number; topic_name: string; subject_name: string; prompt: string; explanation: string; source_note: string; correct_choice: string; difficulty: string; status: string; review_note: string | null; created_by: number | null; updated_at: string; question_image_url: string | null; version: number }>>(
    `SELECT q.id, q.topic_id, t.name AS topic_name, s.name AS subject_name,
            q.question_text AS prompt, q.explanation, q.source_note, q.correct_choice, q.difficulty, q.status, q.review_note, q.created_by, q.updated_at, q.question_image_url
            , q.version
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
    difficulty: question.difficulty, status: question.status, version: question.version, reviewNote: question.review_note, createdBy: question.created_by, paperIds: paperIdMap.get(question.id) ?? [],
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
  if (parsed.paperIds !== undefined && !requirePermission(principal, "paper.add_questions")) return NextResponse.json({ error: "Your role cannot add questions to past papers." }, { status: 403 });
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

  if (typeof body?.status === "string") {
    const target = body.status as QuestionStatus;
    const transition = getQuestionTransition("draft", target); // Validate target before reading the locked source status.
    if (!transition && !["in_review", "approved", "published", "rejected", "draft", "archived"].includes(target)) return NextResponse.json({ error: "Unknown question status." }, { status: 400 });
    const connection = await db.getConnection();
    let auditOld: Record<string, unknown> | null = null;
    let auditNew: Record<string, unknown> | null = null;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<Array<RowDataPacket & { status: QuestionStatus; created_by: number | null; source_note: string; topic_status: string; subject_status: string; version: number }>>(
        `SELECT q.status, q.created_by, q.source_note, q.version, t.status AS topic_status, s.status AS subject_status
         FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id WHERE q.id = ? FOR UPDATE`, [id],
      );
      const item = rows[0];
      if (!item) { await connection.rollback(); return NextResponse.json({ error: "Question not found." }, { status: 404 }); }
      const allowed = getQuestionTransition(item.status, target);
      if (!allowed) { await connection.rollback(); return NextResponse.json({ error: `Illegal question transition: ${item.status} → ${target}.` }, { status: 409 }); }
      if (!canActorTransition(principal, item.created_by, item.status, target, (permission) => requirePermission(principal, permission))) { await connection.rollback(); return NextResponse.json({ error: isSelfApproval(principal, item.created_by, target) ? "You cannot approve or publish your own MCQ." : `Your role or ownership does not allow you to ${allowed.action} this MCQ.` }, { status: 403 }); }
      const note = typeof body.reviewNote === "string" ? body.reviewNote.trim().slice(0, 2000) : "";
      if ((target === "approved" || target === "rejected") && !note) { await connection.rollback(); return NextResponse.json({ error: "Add a review comment when approving or rejecting an MCQ." }, { status: 400 }); }
      if (target === "published" && (!item.source_note.trim() || item.topic_status !== "published" || item.subject_status !== "published")) { await connection.rollback(); return NextResponse.json({ error: "Add a source and publish the subject and topic before publishing this MCQ." }, { status: 400 }); }
      const [affected] = ["archived", "in_review"].includes(target) ? await connection.execute<Array<RowDataPacket & { id: number; title: string; slug: string }>>(
        `SELECT p.id, p.title, p.slug FROM paper_questions pq JOIN papers p ON p.id = pq.paper_id WHERE pq.question_id = ? AND p.status = 'published' FOR UPDATE`, [id],
      ) : [[] as Array<RowDataPacket & { id: number; title: string; slug: string }>];
      if (affected.length && body.confirmPaperRemoval !== true) { await connection.rollback(); return NextResponse.json({ error: "This MCQ is in published papers. Confirm removal before changing its status.", affectedPapers: affected }, { status: 409 }); }
      if (affected.length) await connection.execute("DELETE FROM paper_questions WHERE question_id = ? AND paper_id IN (SELECT id FROM papers WHERE status = 'published')", [id]);
      let revisionId: number | null = null;
      if (target === "published") revisionId = await saveQuestionRevision(connection, id, principal.id);
      await connection.execute(
        `UPDATE questions SET status = ?, updated_by = ?, version = version + 1,
         reviewed_by = IF(? IN ('approved','rejected'), ?, reviewed_by),
         reviewed_at = IF(? IN ('approved','rejected'), UTC_TIMESTAMP(), reviewed_at),
         review_note = IF(? IN ('approved','rejected'), ?, IF(? = 'draft', NULL, review_note)),
         current_revision_id = COALESCE(?, current_revision_id) WHERE id = ?`,
        [target, principal.id, target, principal.id, target, target, target, note || null, target, revisionId, id],
      );
      auditOld = { status: item.status, version: item.version };
      auditNew = { status: target, reviewNote: note || null, selfApprovalOverride: principal.role === "super_admin" && isSelfApproval(principal, item.created_by, target), removedFromPublishedPapers: affected.map((paper) => paper.id) };
      await connection.commit();
    } catch (cause) { await connection.rollback(); console.error("Question transition failed", cause); return NextResponse.json({ error: "The status change failed; no changes were saved." }, { status: 500 }); }
    finally { connection.release(); }
    await auditAdmin(principal, request, target, "question", id, auditOld, auditNew);
    refreshQuestions();
    return NextResponse.json({ ok: true, status: target });
  }

  if (!requirePermission(principal, "mcq.edit_any") && !requirePermission(principal, "mcq.edit_own")) return NextResponse.json({ error: "Your role cannot edit questions." }, { status: 403 });
  const parsed = parseQuestion(body);
  if (!parsed) return NextResponse.json({ error: "Check the topic, question, four distinct choices, correct answer, and explanation." }, { status: 400 });
  if (parsed.paperIds !== undefined && !requirePermission(principal, "paper.add_questions")) return NextResponse.json({ error: "Your role cannot add questions to past papers." }, { status: 403 });
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: "Refresh this MCQ before editing; its version is missing." }, { status: 428 });
  const keepStatus = body?.keepStatus === true;
  if (keepStatus && principal.role !== "admin" && principal.role !== "super_admin") return NextResponse.json({ error: "Only an Admin or Super Admin can override the review reset." }, { status: 403 });
  const connection = await db.getConnection();
  let oldStatus: QuestionStatus = "draft";
  let newStatus: QuestionStatus = "draft";
  let revisionId: number | null = null;
  let affectedPapers: Array<{ id: number; title: string; slug: string }> = [];
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.execute<Array<RowDataPacket & { id: number; status: QuestionStatus; created_by: number | null; version: number; correct_choice: string; question_text: string; explanation: string; source_note: string; question_image_url: string | null }>>(
      "SELECT id, status, created_by, version, correct_choice, question_text, explanation, source_note, question_image_url FROM questions WHERE id = ? FOR UPDATE", [id],
    );
    const existing = existingRows[0];
    if (!existing) { await connection.rollback(); return NextResponse.json({ error: "Question not found." }, { status: 404 }); }
    if (existing.version !== expectedVersion) { await connection.rollback(); return NextResponse.json({ error: "This MCQ changed since you opened it. Reload it and apply your changes again.", currentVersion: existing.version }, { status: 409 }); }
    if (!canActorEditQuestion(principal, existing.created_by, existing.status, requirePermission(principal, "mcq.edit_any"), requirePermission(principal, "mcq.edit_own"))) { await connection.rollback(); return NextResponse.json({ error: "Data Entry can edit only its own draft or rejected MCQs." }, { status: 403 }); }
    oldStatus = existing.status;
    newStatus = statusAfterQuestionEdit(existing.status, keepStatus) as QuestionStatus;
    if (newStatus !== existing.status) {
      const editTransition = getQuestionTransition(existing.status, newStatus);
      if (!editTransition || !requirePermission(principal, editTransition.permission)) { await connection.rollback(); return NextResponse.json({ error: `Your role cannot move this MCQ from ${existing.status} to ${newStatus}.` }, { status: 403 }); }
    }
    const [topic] = await connection.execute<Array<RowDataPacket & { id: number }>>(
      "SELECT t.id FROM topics t JOIN subjects s ON s.id = t.subject_id WHERE t.id = ? AND t.status != 'archived' AND s.status != 'archived'", [parsed.topicId],
    );
    if (!topic[0]) { await connection.rollback(); return NextResponse.json({ error: "Choose an active topic." }, { status: 400 }); }
    if (parsed.paperIds && !await validatePaperIds(connection, parsed.paperIds)) { await connection.rollback(); return NextResponse.json({ error: "Choose active papers. Archived papers cannot receive MCQs." }, { status: 400 }); }
    const [oldChoices] = await connection.execute<Array<RowDataPacket & { label: string; choice_text: string; image_url: string | null }>>("SELECT label, choice_text, image_url FROM choices WHERE question_id = ? ORDER BY label FOR UPDATE", [id]);
    const choiceChanged = existing.correct_choice !== parsed.correctChoice || oldChoices.some((choice, index) => choice.choice_text !== parsed.choices[index]);
    if (existing.status === "published" && choiceChanged) {
      revisionId = await saveQuestionRevision(connection, id, principal.id, { questionText: existing.question_text, explanation: existing.explanation, sourceNote: existing.source_note, correctChoice: existing.correct_choice, questionImageUrl: existing.question_image_url, choices: oldChoices });
      await connection.execute("UPDATE quiz_attempt_answers SET question_revision_id = ? WHERE question_id = ? AND question_revision_id IS NULL", [revisionId, id]);
    }
    if (newStatus !== "published") {
      const [papers] = await connection.execute<Array<RowDataPacket & { id: number; title: string; slug: string }>>(
        "SELECT p.id, p.title, p.slug FROM paper_questions pq JOIN papers p ON p.id = pq.paper_id WHERE pq.question_id = ? AND p.status = 'published' FOR UPDATE", [id],
      );
      affectedPapers = papers;
      if (papers.length && body?.confirmPaperRemoval !== true) { await connection.rollback(); return NextResponse.json({ error: "This edit moves the MCQ out of published status. Confirm removal from these published papers.", affectedPapers: papers }, { status: 409 }); }
      if (papers.length) await connection.execute("DELETE FROM paper_questions WHERE question_id = ? AND paper_id IN (SELECT id FROM papers WHERE status = 'published')", [id]);
    }
    await connection.execute(
      "UPDATE questions SET topic_id = ?, question_text = ?, explanation = ?, source_note = ?, question_image_url = ?, correct_choice = ?, difficulty = ?, status = ?, review_note = IF(? = 'draft', NULL, review_note), updated_by = ?, version = version + 1 WHERE id = ? AND version = ?",
      [parsed.topicId, parsed.prompt, parsed.explanation, parsed.sourceNote, parsed.questionImageUrl, parsed.correctChoice, parsed.difficulty, newStatus, newStatus, principal.id, id, expectedVersion],
    );
    await connection.execute("DELETE FROM choices WHERE question_id = ?", [id]);
    for (let index = 0; index < labels.length; index++) await connection.execute("INSERT INTO choices (question_id, label, choice_text, image_url) VALUES (?, ?, ?, ?)", [id, labels[index], parsed.choices[index], parsed.choiceImageUrls[index]]);
    if (parsed.paperIds) await syncQuestionPapers(connection, id, parsed.paperIds);
    if (newStatus === "published" && existing.status === "published" && choiceChanged) {
      const nextRevision = await saveQuestionRevision(connection, id, principal.id, { questionText: parsed.prompt, explanation: parsed.explanation, sourceNote: parsed.sourceNote, correctChoice: parsed.correctChoice, questionImageUrl: parsed.questionImageUrl, choices: labels.map((label, index) => ({ label, choice_text: parsed.choices[index], image_url: parsed.choiceImageUrls[index] })) });
      await connection.execute("UPDATE questions SET current_revision_id = ? WHERE id = ?", [nextRevision, id]);
    }
    await connection.commit();
  } catch (cause) { await connection.rollback(); console.error("Admin question update failed", cause); return NextResponse.json({ error: "The question could not be updated; no changes were saved." }, { status: 500 }); }
  finally { connection.release(); }
  await auditAdmin(principal, request, "update", "question", id, { status: oldStatus, version: expectedVersion }, { status: newStatus, topicId: parsed.topicId, revisionId, adminStatusOverride: keepStatus && (principal.role === "admin" || principal.role === "super_admin"), removedFromPublishedPapers: affectedPapers.map((paper) => paper.id) });
  refreshQuestions();
  return NextResponse.json({ ok: true, status: newStatus, version: expectedVersion + 1 });
}

export async function DELETE(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "mcq.archive")) return NextResponse.json({ error: "Your role cannot archive questions." }, { status: 403 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid question." }, { status: 400 });
  const [rows] = await db.execute<Array<RowDataPacket & { status: QuestionStatus }>>("SELECT status FROM questions WHERE id = ?", [id]);
  const current = rows[0];
  if (!current) return NextResponse.json({ error: "Question not found." }, { status: 404 });
  const transition = getQuestionTransition(current.status, "archived");
  if (!transition || !requirePermission(principal, transition.permission)) return NextResponse.json({ error: `Illegal question transition: ${current.status} → archived.` }, { status: 409 });
  const redirect = new Request(request.url, { method: "PATCH", headers: request.headers, body: JSON.stringify({ ...body, status: "archived" }) });
  return PATCH(redirect);
}

async function saveQuestionRevision(connection: import("mysql2/promise").PoolConnection, questionId: number, adminId: string, override?: Record<string, unknown>) {
  let snapshot = override;
  if (!snapshot) {
    const [questions] = await connection.execute<Array<RowDataPacket & { question_text: string; explanation: string; source_note: string; correct_choice: string; question_image_url: string | null }>>(
      "SELECT question_text, explanation, source_note, correct_choice, question_image_url FROM questions WHERE id = ?", [questionId],
    );
    const [choices] = await connection.execute<Array<RowDataPacket & { label: string; choice_text: string; image_url: string | null }>>("SELECT label, choice_text, image_url FROM choices WHERE question_id = ? ORDER BY label", [questionId]);
    snapshot = { ...questions[0], choices };
  }
  const [countRows] = await connection.execute<Array<RowDataPacket & { revision_count: number }>>("SELECT COUNT(*) AS revision_count FROM question_revisions WHERE question_id = ?", [questionId]);
  const [insert] = await connection.execute(
    "INSERT INTO question_revisions (question_id, revision_number, content_snapshot, created_by) VALUES (?, ?, ?, ?)",
    [questionId, Number(countRows[0]?.revision_count ?? 0) + 1, JSON.stringify(snapshot), adminId],
  );
  return Number((insert as { insertId: number }).insertId);
}
