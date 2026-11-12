import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal } from "@/lib/admin-auth";
import { auditAdmin, csrfFailure } from "@/lib/admin-security";
import { db, hasDatabase } from "@/lib/db";
import { duplicateKey } from "@/lib/question-duplicates";

type QuestionRow = RowDataPacket & {
  id: number; topic_id: number; topic_name: string; subject_name: string; question_text: string;
  explanation: string; source_note: string; correct_choice: string; difficulty: string; language: string;
  status: string; question_image_url: string | null; label: string | null; choice_text: string | null;
  image_url: string | null; attempt_count?: number;
};

function unauthorized() { return NextResponse.json({ error: "Only the Super Admin can manage duplicate MCQs." }, { status: 403 }); }
function noDatabase() { return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 }); }

function refreshQuestions() {
  revalidatePath("/");
  revalidatePath("/subjects");
  revalidatePath("/past-papers");
  revalidateTag("questions", { expire: 0 });
  revalidateTag("papers", { expire: 0 });
}

function groupRows(rows: QuestionRow[], attempts: Map<number, number>) {
  const grouped = new Map<number, {
    id: number; topicId: number; topicName: string; subjectName: string; prompt: string; explanation: string;
    sourceNote: string; correctChoice: string; difficulty: string; language: string; status: string;
    questionImageUrl: string | null; attemptCount: number; choices: Array<{ label: string; text: string; imageUrl: string | null }>;
  }>();
  for (const row of rows) {
    let item = grouped.get(row.id);
    if (!item) {
      item = {
        id: row.id, topicId: row.topic_id, topicName: row.topic_name, subjectName: row.subject_name,
        prompt: row.question_text, explanation: row.explanation, sourceNote: row.source_note,
        correctChoice: row.correct_choice, difficulty: row.difficulty, language: row.language,
        status: row.status, questionImageUrl: row.question_image_url, attemptCount: attempts.get(row.id) ?? 0, choices: [],
      };
      grouped.set(row.id, item);
    }
    if (row.label) item.choices.push({ label: row.label, text: row.choice_text ?? "", imageUrl: row.image_url });
  }
  return [...grouped.values()].map((question) => ({
    ...question,
    choices: question.choices.sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

export async function GET() {
  const principal = await getAdminPrincipal();
  if (!principal || principal.role !== "super_admin") return unauthorized();
  if (!hasDatabase || !db) return noDatabase();

  try {
    const [questionRows] = await db.execute<QuestionRow[]>(
      `SELECT q.id, q.topic_id, t.name AS topic_name, s.name AS subject_name,
              q.question_text, q.explanation, q.source_note, q.correct_choice, q.difficulty,
              q.language, q.status, q.question_image_url, c.label, c.choice_text, c.image_url
       FROM questions q
       JOIN topics t ON t.id = q.topic_id
       JOIN subjects s ON s.id = t.subject_id
       LEFT JOIN choices c ON c.question_id = q.id
       ORDER BY q.id ASC, c.label ASC`,
    );
    const [attemptRows] = await db.execute<Array<RowDataPacket & { question_id: number; total: number }>>(
      "SELECT question_id, COUNT(*) AS total FROM quiz_attempt_answers GROUP BY question_id",
    );
    const attempts = new Map(attemptRows.map((row) => [row.question_id, Number(row.total)]));
    const questions = groupRows(questionRows, attempts);
    const [paperRows] = await db.execute<Array<RowDataPacket & { question_id: number; paper_id: number; title: string; status: string }>>(
      `SELECT pq.question_id, p.id AS paper_id, p.title, p.status
       FROM paper_questions pq JOIN papers p ON p.id = pq.paper_id`,
    );
    const papersByQuestion = new Map<number, Array<{ id: number; title: string; status: string }>>();
    for (const paper of paperRows) papersByQuestion.set(paper.question_id, [...(papersByQuestion.get(paper.question_id) ?? []), { id: paper.paper_id, title: paper.title, status: paper.status }]);

    const groups = new Map<string, typeof questions>();
    for (const question of questions) {
      if (question.choices.length !== 4 || !"ABCD".includes(question.correctChoice)) continue;
      const key = duplicateKey({ prompt: question.prompt, choices: question.choices.map((choice) => choice.text), correctChoice: question.correctChoice });
      groups.set(key, [...(groups.get(key) ?? []), question]);
    }
    const statusRank: Record<string, number> = { published: 0, approved: 1, in_review: 2, draft: 3, rejected: 4, archived: 5 };
    const duplicates = [...groups.values()].filter((items) => items.length > 1).map((items) => {
      const sorted = [...items].sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || a.id - b.id);
      const withPapers = (question: typeof sorted[number]) => ({ ...question, papers: papersByQuestion.get(question.id) ?? [] });
      return { canonical: withPapers(sorted[0]), duplicates: sorted.slice(1).map(withPapers) };
    }).sort((a, b) => a.canonical.id - b.canonical.id);
    const [activePapers] = await db.execute<Array<RowDataPacket & { id: number; title: string; status: string }>>(
      "SELECT id, title, status FROM papers WHERE status != 'archived' ORDER BY title ASC",
    );
    return NextResponse.json({ groups: duplicates, papers: activePapers }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Duplicate MCQ manager could not load", cause);
    return NextResponse.json({ error: "Could not load duplicate MCQs. Check the server logs and retry." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || principal.role !== "super_admin") return unauthorized();
  if (!hasDatabase || !db) return noDatabase();
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const duplicateId = Number(body?.duplicateId);
  const canonicalId = Number(body?.canonicalId);
  const paperIds: number[] | null = Array.isArray(body?.paperIds) ? [...new Set((body.paperIds as unknown[]).map(Number))] : null;
  if (!Number.isSafeInteger(duplicateId) || duplicateId < 1 || !Number.isSafeInteger(canonicalId) || canonicalId < 1 || duplicateId === canonicalId || !["move-paper-links", "delete-duplicate"].includes(action) || !paperIds || paperIds.length > 100 || paperIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    return NextResponse.json({ error: "Choose a valid duplicate, canonical MCQ, action, and up to 100 destination papers." }, { status: 400 });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [duplicateId, canonicalId].sort((a, b) => a - b);
    const [questionRows] = await connection.execute<Array<RowDataPacket & { id: number; question_text: string; correct_choice: string; status: string }>>(
      `SELECT id, question_text, correct_choice, status FROM questions WHERE id IN (?, ?) ORDER BY id FOR UPDATE`, ids,
    );
    if (questionRows.length !== 2) { await connection.rollback(); return NextResponse.json({ error: "The duplicate or canonical MCQ no longer exists." }, { status: 404 }); }
    const [choiceRows] = await connection.execute<Array<RowDataPacket & { question_id: number; label: string; choice_text: string }>>(
      "SELECT question_id, label, choice_text FROM choices WHERE question_id IN (?, ?) ORDER BY question_id, label FOR UPDATE", ids,
    );
    const choiceMap = new Map<number, string[]>();
    for (const choice of choiceRows) {
      const options = choiceMap.get(choice.question_id) ?? ["", "", "", ""];
      options[choice.label.charCodeAt(0) - 65] = choice.choice_text;
      choiceMap.set(choice.question_id, options);
    }
    const questionById = new Map(questionRows.map((question) => [question.id, question]));
    const duplicate = questionById.get(duplicateId)!;
    const canonical = questionById.get(canonicalId)!;
    const validKey = (question: typeof duplicate) => {
      const choices = choiceMap.get(question.id) ?? [];
      return choices.length === 4 && choices.every(Boolean) && "ABCD".includes(question.correct_choice)
        ? duplicateKey({ prompt: question.question_text, choices, correctChoice: question.correct_choice })
        : "";
    };
    if (!validKey(duplicate) || validKey(duplicate) !== validKey(canonical)) {
      await connection.rollback();
      return NextResponse.json({ error: "These MCQs are no longer exact duplicates. Refresh the duplicate list before continuing." }, { status: 409 });
    }
    if (action === "delete-duplicate") {
      const [attemptRows] = await connection.execute<Array<RowDataPacket & { total: number }>>(
        "SELECT COUNT(*) AS total FROM quiz_attempt_answers WHERE question_id = ?", [duplicateId],
      );
      if (Number(attemptRows[0]?.total ?? 0) > 0) {
        await connection.rollback();
        return NextResponse.json({ error: "This MCQ has learner attempt history, so it cannot be permanently deleted. Archive it to keep past results intact." }, { status: 409 });
      }
    }
    if (paperIds.length) {
      const [targetPapers] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>(
        `SELECT id, status FROM papers WHERE id IN (${paperIds.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, paperIds,
      );
      if (targetPapers.length !== paperIds.length || targetPapers.some((paper) => paper.status === "archived")) {
        await connection.rollback();
        return NextResponse.json({ error: "One or more selected destination papers are archived or unavailable." }, { status: 400 });
      }
      if (targetPapers.some((paper) => paper.status === "published") && canonical.status !== "published") {
        await connection.rollback();
        return NextResponse.json({ error: "The canonical MCQ must be published before it can be linked to a published paper." }, { status: 400 });
      }
    }
    const [existingLinks] = await connection.execute<Array<RowDataPacket & { paper_id: number; question_id: number }>>(
      "SELECT paper_id, question_id FROM paper_questions WHERE question_id IN (?, ?) ORDER BY paper_id FOR UPDATE", ids,
    );
    await connection.execute("DELETE FROM paper_questions WHERE question_id = ?", [duplicateId]);
    for (const paperId of paperIds) {
      if (existingLinks.some((link) => link.paper_id === paperId && link.question_id === canonicalId)) continue;
      const [maxRows] = await connection.execute<Array<RowDataPacket & { max_order: number | null }>>(
      "SELECT MAX(question_order) AS max_order FROM paper_questions WHERE paper_id = ?", [paperId],
      );
      await connection.execute(
        "INSERT INTO paper_questions (paper_id, question_id, question_order) VALUES (?, ?, ?)",
        [paperId, canonicalId, Number(maxRows[0]?.max_order ?? 0) + 1],
      );
    }
    if (action === "delete-duplicate") {
      await connection.execute(
        "INSERT IGNORE INTO learner_bookmarks (learner_id, question_id) SELECT learner_id, ? FROM learner_bookmarks WHERE question_id = ?",
        [canonicalId, duplicateId],
      );
      await connection.execute("DELETE FROM learner_bookmarks WHERE question_id = ?", [duplicateId]);
      await connection.execute(
        "INSERT IGNORE INTO learner_wrong_question_dismissals (learner_id, question_id, dismissed_at) SELECT learner_id, ?, dismissed_at FROM learner_wrong_question_dismissals WHERE question_id = ?",
        [canonicalId, duplicateId],
      );
      await connection.execute("DELETE FROM learner_wrong_question_dismissals WHERE question_id = ?", [duplicateId]);
      const [deleteResult] = await connection.execute("DELETE FROM questions WHERE id = ?", [duplicateId]);
      if (Number((deleteResult as { affectedRows?: number }).affectedRows ?? 0) !== 1) throw new Error("The duplicate MCQ could not be deleted.");
    }
    await connection.commit();
  } catch (cause) {
    await connection.rollback();
    console.error("Duplicate MCQ action failed", cause);
    return NextResponse.json({ error: "The duplicate action was rolled back. No paper links or MCQs were changed." }, { status: 500 });
  } finally {
    connection.release();
  }
  await auditAdmin(principal, request, action === "delete-duplicate" ? "permanent_duplicate_delete" : "duplicate_paper_links_updated", "question", duplicateId, { duplicateId, canonicalId }, { action, duplicateId, canonicalId, paperIds });
  refreshQuestions();
  return NextResponse.json({ ok: true, action, duplicateId, canonicalId });
}
