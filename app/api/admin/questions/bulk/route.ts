import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, hasPermission } from "@/lib/admin-auth";
import { requestedStatus } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";

const labels = ["A", "B", "C", "D"] as const;
type InputQuestion = { prompt: string; choices: string[]; correctChoice: string; explanation: string };

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function refreshContent() {
  revalidatePath("/");
  revalidatePath("/subjects");
  revalidatePath("/past-papers");
  revalidateTag("subjects", "max");
  revalidateTag("topics", "max");
  revalidateTag("questions", "max");
  revalidateTag("papers", "max");
}

function parseInputQuestion(value: unknown): InputQuestion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
  const choices = Array.isArray(row.choices) ? row.choices.map((choice) => typeof choice === "string" ? choice.trim() : "") : [];
  const correctChoice = typeof row.correctChoice === "string" ? row.correctChoice : "";
  const explanation = typeof row.explanation === "string" ? row.explanation.trim() : "";
  const normalized = choices.map((choice) => choice.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase());
  if (prompt.length < 8 || prompt.length > 1500 || choices.length !== 4 || choices.some((choice) => !choice || choice.length > 800) || new Set(normalized).size !== 4 || !labels.includes(correctChoice as typeof labels[number]) || explanation.length > 3000) return null;
  return { prompt, choices, correctChoice, explanation };
}

function parseIds(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const ids = [...new Set(value.map(Number))];
  return ids.length && ids.every((id) => Number.isSafeInteger(id) && id > 0) ? ids : null;
}

async function appendToPaper(connection: import("mysql2/promise").PoolConnection, paperId: number, questionIds: number[]) {
  const [paper] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>(
    "SELECT id, status FROM papers WHERE id = ? FOR UPDATE", [paperId],
  );
  if (!paper[0] || paper[0].status === "archived") return { error: "Choose an active past paper." };
  const [links] = await connection.execute<Array<RowDataPacket & { question_id: number; question_order: number }>>(
    "SELECT question_id, question_order FROM paper_questions WHERE paper_id = ? ORDER BY question_order FOR UPDATE", [paperId],
  );
  const existing = new Set(links.map((link) => link.question_id));
  const newIds = questionIds.filter((id) => !existing.has(id));
  let nextOrder = Math.max(0, ...links.map((link) => Number(link.question_order))) + 1;
  for (const questionId of newIds) {
    await connection.execute("INSERT INTO paper_questions (paper_id, question_id, question_order) VALUES (?, ?, ?)", [paperId, questionId, nextOrder++]);
  }
  return { added: newIds.length };
}

async function removeFromPaper(connection: import("mysql2/promise").PoolConnection, paperId: number, questionIds: number[]) {
  const [paper] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>(
    "SELECT id, status FROM papers WHERE id = ? FOR UPDATE", [paperId],
  );
  if (!paper[0] || paper[0].status === "archived") return { error: "Choose an active past paper." };
  const marks = questionIds.map(() => "?").join(",");
  await connection.execute(`DELETE FROM paper_questions WHERE paper_id = ? AND question_id IN (${marks})`, [paperId, ...questionIds]);
  const [remaining] = await connection.execute<Array<RowDataPacket & { question_id: number; question_order: number }>>(
    "SELECT question_id, question_order FROM paper_questions WHERE paper_id = ? ORDER BY question_order FOR UPDATE", [paperId],
  );
  for (const [index, row] of remaining.entries()) {
    await connection.execute("UPDATE paper_questions SET question_order = ? WHERE paper_id = ? AND question_id = ?", [-(index + 1), paperId, row.question_id]);
  }
  for (const [index, row] of remaining.entries()) {
    await connection.execute("UPDATE paper_questions SET question_order = ? WHERE paper_id = ? AND question_id = ?", [index + 1, paperId, row.question_id]);
  }
  return { removed: questionIds.length };
}

