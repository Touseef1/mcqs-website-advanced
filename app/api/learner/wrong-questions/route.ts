import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getLearnerPrincipal } from "@/lib/learner-auth";
import { db } from "@/lib/db";

type WrongQuestionRow = RowDataPacket & {
  id: number;
  topic_id: number;
  topic_slug: string;
  topic_name: string;
  subject_name: string;
  prompt: string;
  language: "en" | "ur";
  question_image_url: string | null;
  explanation: string | null;
  source_note: string;
  label: string | null;
  choice_text: string | null;
  image_url: string | null;
};

export async function GET() {
  const learner = await getLearnerPrincipal();
  if (!learner || !db) return NextResponse.json({ error: "Sign in to view your wrong questions." }, { status: 401 });

  const [rows] = await db.execute<WrongQuestionRow[]>(
    `SELECT q.id, t.id AS topic_id, t.slug AS topic_slug, t.name AS topic_name,
            s.name AS subject_name, q.question_text AS prompt, q.language,
            q.question_image_url, q.explanation, q.source_note, c.label, c.choice_text, c.image_url
       FROM quiz_attempt_answers qa
       JOIN questions q ON q.id = qa.question_id AND q.status = 'published'
       JOIN topics t ON t.id = q.topic_id
       JOIN subjects s ON s.id = t.subject_id
       LEFT JOIN choices c ON c.question_id = q.id
       LEFT JOIN learner_wrong_question_dismissals d
         ON d.learner_id = qa.learner_id AND d.question_id = q.id
      WHERE qa.learner_id = ? AND qa.is_correct = 0 AND qa.selected_choice IS NOT NULL
        AND d.question_id IS NULL
      GROUP BY q.id, t.id, t.slug, t.name, s.name, q.question_text, q.language, q.question_image_url,
               q.explanation, q.source_note, c.label, c.choice_text, c.image_url
      ORDER BY MAX(qa.created_at) DESC, q.id, c.label`, [learner.id],
  );

  const questions = new Map<number, {
    id: number;
    topicId: number;
    topicSlug: string;
    topicName: string;
    subjectName: string;
    prompt: string;
    language: "en" | "ur";
    questionImageUrl: string | null;
    explanation: string;
    sourceNote: string;
    choices: Array<{ label: string; text: string; imageUrl: string | null }>;
  }>();
  for (const row of rows) {
    const question = questions.get(row.id) ?? {
      id: row.id,
      topicId: row.topic_id,
      topicSlug: row.topic_slug,
      topicName: row.topic_name,
      subjectName: row.subject_name,
      prompt: row.prompt,
      language: row.language ?? "en",
      questionImageUrl: row.question_image_url,
      explanation: row.explanation ?? "",
      sourceNote: row.source_note,
      choices: [],
    };
    if (row.label) question.choices.push({ label: row.label, text: row.choice_text ?? "", imageUrl: row.image_url });
    questions.set(row.id, question);
  }

  return NextResponse.json({ questions: [...questions.values()] });
}

export async function DELETE(request: Request) {
  const learner = await getLearnerPrincipal();
  if (!learner || !db) return NextResponse.json({ error: "Sign in to manage your wrong questions." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const bodyRecord = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const questionId = bodyRecord.questionId;
  const topicId = bodyRecord.topicId;
  const hasQuestionId = typeof questionId === "number" && Number.isSafeInteger(questionId) && questionId > 0;
  const hasTopicId = typeof topicId === "number" && Number.isSafeInteger(topicId) && topicId > 0;
  if (hasQuestionId === hasTopicId) {
    return NextResponse.json({ error: "Choose one valid question or topic." }, { status: 400 });
  }

  if (hasQuestionId) {
    const [eligible] = await db.execute<Array<RowDataPacket & { id: number }>>(
      `SELECT q.id FROM questions q
        WHERE q.id = ? AND q.status = 'published'
          AND EXISTS (
            SELECT 1 FROM quiz_attempt_answers qa
             WHERE qa.question_id = q.id AND qa.learner_id = ? AND qa.is_correct = 0
               AND qa.selected_choice IS NOT NULL
        ) LIMIT 1`, [questionId as number, learner.id],
    );
    if (!eligible.length) return NextResponse.json({ error: "That wrong question could not be found." }, { status: 404 });
    const [result] = await db.execute(
      "INSERT IGNORE INTO learner_wrong_question_dismissals (learner_id, question_id) VALUES (?, ?)",
      [learner.id, questionId as number],
    );
    return NextResponse.json({ removed: true, removedCount: (result as { affectedRows: number }).affectedRows });
  }

  const [eligible] = await db.execute<Array<RowDataPacket & { id: number }>>(
    `SELECT t.id FROM topics t
      WHERE t.id = ? AND EXISTS (
        SELECT 1 FROM questions q
        JOIN quiz_attempt_answers qa ON qa.question_id = q.id
         WHERE q.topic_id = t.id AND q.status = 'published'
           AND qa.learner_id = ? AND qa.is_correct = 0 AND qa.selected_choice IS NOT NULL
      ) LIMIT 1`, [topicId as number, learner.id],
  );
  if (!eligible.length) return NextResponse.json({ error: "That topic has no wrong questions to remove." }, { status: 404 });
  const [result] = await db.execute(
    `INSERT IGNORE INTO learner_wrong_question_dismissals (learner_id, question_id)
     SELECT ?, q.id FROM questions q
     JOIN quiz_attempt_answers qa ON qa.question_id = q.id
      WHERE q.topic_id = ? AND q.status = 'published'
        AND qa.learner_id = ? AND qa.is_correct = 0 AND qa.selected_choice IS NOT NULL`,
    [learner.id, topicId as number, learner.id],
  );
  return NextResponse.json({ removed: true, removedCount: (result as { affectedRows: number }).affectedRows });
}
