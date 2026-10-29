import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

import { auditAdmin, csrfFailure } from "@/lib/admin-security";
export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "paper.manage")) return NextResponse.json({ error: "Your role cannot reorder past-paper questions." }, { status: 403 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const paperId = Number(body?.paperId);
  const questionIds = Array.isArray(body?.questionIds) ? body.questionIds.map((id: unknown) => Number(id)) : [];
  if (!Number.isSafeInteger(paperId) || paperId < 1 || questionIds.length > 300 || questionIds.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(questionIds).size !== questionIds.length) {
    return NextResponse.json({ error: "Choose a paper and a valid ordered question list." }, { status: 400 });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [papers] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>("SELECT id, status FROM papers WHERE id = ? FOR UPDATE", [paperId]);
    if (!papers[0] || papers[0].status === "archived") {
      await connection.rollback();
      return NextResponse.json({ error: "Choose an active past paper." }, { status: 404 });
    }
    const [current] = await connection.execute<Array<RowDataPacket & { question_id: number }>>(
      "SELECT question_id FROM paper_questions WHERE paper_id = ? ORDER BY question_order FOR UPDATE", [paperId],
    );
    const expected = new Set(current.map((row) => Number(row.question_id)));
    if (expected.size !== questionIds.length || questionIds.some((id) => !expected.has(id))) {
      await connection.rollback();
      return NextResponse.json({ error: "The question list changed. Refresh the paper and try reordering again." }, { status: 409 });
    }
    for (const [index, questionId] of questionIds.entries()) {
      await connection.execute("UPDATE paper_questions SET question_order = ? WHERE paper_id = ? AND question_id = ?", [-(index + 1), paperId, questionId]);
    }
    for (const [index, questionId] of questionIds.entries()) {
      await connection.execute("UPDATE paper_questions SET question_order = ? WHERE paper_id = ? AND question_id = ?", [index + 1, paperId, questionId]);
    }
    await connection.commit();
  } catch (cause) {
    await connection.rollback();
    console.error("Past-paper reorder failed", cause);
    return NextResponse.json({ error: "The paper order could not be saved." }, { status: 500 });
  } finally {
    connection.release();
  }
  await auditAdmin(principal, request, "reorder", "paper", paperId, null, { questionIds });
  revalidatePath("/past-papers");
  revalidatePath("/past-papers/[slug]", "page");
  revalidateTag("papers", "max");
  revalidateTag("questions", { expire: 0 });
  return NextResponse.json({ ok: true, count: questionIds.length });
}
