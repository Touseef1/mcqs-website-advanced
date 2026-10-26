import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

type PickerRow = RowDataPacket & {
  id: number;
  topic_id: number;
  topic_name: string;
  subject_id: number;
  subject_name: string;
  prompt: string;
  source_note: string;
  status: "draft" | "published" | "archived";
  difficulty: "easy" | "medium" | "hard";
};

function formatQuestions(rows: PickerRow[]) {
  return rows.map((row) => ({
    id: row.id,
    topicId: row.topic_id,
    topicName: row.topic_name,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    prompt: row.prompt,
    sourceNote: row.source_note,
    status: row.status,
    difficulty: row.difficulty,
  }));
}

export async function GET(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const idsParam = params.get("ids");
  if (idsParam) {
    const ids = [...new Set(idsParam.split(",").map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 300);
    if (!ids.length) return NextResponse.json({ questions: [] });
    const marks = ids.map(() => "?").join(",");
    const [rows] = await db.execute<PickerRow[]>(
      `SELECT q.id, q.topic_id, t.name AS topic_name, s.id AS subject_id,
              s.name AS subject_name, q.question_text AS prompt, q.source_note, q.status, q.difficulty
       FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
       WHERE q.id IN (${marks})`, ids,
    );
    const byId = new Map(formatQuestions(rows).map((question) => [question.id, question]));
    return NextResponse.json({ questions: ids.map((id) => byId.get(id)).filter(Boolean) }, { headers: { "Cache-Control": "no-store" } });
  }

  const search = (params.get("search") ?? "").trim().slice(0, 180);
  const subjectId = Number(params.get("subjectId"));
  const topicId = Number(params.get("topicId"));
  const status = params.get("status") ?? "published";
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  const pageSize = Math.max(10, Math.min(100, Number(params.get("pageSize")) || 25));
  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (search) {
    conditions.push("(q.question_text LIKE ? OR q.source_note LIKE ? OR t.name LIKE ? OR s.name LIKE ?)");
    const term = `%${search}%`;
    values.push(term, term, term, term);
  }
  if (Number.isSafeInteger(subjectId) && subjectId > 0) { conditions.push("s.id = ?"); values.push(subjectId); }
  if (Number.isSafeInteger(topicId) && topicId > 0) { conditions.push("t.id = ?"); values.push(topicId); }
  if (["draft", "published", "archived"].includes(status)) { conditions.push("q.status = ?"); values.push(status); }
  else if (status !== "all") { conditions.push("q.status IN ('draft', 'published')"); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const from = "FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id";
  const [counts] = await db.execute<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) AS total ${from} ${where}`, values);
  const total = Number(counts[0]?.total ?? 0);
  const offset = (page - 1) * pageSize;
  const [rows] = await db.execute<PickerRow[]>(
    `SELECT q.id, q.topic_id, t.name AS topic_name, s.id AS subject_id,
            s.name AS subject_name, q.question_text AS prompt, q.source_note, q.status, q.difficulty
     ${from} ${where} ORDER BY q.updated_at DESC, q.id DESC LIMIT ? OFFSET ?`,
    [...values, pageSize, offset],
  );
  return NextResponse.json({ questions: formatQuestions(rows), total, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
}
