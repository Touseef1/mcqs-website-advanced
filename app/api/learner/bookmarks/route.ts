import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getLearnerPrincipal } from "@/lib/learner-auth";
import { db } from "@/lib/db";

type BookmarkRow = RowDataPacket & { id: number; topic_slug: string; prompt: string; label: string; choice_text: string };

export async function GET(request: Request) {
  const learner = await getLearnerPrincipal();
  if (!learner || !db) return NextResponse.json({ error: "Sign in to save and view questions." }, { status: 401 });
  const url = new URL(request.url);
  const requested = url.searchParams.get("ids");
  let filter = "";
  let params: Array<string | number> = [learner.id];
  if (requested) {
    const ids = [...new Set(requested.split(",").map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 100);
    if (!ids.length) return NextResponse.json({ bookmarks: [] });
    filter = ` AND q.id IN (${ids.map(() => "?").join(",")})`;
    params = [...params, ...ids];
  }
  const [rows] = await db.execute<BookmarkRow[]>(
    `SELECT q.id, t.slug AS topic_slug, q.question_text AS prompt, c.label, c.choice_text
     FROM learner_bookmarks b
     JOIN questions q ON q.id = b.question_id AND q.status = 'published'
     JOIN topics t ON t.id = q.topic_id
     LEFT JOIN choices c ON c.question_id = q.id
     WHERE b.learner_id = ?${filter}
     ORDER BY b.created_at DESC, q.id, c.label`, params,
  );
  const grouped = new Map<number, { questionId: number; topicSlug: string; prompt: string; choices: Array<{ label: string; text: string }> }>();
  for (const row of rows) {
    const item = grouped.get(row.id) ?? { questionId: row.id, topicSlug: row.topic_slug, prompt: row.prompt, choices: [] };
    if (row.label) item.choices.push({ label: row.label, text: row.choice_text });
    grouped.set(row.id, item);
  }
  return NextResponse.json({ bookmarks: [...grouped.values()] });
}

export async function POST(request: Request) {
  const learner = await getLearnerPrincipal();
  if (!learner || !db) return NextResponse.json({ error: "Sign in to save questions." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const questionId = body && typeof body === "object" ? (body as Record<string, unknown>).questionId : null;
  if (typeof questionId !== "number" || !Number.isSafeInteger(questionId) || questionId < 1) return NextResponse.json({ error: "Choose a valid question." }, { status: 400 });
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO learner_bookmarks (learner_id, question_id)
     SELECT ?, id FROM questions WHERE id = ? AND status = 'published'`, [learner.id, questionId],
  );
  if (result.affectedRows === 0) return NextResponse.json({ error: "That published question could not be found." }, { status: 404 });
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: Request) {
  const learner = await getLearnerPrincipal();
  if (!learner || !db) return NextResponse.json({ error: "Sign in to manage saved questions." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const questionId = body && typeof body === "object" ? (body as Record<string, unknown>).questionId : null;
  if (typeof questionId !== "number" || !Number.isSafeInteger(questionId) || questionId < 1) return NextResponse.json({ error: "Choose a valid question." }, { status: 400 });
  await db.execute("DELETE FROM learner_bookmarks WHERE learner_id = ? AND question_id = ?", [learner.id, questionId]);
  return NextResponse.json({ saved: false });
}
