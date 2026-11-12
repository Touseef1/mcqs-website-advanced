import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { csrfFailure } from "@/lib/admin-security";
import { db, hasDatabase } from "@/lib/db";
import { duplicateKey, findExistingQuestionMatches, normalizeDuplicateText } from "@/lib/question-duplicates";

function similarity(first: string, second: string) {
  const a = new Set(normalizeDuplicateText(first).split(" ").filter(Boolean));
  const b = new Set(normalizeDuplicateText(second).split(" ").filter(Boolean));
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size || 1;
  return Math.round((intersection / union) * 100);
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "mcq.create")) return NextResponse.json({ error: "Your role cannot check for duplicate MCQs." }, { status: 403 });
  if (!hasDatabase || !db) return NextResponse.json({ similar: [] });
  const body = await request.json().catch(() => null);
  if (body?.action === "details") {
    const requestedId = Number(body.questionId);
    if (!Number.isSafeInteger(requestedId) || requestedId < 1) return NextResponse.json({ error: "Choose a valid MCQ." }, { status: 400 });
    const [questionRows] = await db.execute<Array<RowDataPacket & {
      id: number; question_text: string; explanation: string; source_note: string; correct_choice: string;
      difficulty: string; language: string; question_image_url: string | null; status: string;
      topic_id: number; topic_name: string; subject_name: string;
    }>>(
      `SELECT q.id, q.question_text, q.explanation, q.source_note, q.correct_choice, q.difficulty,
              q.language, q.question_image_url, q.status, q.topic_id, t.name AS topic_name, s.name AS subject_name
       FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
       WHERE q.id = ? AND q.status != 'archived' LIMIT 1`, [requestedId],
    );
    const questionRow = questionRows[0];
    if (!questionRow) return NextResponse.json({ error: "This existing MCQ is no longer available." }, { status: 404 });
    const [choiceRows] = await db.execute<Array<RowDataPacket & { label: string; choice_text: string; image_url: string | null }>>(
      "SELECT label, choice_text, image_url FROM choices WHERE question_id = ? ORDER BY label", [requestedId],
    );
    return NextResponse.json({ question: {
      id: questionRow.id, prompt: questionRow.question_text, explanation: questionRow.explanation,
      sourceNote: questionRow.source_note, correctChoice: questionRow.correct_choice,
      difficulty: questionRow.difficulty, language: questionRow.language, questionImageUrl: questionRow.question_image_url,
      status: questionRow.status, topicId: questionRow.topic_id, topicName: questionRow.topic_name,
      subjectName: questionRow.subject_name, paperIds: [], version: 1,
      choices: choiceRows.map((choice) => ({ label: choice.label, text: choice.choice_text, imageUrl: choice.image_url })),
    } }, { headers: { "Cache-Control": "no-store" } });
  }
  const questionId = Number(body?.questionId) || 0;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1500) : "";
  const choices = Array.isArray(body?.choices) ? body.choices.map((choice: unknown) => typeof choice === "string" ? choice.trim() : "") : [];
  const correctChoice = typeof body?.correctChoice === "string" ? body.correctChoice : "";
  const paperId = Number(body?.paperId) || 0;
  if (prompt.length < 8) return NextResponse.json({ similar: [] });

  const connection = await db.getConnection();
  try {
    const candidate = { rowNumber: 1, prompt, choices, correctChoice };
    const exact = choices.length === 4 && "ABCD".includes(correctChoice)
      ? await findExistingQuestionMatches(connection, [candidate], Number(body?.topicId) || 0, paperId > 0 ? [paperId] : [])
      : new Map();
    const exactMatch = exact.get(1);
    const [rows] = await connection.execute<Array<RowDataPacket & {
      id: number; question_text: string; correct_choice: string; status: string; topic_id: number;
      topic_name: string; subject_name: string; label: string | null; choice_text: string | null;
    }>>(
      `SELECT q.id, q.question_text, q.correct_choice, q.status, q.topic_id,
              t.name AS topic_name, s.name AS subject_name, c.label, c.choice_text
       FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
       LEFT JOIN choices c ON c.question_id = q.id
       WHERE q.status != 'archived' AND q.id != ?
       ORDER BY (q.status = 'published') DESC, q.id DESC LIMIT 8000`,
      [questionId],
    );
    const grouped = new Map<number, { prompt: string; correctChoice: string; status: string; topicId: number; topicName: string; subjectName: string; choices: string[] }>();
    for (const row of rows) {
      let item = grouped.get(row.id);
      if (!item) {
        item = { prompt: row.question_text, correctChoice: row.correct_choice, status: row.status, topicId: row.topic_id, topicName: row.topic_name, subjectName: row.subject_name, choices: ["", "", "", ""] };
        grouped.set(row.id, item);
      }
      if (row.label && row.choice_text) item.choices[row.label.charCodeAt(0) - 65] = row.choice_text;
    }
    const candidates = [...grouped].map(([id, item]) => ({
      id, ...item, similarity: similarity(prompt, item.prompt),
      exact: choices.length === 4 && "ABCD".includes(correctChoice) && duplicateKey(candidate) === duplicateKey({ prompt: item.prompt, choices: item.choices, correctChoice: item.correctChoice }),
    })).filter((item) => item.id !== exactMatch?.id && item.similarity >= 65).sort((a, b) => b.similarity - a.similarity).slice(0, 5);
    const similarIds = candidates.map((item) => item.id);
    const paperLinks = new Map<number, number[]>();
    if (paperId > 0 && similarIds.length) {
      const [links] = await connection.execute<Array<RowDataPacket & { question_id: number; paper_id: number }>>(
        `SELECT question_id, paper_id FROM paper_questions WHERE paper_id = ? AND question_id IN (${similarIds.map(() => "?").join(",")})`,
        [paperId, ...similarIds],
      );
      for (const link of links) paperLinks.set(link.question_id, [link.paper_id]);
    }
    const similar = [
      ...(exactMatch ? [{ ...exactMatch, similarity: 100, exact: true }] : []),
      ...candidates.map(({ id, prompt: matchedPrompt, status, topicId, topicName, subjectName, similarity: score, exact: isExact }) => ({
        id, prompt: matchedPrompt, status, topicId, topicName, subjectName, similarity: score, exact: isExact, attachedPaperIds: paperLinks.get(id) ?? [],
      })),
    ];
    return NextResponse.json({ similar }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Question duplicate check failed", cause);
    return NextResponse.json({ error: "Could not check for existing MCQs. Retry the question check." }, { status: 500 });
  } finally {
    connection.release();
  }
}
