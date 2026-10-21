import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, hasPermission } from "@/lib/admin-auth";
import { requestedStatus } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";

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
  const difficulty = body?.difficulty === "easy" || body?.difficulty === "hard" ? body.difficulty : "medium";
  const paperIds = body && Object.hasOwn(body, "paperIds")
    ? Array.isArray(body.paperIds) ? [...new Set(body.paperIds.map(Number))] : null
    : undefined;
  if (!Number.isInteger(topicId) || topicId < 1 || prompt.length < 8 || prompt.length > 1500 || explanation.length < 3 || explanation.length > 3000 || sourceNote.length < 4 || sourceNote.length > 500 || choices.length !== 4 || choices.some((choice) => choice.length < 1 || choice.length > 800) || !labels.includes(correctChoice as typeof labels[number]) || paperIds === null || (paperIds && (paperIds.length > 50 || paperIds.some((id) => !Number.isSafeInteger(id) || id < 1)))) return null;
  return { topicId, prompt, explanation, sourceNote, choices, correctChoice, difficulty, paperIds };
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
    const [maxRows] = await connection.execute<Array<RowDataPacket & { max_order: number | null }>>(
      "SELECT MAX(question_order) AS max_order FROM paper_questions WHERE paper_id = ?", [paperId],
    );
    const order = Number(maxRows[0]?.max_order ?? 0) + 1;
    await connection.execute("INSERT INTO paper_questions (paper_id, question_id, question_order) VALUES (?, ?, ?)", [paperId, questionId, order]);
  }
}

