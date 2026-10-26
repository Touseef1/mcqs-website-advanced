import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

export async function GET() {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply migrations first." }, { status: 503 });
  const [statusCounts] = await db.execute<Array<RowDataPacket & { status: string; count: number }>>("SELECT status, COUNT(*) AS count FROM questions GROUP BY status");
  const [categories] = await db.execute<Array<RowDataPacket & { subject_name: string; topic_name: string; question_count: number }>>(
    `SELECT s.name AS subject_name, t.name AS topic_name, COUNT(q.id) AS question_count
       FROM topics t JOIN subjects s ON s.id = t.subject_id
       LEFT JOIN questions q ON q.topic_id = t.id AND q.status != 'archived'
      WHERE s.status != 'archived' AND t.status != 'archived'
      GROUP BY s.id, t.id ORDER BY s.name, t.name`,
  );
  const [shortPapers] = await db.execute<Array<RowDataPacket & { id: number; title: string; expected_question_count: number; question_count: number }>>(
    `SELECT p.id, p.title, p.expected_question_count, COUNT(pq.question_id) AS question_count
       FROM papers p LEFT JOIN paper_questions pq ON pq.paper_id = p.id
      WHERE p.status != 'archived' AND p.expected_question_count IS NOT NULL
      GROUP BY p.id HAVING COUNT(pq.question_id) < p.expected_question_count
      ORDER BY p.year DESC, p.id DESC LIMIT 50`,
  );
  return NextResponse.json({
    statuses: Object.fromEntries(statusCounts.map((row) => [row.status, Number(row.count)])),
    categories,
    emptyCategories: categories.filter((row) => Number(row.question_count) === 0),
    shortPapers: shortPapers.map((row) => ({ ...row, question_count: Number(row.question_count), expected_question_count: Number(row.expected_question_count) })),
  }, { headers: { "Cache-Control": "no-store" } });
}
