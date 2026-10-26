import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

import { csrfFailure } from "@/lib/admin-security";
function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function shingles(value: string) {
  const text = ` ${normalize(value)} `;
  const set = new Set<string>();
  for (let index = 0; index < text.length - 2; index++) set.add(text.slice(index, index + 3));
  return set;
}

function similarity(first: string, second: string) {
  const aTokens = new Set(normalize(first).split(" ").filter(Boolean));
  const bTokens = new Set(normalize(second).split(" ").filter(Boolean));
  const tokenIntersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const tokenUnion = new Set([...aTokens, ...bTokens]).size || 1;
  const a = shingles(first);
  const b = shingles(second);
  const common = [...a].filter((part) => b.has(part)).length;
  const dice = (2 * common) / ((a.size + b.size) || 1);
  const jaccard = tokenIntersection / tokenUnion;
  return Math.round((dice * 0.65 + jaccard * 0.35) * 100);
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || (!requirePermission(principal, "mcq.edit_any") && !requirePermission(principal, "mcq.edit_own"))) return NextResponse.json({ error: "Your role cannot check MCQs." }, { status: 403 });
  if (!hasDatabase || !db) return NextResponse.json({ similar: [] });
  const body = await request.json().catch(() => null);
  const topicId = Number(body?.topicId);
  const questionId = Number(body?.questionId) || 0;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1500) : "";
  if (!Number.isSafeInteger(topicId) || topicId < 1 || prompt.length < 8) return NextResponse.json({ similar: [] });
  const [rows] = await db.execute<Array<RowDataPacket & { id: number; question_text: string; status: string }>>(
    `SELECT id, question_text, status FROM questions
     WHERE topic_id = ? AND status != 'archived' AND id != ?
     ORDER BY updated_at DESC, id DESC LIMIT 1000`, [topicId, questionId],
  );
  const similar = rows.map((row) => ({ id: row.id, prompt: row.question_text, status: row.status, similarity: similarity(prompt, row.question_text) }))
    .filter((row) => row.similarity >= 58)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
  return NextResponse.json({ similar }, { headers: { "Cache-Control": "no-store" } });
}