export async function POST(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal) return error("Please sign in first.", 401);
  if (!hasDatabase || !db) return error("Configure MySQL and apply the database migrations first.", 503);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "import") {
    if (!hasPermission(principal, "questions:manage")) return error("Your role cannot add questions.", 403);
    const topicId = Number(body?.topicId);
    const paperId = body?.paperId === null || body?.paperId === undefined || body?.paperId === "" ? null : Number(body.paperId);
    const sourceNote = typeof body?.sourceNote === "string" ? body.sourceNote.trim() : "";
    const difficulty = body?.difficulty === "easy" || body?.difficulty === "hard" ? body.difficulty : "medium";
    const inputs = Array.isArray(body?.questions) ? body.questions : [];
    if (!Number.isSafeInteger(topicId) || topicId < 1 || sourceNote.length < 4 || sourceNote.length > 500 || inputs.length < 1 || inputs.length > 100 || (paperId !== null && (!Number.isSafeInteger(paperId) || paperId < 1))) return error("Choose a category, source reference, and 1–100 valid MCQs.");
    if (paperId !== null && !hasPermission(principal, "papers:manage")) return error("Your role cannot add questions to past papers.", 403);
    const parsed = inputs.map(parseInputQuestion);
    if (parsed.some((row) => !row)) return error("One or more MCQs failed server validation. Fix the preview errors and try again.");
    const status = requestedStatus(body?.status, principal);
    const connection = await db.getConnection();
    const createdIds: number[] = [];
    try {
      await connection.beginTransaction();
      const [topic] = await connection.execute<Array<RowDataPacket & { id: number }>>(
        `SELECT t.id FROM topics t JOIN subjects s ON s.id = t.subject_id
         WHERE t.id = ? AND t.status != 'archived' AND s.status != 'archived'
           AND (? != 'published' OR (t.status = 'published' AND s.status = 'published')) FOR UPDATE`,
        [topicId, status],
      );
      if (!topic[0]) {
        await connection.rollback();
        return error("Choose an active category. Published MCQs need a published subject and topic.");
      }
      if (paperId !== null) {
        const [paper] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>("SELECT id, status FROM papers WHERE id = ? FOR UPDATE", [paperId]);
        if (!paper[0] || paper[0].status === "archived" || (paper[0].status === "published" && status !== "published")) {
          await connection.rollback();
          return error("Choose a draft paper, or publish these MCQs before adding them to the published paper.");
        }
      }
      for (const item of parsed as InputQuestion[]) {
        const [insert] = await connection.execute(
          `INSERT INTO questions (topic_id, question_text, explanation, source_note, correct_choice, difficulty, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [topicId, item.prompt, item.explanation, sourceNote, item.correctChoice, difficulty, status],
        );
        const questionId = Number((insert as { insertId: number }).insertId);
        createdIds.push(questionId);
        for (let index = 0; index < labels.length; index++) {
          await connection.execute("INSERT INTO choices (question_id, label, choice_text) VALUES (?, ?, ?)", [questionId, labels[index], item.choices[index]]);
        }
      }
      if (paperId !== null) {
        const linked = await appendToPaper(connection, paperId, createdIds);
        if (linked.error) {
          await connection.rollback();
          return error(linked.error);
        }
      }
      await connection.commit();
    } catch (cause) {
      await connection.rollback();
      console.error("Bulk MCQ import failed", cause);
      return error("The MCQs could not be imported. No rows were saved.", 500);
    } finally {
      connection.release();
    }
    refreshContent();
    return NextResponse.json({ ok: true, ids: createdIds, count: createdIds.length });
  }

  const ids = parseIds(body?.ids);
  if (!ids) return error("Select between 1 and 100 MCQs.");
  const topicId = Number(body?.topicId);
  const paperId = Number(body?.paperId);

  if (action === "change-category" && !hasPermission(principal, "questions:manage")) return error("Your role cannot edit questions.", 403);
  if (action === "submit-review" && !hasPermission(principal, "questions:manage")) return error("Your role cannot submit questions for review.", 403);
  if (action === "publish" && !hasPermission(principal, "content:publish")) return error("Only Paper Managers and Super Admins can publish questions.", 403);
  if (action === "archive" && !hasPermission(principal, "content:delete")) return error("Only the Super Admin can archive questions.", 403);
  if ((action === "add-to-paper" || action === "remove-from-paper") && !hasPermission(principal, "papers:manage")) return error("Your role cannot manage past-paper questions.", 403);
  if (!["change-category", "submit-review", "publish", "archive", "add-to-paper", "remove-from-paper"].includes(action)) return error("Choose a supported bulk action.");
  if (action === "change-category" && (!Number.isSafeInteger(topicId) || topicId < 1)) return error("Choose a valid category.");
  if ((action === "add-to-paper" || action === "remove-from-paper") && (!Number.isSafeInteger(paperId) || paperId < 1)) return error("Choose a valid past paper.");

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const marks = ids.map(() => "?").join(",");
    const [questions] = await connection.execute<Array<RowDataPacket & { id: number; status: string; source_note: string; topic_status: string; subject_status: string }>>(
      `SELECT q.id, q.status, q.source_note, t.status AS topic_status, s.status AS subject_status
       FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
       WHERE q.id IN (${marks}) FOR UPDATE`, ids,
    );
    if (questions.length !== ids.length) {
      await connection.rollback();
      return error("One or more selected MCQs no longer exist.", 404);
    }
    if (action === "change-category") {
      const [topic] = await connection.execute<Array<RowDataPacket & { id: number }>>(
        `SELECT t.id FROM topics t JOIN subjects s ON s.id = t.subject_id
         WHERE t.id = ? AND t.status != 'archived' AND s.status != 'archived'`, [topicId],
      );
      if (!topic[0] || questions.some((question) => question.status === "archived") || (questions.some((question) => question.status === "published") && !hasPermission(principal, "content:publish"))) {
        await connection.rollback();
        return error("Choose an active category. Your role can change categories on draft MCQs only.", 403);
      }
      await connection.execute(`UPDATE questions SET topic_id = ? WHERE id IN (${marks})`, [topicId, ...ids]);
    } else if (action === "submit-review") {
      if (questions.some((question) => question.status !== "draft")) {
        await connection.rollback();
        return error("Only draft MCQs can be submitted for review.");
      }
      await connection.execute(`UPDATE questions SET status = 'draft' WHERE id IN (${marks})`, ids);
    } else if (action === "publish") {
      if (questions.some((question) => question.status === "archived" || !question.source_note.trim() || question.topic_status !== "published" || question.subject_status !== "published")) {
        await connection.rollback();
        return error("Every selected MCQ needs a source and a published subject/topic before it can be published.");
      }
      await connection.execute(`UPDATE questions SET status = 'published' WHERE id IN (${marks})`, ids);
    } else if (action === "archive") {
      await connection.execute(`UPDATE questions SET status = 'archived' WHERE id IN (${marks})`, ids);
    } else if (action === "add-to-paper") {
      const [paper] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>("SELECT id, status FROM papers WHERE id = ? FOR UPDATE", [paperId]);
      if (!paper[0] || paper[0].status === "archived" || questions.some((question) => question.status === "archived") || (paper[0].status === "published" && questions.some((question) => question.status !== "published"))) {
        await connection.rollback();
        return error("Choose an active paper. Published papers can only contain published MCQs.");
      }
      const linked = await appendToPaper(connection, paperId, ids);
      if (linked.error) {
        await connection.rollback();
        return error(linked.error);
      }
    } else {
      const [paper] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>("SELECT id, status FROM papers WHERE id = ? FOR UPDATE", [paperId]);
      if (!paper[0] || paper[0].status === "archived") {
        await connection.rollback();
        return error("Choose an active past paper.");
      }
      await removeFromPaper(connection, paperId, ids);
    }
    await connection.commit();
  } catch (cause) {
    await connection.rollback();
    console.error("Bulk MCQ action failed", cause);
    return error("The bulk action could not be completed.", 500);
  } finally {
    connection.release();
  }
  refreshContent();
  return NextResponse.json({ ok: true, count: ids.length });
}