export async function GET() {
  const principal = await getAdminPrincipal();
  if (!principal || !hasPermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return noDatabase();
  const [questions] = await db.execute<Array<RowDataPacket & { id: number; topic_id: number; topic_name: string; subject_name: string; prompt: string; explanation: string; source_note: string; correct_choice: string; difficulty: string; status: string; updated_at: string }>>(
    `SELECT q.id, q.topic_id, t.name AS topic_name, s.name AS subject_name,
            q.question_text AS prompt, q.explanation, q.source_note, q.correct_choice, q.difficulty, q.status, q.updated_at
     FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
     ORDER BY q.updated_at DESC, q.id DESC LIMIT 500`,
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
    ? await db.execute<Array<RowDataPacket & { question_id: number; label: string; choice_text: string }>>(
      `SELECT question_id, label, choice_text FROM choices
       WHERE question_id IN (${questionIds.map(() => "?").join(",")}) ORDER BY question_id DESC, label`, questionIds,
    )
    : [[] as Array<RowDataPacket & { question_id: number; label: string; choice_text: string }>];
  const choiceMap = new Map<number, Array<{ label: string; text: string }>>();
  for (const choice of choices) {
    const list = choiceMap.get(choice.question_id) ?? [];
    list.push({ label: choice.label, text: choice.choice_text });
    choiceMap.set(choice.question_id, list);
  }
  return NextResponse.json({ questions: questions.map((question) => ({
    id: question.id, topicId: question.topic_id, topicName: question.topic_name, subjectName: question.subject_name,
    prompt: question.prompt, explanation: question.explanation, sourceNote: question.source_note, correctChoice: question.correct_choice,
    difficulty: question.difficulty, status: question.status, paperIds: paperIdMap.get(question.id) ?? [],
    choices: choiceMap.get(question.id) ?? [],
  })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal || !hasPermission(principal, "questions:manage")) return NextResponse.json({ error: "Your role cannot add questions." }, { status: 403 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const parsed = parseQuestion(body);
  if (!parsed) return NextResponse.json({ error: "Add a source reference and check the topic, question, four choices, correct answer, and explanation." }, { status: 400 });
  if (parsed.paperIds !== undefined && !hasPermission(principal, "papers:manage")) return NextResponse.json({ error: "Your role cannot assign questions to past papers." }, { status: 403 });
  const status = requestedStatus(body?.status, principal);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const paperIds = parsed.paperIds ?? [];
    if (!await validatePaperIds(connection, paperIds)) {
      await connection.rollback();
      return NextResponse.json({ error: "Choose active past papers. Archived papers cannot receive MCQs." }, { status: 400 });
    }
    const [insert] = await connection.execute(
      `INSERT INTO questions (topic_id, question_text, explanation, source_note, correct_choice, difficulty, status)
       SELECT t.id, ?, ?, ?, ?, ?, ? FROM topics t JOIN subjects s ON s.id = t.subject_id
       WHERE t.id = ? AND t.status != 'archived' AND s.status != 'archived'
         AND (? != 'published' OR (t.status = 'published' AND s.status = 'published'))`,
      [parsed.prompt, parsed.explanation, parsed.sourceNote, parsed.correctChoice, parsed.difficulty, status, parsed.topicId, status],
    );
    const questionId = (insert as { insertId: number }).insertId;
    if (!questionId) {
      await connection.rollback();
      return NextResponse.json({ error: "Choose a valid subject and topic. Published questions need a published topic." }, { status: 400 });
    }
    for (let index = 0; index < labels.length; index++) {
      await connection.execute("INSERT INTO choices (question_id, label, choice_text) VALUES (?, ?, ?)", [questionId, labels[index], parsed.choices[index]]);
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
  refreshQuestions();
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid question." }, { status: 400 });

  if (body?.status === "published" || body?.status === "archived") {
    const permission = body.status === "published" ? "content:publish" : "content:delete";
    if (!hasPermission(principal, permission)) return NextResponse.json({ error: body.status === "published" ? "Only Paper Managers and Super Admins can publish questions." : "Only the Super Admin can archive questions." }, { status: 403 });
    const status = body.status;
    const [current] = await db.execute<Array<RowDataPacket & { id: number; topic_status: string; subject_status: string; source_note: string }>>(
      `SELECT q.id, t.status AS topic_status, s.status AS subject_status, q.source_note
       FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
       WHERE q.id = ? LIMIT 1`, [id],
    );
    if (!current[0]) return NextResponse.json({ error: "Question not found." }, { status: 404 });
    if (status === "published" && !current[0].source_note.trim()) return NextResponse.json({ error: "Add the exam and source reference before publishing this MCQ." }, { status: 400 });
    if (status === "published" && (current[0].topic_status !== "published" || current[0].subject_status !== "published")) {
      return NextResponse.json({ error: "Publish its subject and topic before publishing this question." }, { status: 400 });
    }
    const sql = status === "published"
      ? `UPDATE questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
         SET q.status = 'published' WHERE q.id = ? AND t.status = 'published' AND s.status = 'published'`
      : "UPDATE questions SET status = 'archived' WHERE id = ?";
    await db.execute(sql, [id]);
    refreshQuestions();
    return NextResponse.json({ ok: true });
  }

  if (!hasPermission(principal, "questions:manage")) return NextResponse.json({ error: "Your role cannot edit questions." }, { status: 403 });
  const parsed = parseQuestion(body);
  if (!parsed) return NextResponse.json({ error: "Add a source reference and check the topic, question, four choices, correct answer, and explanation." }, { status: 400 });
  if (parsed.paperIds !== undefined && !hasPermission(principal, "papers:manage")) return NextResponse.json({ error: "Your role cannot assign questions to past papers." }, { status: 403 });
  const status = requestedStatus(body?.status, principal);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>("SELECT id, status FROM questions WHERE id = ? LIMIT 1", [id]);
    if (!existing[0]) {
      await connection.rollback();
      return NextResponse.json({ error: "Question not found." }, { status: 404 });
    }
    if (existing[0].status === "published" && !hasPermission(principal, "content:publish")) {
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
    if (parsed.paperIds !== undefined && !await validatePaperIds(connection, parsed.paperIds)) {
      await connection.rollback();
      return NextResponse.json({ error: "Choose active past papers. Archived papers cannot receive MCQs." }, { status: 400 });
    }
    await connection.execute(
      "UPDATE questions SET topic_id = ?, question_text = ?, explanation = ?, source_note = ?, correct_choice = ?, difficulty = ?, status = ? WHERE id = ?",
      [parsed.topicId, parsed.prompt, parsed.explanation, parsed.sourceNote, parsed.correctChoice, parsed.difficulty, status, id],
    );
    await connection.execute("DELETE FROM choices WHERE question_id = ?", [id]);
    for (let index = 0; index < labels.length; index++) {
      await connection.execute("INSERT INTO choices (question_id, label, choice_text) VALUES (?, ?, ?)", [id, labels[index], parsed.choices[index]]);
    }
    if (parsed.paperIds !== undefined) await syncQuestionPapers(connection, id, parsed.paperIds);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error("Admin question update failed", error);
    return NextResponse.json({ error: "The question could not be updated." }, { status: 500 });
  } finally {
    connection.release();
  }
  refreshQuestions();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal || !hasPermission(principal, "content:delete")) return NextResponse.json({ error: "Only the Super Admin can archive questions." }, { status: 403 });
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid question." }, { status: 400 });
  await db.execute("UPDATE questions SET status = 'archived' WHERE id = ?", [id]);
  refreshQuestions();
  return NextResponse.json({ ok: true });
}
