import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { canActorEditQuestion, canActorTransition, getQuestionTransition, isSelfApproval, statusAfterQuestionEdit, type QuestionStatus } from "@/lib/admin-workflow";
import { db, hasDatabase } from "@/lib/db";

import { auditAdmin, csrfFailure } from "@/lib/admin-security";
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
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) return null;
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
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal) return error("Please sign in first.", 401);
  if (!hasDatabase || !db) return error("Configure MySQL and apply the database migrations first.", 503);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "import") {
    if (!requirePermission(principal, "mcq.create")) return error("Your role cannot add questions.", 403);
    const topicId = Number(body?.topicId);
    const paperId = body?.paperId === null || body?.paperId === undefined || body?.paperId === "" ? null : Number(body.paperId);
    const sourceNote = typeof body?.sourceNote === "string" ? body.sourceNote.trim() : "";
    const difficulty = body?.difficulty === "easy" || body?.difficulty === "hard" ? body.difficulty : "medium";
    const inputs = Array.isArray(body?.questions) ? body.questions : [];
    if (!Number.isSafeInteger(topicId) || topicId < 1 || sourceNote.length < 4 || sourceNote.length > 500 || inputs.length < 1 || inputs.length > 200 || (paperId !== null && (!Number.isSafeInteger(paperId) || paperId < 1))) return error("Choose a category, source reference, and 1–200 valid MCQs.");
    if (paperId !== null && !requirePermission(principal, "paper.add_questions")) return error("Your role cannot add questions to past papers.", 403);
    const parsed = inputs.map(parseInputQuestion);
    if (parsed.some((row) => !row)) return NextResponse.json({ error: "Bulk import validation failed; no MCQs were saved.", results: parsed.map((row, index) => ({ row: index + 1, ok: Boolean(row), ...(row ? {} : { error: "Question, four distinct options, correct answer, or explanation is invalid." }) })) }, { status: 400 });
    const status = "draft" as const;
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
        if (!paper[0] || paper[0].status === "archived" || paper[0].status === "published") {
          await connection.rollback();
          return error("Choose a draft paper, or publish these MCQs before adding them to the published paper.");
        }
      }
      for (const item of parsed as InputQuestion[]) {
        const [insert] = await connection.execute(
          `INSERT INTO questions (topic_id, question_text, explanation, source_note, correct_choice, difficulty, status, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [topicId, item.prompt, item.explanation, sourceNote, item.correctChoice, difficulty, status, principal.id, principal.id],
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
    return NextResponse.json({ error: "Bulk import rolled back; no rows were saved.", results: inputs.map((_, index) => ({ row: index + 1, ok: false, error: "Rolled back because the transaction failed." })) }, { status: 500 });
    } finally {
      connection.release();
    }
    await auditAdmin(principal, request, "bulk_create", "question", null, null, { questionIds: createdIds, topicId, paperId });
    refreshContent();
    return NextResponse.json({ ok: true, ids: createdIds, count: createdIds.length, results: createdIds.map((id, index) => ({ row: index + 1, id, ok: true })) });
  }

  const ids = parseIds(body?.ids);
  if (!ids) return error("Select between 1 and 100 MCQs.");
  const topicId = Number(body?.topicId);
  const paperId = Number(body?.paperId);

  if (action === "change-category" && !requirePermission(principal, "mcq.edit_any") && !requirePermission(principal, "mcq.edit_own")) return error("Your role cannot edit questions.", 403);
  if (action === "submit-review" && !requirePermission(principal, "mcq.edit_own")) return error("Your role cannot submit questions for review.", 403);
  if (action === "approve" && !requirePermission(principal, "mcq.review")) return error("Your role cannot approve submitted MCQs.", 403);
  if (action === "publish" && !requirePermission(principal, "mcq.publish")) return error("Only Paper Managers and Super Admins can publish questions.", 403);
  if (action === "archive" && !requirePermission(principal, "mcq.archive")) return error("Only the Super Admin can archive questions.", 403);
  if (action === "add-to-paper" && !requirePermission(principal, "paper.add_questions")) return error("Your role cannot add questions to past papers.", 403);
  if (action === "remove-from-paper" && !requirePermission(principal, "paper.manage")) return error("Your role cannot manage past-paper questions.", 403);
  if (!["change-category", "submit-review", "approve", "publish", "archive", "add-to-paper", "remove-from-paper"].includes(action)) return error("Choose a supported bulk action.");
  if (action === "change-category" && (!Number.isSafeInteger(topicId) || topicId < 1)) return error("Choose a valid category.");
  if ((action === "add-to-paper" || action === "remove-from-paper") && (!Number.isSafeInteger(paperId) || paperId < 1)) return error("Choose a valid past paper.");

  const connection = await db.getConnection();
  const selfApprovalOverrideIds: number[] = [];
  try {
    await connection.beginTransaction();
    const marks = ids.map(() => "?").join(",");
    const [questions] = await connection.execute<Array<RowDataPacket & { id: number; status: string; source_note: string; topic_status: string; subject_status: string; created_by: number | null }>>(
      `SELECT q.id, q.status, q.source_note, q.created_by, t.status AS topic_status, s.status AS subject_status
       FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
       WHERE q.id IN (${marks}) FOR UPDATE`, ids,
    );
    if (questions.length !== ids.length) {
      await connection.rollback();
      return NextResponse.json({ error: "Bulk action rolled back; one or more MCQs no longer exist.", results: ids.map((id) => ({ id, ok: false, error: "Missing or no longer available." })) }, { status: 404 });
    }
    const rowResults: Array<{ id: number; ok: boolean; error?: string }> = [];
    if (action === "change-category") {
      const [topic] = await connection.execute<Array<RowDataPacket & { id: number }>>(
        `SELECT t.id FROM topics t JOIN subjects s ON s.id = t.subject_id
         WHERE t.id = ? AND t.status != 'archived' AND s.status != 'archived'`, [topicId],
      );
      for (const question of questions) {
        const editable = question.status !== "archived" && canActorEditQuestion(principal, question.created_by, question.status, requirePermission(principal, "mcq.edit_any"), requirePermission(principal, "mcq.edit_own"));
        const target = statusAfterQuestionEdit(question.status as QuestionStatus, false);
        const transition = target === question.status ? null : getQuestionTransition(question.status, target);
        const statusChange = target === question.status || Boolean(transition && requirePermission(principal, transition.permission));
        if (!topic[0]) rowResults.push({ id: question.id, ok: false, error: "Choose an active category." });
        else if (!editable) rowResults.push({ id: question.id, ok: false, error: "You can edit only your own draft or rejected MCQs." });
        else if (!statusChange) rowResults.push({ id: question.id, ok: false, error: `Illegal edit transition from ${question.status}.` });
        else rowResults.push({ id: question.id, ok: true });
      }
      if (rowResults.some((row) => !row.ok)) {
        await connection.rollback();
        return NextResponse.json({ error: "Bulk action rolled back. Fix the listed rows and retry; no MCQs were changed.", results: rowResults.map((row) => row.ok ? { ...row, ok: false, error: "Rolled back because another row failed." } : row) }, { status: 400 });
      }
      for (const question of questions) {
        const target = statusAfterQuestionEdit(question.status as QuestionStatus, false);
        if (target !== question.status) {
          const [publishedPapers] = await connection.execute<Array<RowDataPacket & { id: number; title: string }>>(
            "SELECT p.id, p.title FROM paper_questions pq JOIN papers p ON p.id = pq.paper_id WHERE pq.question_id = ? AND p.status = 'published' FOR UPDATE", [question.id],
          );
          if (publishedPapers.length && body?.confirmPaperRemoval !== true) {
            await connection.rollback();
            return NextResponse.json({ error: "Bulk action rolled back. Confirm removal from published papers before changing these MCQs.", results: questions.map((item) => ({ id: item.id, ok: false, error: item.id === question.id ? "Published paper removal confirmation required." : "Rolled back because another row failed." })), affectedPapers: publishedPapers }, { status: 409 });
          }
          if (publishedPapers.length) await connection.execute("DELETE FROM paper_questions WHERE question_id = ? AND paper_id IN (SELECT id FROM papers WHERE status = 'published')", [question.id]);
        }
        await connection.execute("UPDATE questions SET topic_id = ?, status = ?, updated_by = ?, version = version + 1 WHERE id = ?", [topicId, target, principal.id, question.id]);
      }
    } else if (action === "submit-review") {
      for (const question of questions) {
        const valid = canActorTransition(principal, question.created_by, question.status, "in_review", (permission) => requirePermission(principal, permission));
        rowResults.push({ id: question.id, ok: Boolean(valid), ...(!valid ? { error: "Only the owner can submit a draft for review." } : {}) });
      }
      if (rowResults.some((row) => !row.ok)) { await connection.rollback(); return NextResponse.json({ error: "Bulk action rolled back. No MCQs were submitted.", results: rowResults.map((row) => row.ok ? { ...row, ok: false, error: "Rolled back because another row failed." } : row) }, { status: 400 }); }
      for (const question of questions) await connection.execute("UPDATE questions SET status = 'in_review', updated_by = ?, version = version + 1 WHERE id = ?", [principal.id, question.id]);
    } else if (action === "approve") {
      const reviewNote = typeof body?.reviewNote === "string" ? body.reviewNote.trim() : "";
      for (const question of questions) {
        const self = isSelfApproval(principal, question.created_by, "approved");
        const valid = Boolean(reviewNote) && canActorTransition(principal, question.created_by, question.status, "approved", (permission) => requirePermission(principal, permission));
        if (valid && self) selfApprovalOverrideIds.push(question.id);
        rowResults.push({ id: question.id, ok: Boolean(valid), ...(!valid ? { error: !reviewNote ? "Review comment is required." : self && principal.role !== "super_admin" ? "You cannot approve your own MCQ." : "Only in-review MCQs can be approved." } : {}) });
      }
      if (rowResults.some((row) => !row.ok)) { await connection.rollback(); return NextResponse.json({ error: "Bulk action rolled back. No MCQs were approved.", results: rowResults.map((row) => row.ok ? { ...row, ok: false, error: "Rolled back because another row failed." } : row) }, { status: 400 }); }
      for (const question of questions) await connection.execute("UPDATE questions SET status = 'approved', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), review_note = ?, updated_by = ?, version = version + 1 WHERE id = ?", [principal.id, reviewNote, principal.id, question.id]);
    } else if (action === "publish") {
      for (const question of questions) {
        const self = isSelfApproval(principal, question.created_by, "published");
        const valid = canActorTransition(principal, question.created_by, question.status, "published", (permission) => requirePermission(principal, permission)) && question.source_note.trim() && question.topic_status === "published" && question.subject_status === "published";
        if (valid && self) selfApprovalOverrideIds.push(question.id);
        rowResults.push({ id: question.id, ok: Boolean(valid), ...(!valid ? { error: self && principal.role !== "super_admin" ? "You cannot publish your own MCQ." : "The row is not approved or lacks its source/published category." } : {}) });
      }
      if (rowResults.some((row) => !row.ok)) { await connection.rollback(); return NextResponse.json({ error: "Bulk action rolled back. No MCQs were published.", results: rowResults.map((row) => row.ok ? { ...row, ok: false, error: "Rolled back because another row failed." } : row) }, { status: 400 }); }
      for (const question of questions) {
        const revisionId = await saveRevision(connection, question.id, principal.id);
        await connection.execute("UPDATE questions SET status = 'published', current_revision_id = ?, updated_by = ?, version = version + 1 WHERE id = ?", [revisionId, principal.id, question.id]);
      }
    } else if (action === "archive") {
      for (const question of questions) {
        const transition = getQuestionTransition(question.status, "archived");
        const valid = transition && requirePermission(principal, transition.permission);
        rowResults.push({ id: question.id, ok: Boolean(valid), ...(!valid ? { error: "This question cannot be archived from its current status." } : {}) });
      }
      if (rowResults.some((row) => !row.ok)) { await connection.rollback(); return NextResponse.json({ error: "Bulk action rolled back. No MCQs were archived.", results: rowResults.map((row) => row.ok ? { ...row, ok: false, error: "Rolled back because another row failed." } : row) }, { status: 400 }); }
      const [affectedPapers] = await connection.execute<Array<RowDataPacket & { question_id: number; paper_id: number; title: string }>>(
        `SELECT pq.question_id, p.id AS paper_id, p.title FROM paper_questions pq JOIN papers p ON p.id = pq.paper_id WHERE pq.question_id IN (${marks}) AND p.status = 'published' FOR UPDATE`, ids,
      );
      if (affectedPapers.length && body?.confirmPaperRemoval !== true) { await connection.rollback(); return NextResponse.json({ error: "Bulk action rolled back. Confirm removal from published papers first.", affectedPapers, results: questions.map((question) => ({ id: question.id, ok: false, error: "Published paper removal confirmation required." })) }, { status: 409 }); }
      if (affectedPapers.length) await connection.execute(`DELETE FROM paper_questions WHERE question_id IN (${marks}) AND paper_id IN (SELECT id FROM papers WHERE status = 'published')`, ids);
      for (const question of questions) await connection.execute("UPDATE questions SET status = 'archived', updated_by = ?, version = version + 1 WHERE id = ?", [principal.id, question.id]);
    } else if (action === "add-to-paper") {
      const [paper] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>("SELECT id, status FROM papers WHERE id = ? FOR UPDATE", [paperId]);
      const failedRows = questions.filter((question) => question.status === "archived" || (paper[0]?.status === "published" && question.status !== "published") || (principal.role === "data_entry" && String(question.created_by) !== principal.id));
      if (!paper[0] || paper[0].status === "archived" || failedRows.length) {
        await connection.rollback();
        return NextResponse.json({ error: "Bulk action rolled back. Choose an active paper and ensure every row is owned and valid for that paper.", results: questions.map((question) => ({ id: question.id, ok: false, error: failedRows.some((row) => row.id === question.id) ? "Question is archived, not published for this paper, or not owned by this Data Entry user." : "Rolled back because another row failed." })) }, { status: 400 });
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
      return NextResponse.json({ error: "Bulk action rolled back. Choose an active past paper.", results: ids.map((id) => ({ id, ok: false, error: "Paper is missing or archived." })) }, { status: 400 });
      }
      await removeFromPaper(connection, paperId, ids);
    }
    await connection.commit();
  } catch (cause) {
    await connection.rollback();
    console.error("Bulk MCQ action failed", cause);
    return NextResponse.json({ error: "Bulk action rolled back; no changes were saved.", results: ids.map((id) => ({ id, ok: false, error: "Rolled back because the transaction failed." })) }, { status: 500 });
  } finally {
    connection.release();
  }
  await auditAdmin(principal, request, action, "question", null, { ids }, { action, ids, selfApprovalOverrideIds, topicId: action === "change-category" ? topicId : undefined, paperId: ["add-to-paper", "remove-from-paper"].includes(action) ? paperId : undefined });
  refreshContent();
  return NextResponse.json({ ok: true, count: ids.length, results: ids.map((id) => ({ id, ok: true })) });
}

async function saveRevision(connection: import("mysql2/promise").PoolConnection, questionId: number, adminId: string) {
  const [questions] = await connection.execute<Array<RowDataPacket & { question_text: string; explanation: string; source_note: string; correct_choice: string; question_image_url: string | null }>>(
    "SELECT question_text, explanation, source_note, correct_choice, question_image_url FROM questions WHERE id = ?", [questionId],
  );
  const [choices] = await connection.execute<Array<RowDataPacket & { label: string; choice_text: string; image_url: string | null }>>(
    "SELECT label, choice_text, image_url FROM choices WHERE question_id = ? ORDER BY label", [questionId],
  );
  const [countRows] = await connection.execute<Array<RowDataPacket & { revision_count: number }>>(
    "SELECT COUNT(*) AS revision_count FROM question_revisions WHERE question_id = ?", [questionId],
  );
  const [insert] = await connection.execute(
    "INSERT INTO question_revisions (question_id, revision_number, content_snapshot, created_by) VALUES (?, ?, ?, ?)",
    [questionId, Number(countRows[0]?.revision_count ?? 0) + 1, JSON.stringify({ ...questions[0], choices }), adminId],
  );
  return Number((insert as { insertId: number }).insertId);
}
