import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { requestedStatus, slugify, validSlug } from "@/lib/admin-content";
import { getQuestionTransition } from "@/lib/admin-workflow";
import { db, hasDatabase } from "@/lib/db";

import { auditAdmin, csrfFailure } from "@/lib/admin-security";
function unavailable() {
  return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 });
}

function revalidateContent() {
  revalidatePath("/");
  revalidatePath("/subjects");
  revalidatePath("/past-papers");
  revalidateTag("subjects", "max");
  revalidateTag("topics", "max");
  revalidateTag("questions", "max");
  revalidateTag("papers", "max");
}

export async function GET() {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return unavailable();
  const [subjects] = await db.execute<Array<RowDataPacket & { id: number; name: string; slug: string; description: string; status: string; topic_count: number }>>(
    `SELECT s.id, s.name, s.slug, s.description, s.status, COUNT(t.id) AS topic_count
     FROM subjects s LEFT JOIN topics t ON t.subject_id = s.id
     GROUP BY s.id ORDER BY s.sort_order, s.name`,
  );
  const [topics] = await db.execute<Array<RowDataPacket & { id: number; subject_id: number; subject_name: string; name: string; slug: string; description: string; status: string; question_count: number }>>(
    `SELECT t.id, t.subject_id, s.name AS subject_name, t.name, t.slug, t.description, t.status,
            COUNT(q.id) AS question_count
     FROM topics t JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN questions q ON q.topic_id = t.id
     GROUP BY t.id ORDER BY s.sort_order, t.sort_order, t.name`,
  );
  return NextResponse.json({ subjects, topics }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "category.manage")) return NextResponse.json({ error: "Your role cannot manage categories." }, { status: 403 });
  if (!hasDatabase || !db) return unavailable();
  const body = await request.json().catch(() => null);
  const kind = body?.kind === "topic" ? "topic" : body?.kind === "subject" ? "subject" : null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const slug = typeof body?.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(name);
  const parentId = Number(body?.subjectId);
  if (!kind || name.length < 2 || name.length > (kind === "subject" ? 120 : 160) || description.length > 3000 || !validSlug(slug) || (kind === "topic" && (!Number.isInteger(parentId) || parentId < 1))) {
    return NextResponse.json({ error: "Enter a valid category name, slug, description, and parent subject for a topic." }, { status: 400 });
  }
  const status = requestedStatus(body?.status, principal);
  let entityId = 0;
  try {
    if (kind === "subject") {
      const [insert] = await db.execute("INSERT INTO subjects (name, slug, description, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)", [name, slug, description, status, principal.id, principal.id]);
      entityId = Number((insert as { insertId: number }).insertId);
    } else {
      const [parent] = await db.execute<Array<RowDataPacket & { id: number; status: string }>>("SELECT id, status FROM subjects WHERE id = ? LIMIT 1", [parentId]);
      if (!parent[0] || (status === "published" && parent[0].status !== "published")) return NextResponse.json({ error: "Choose an existing published subject to publish this topic." }, { status: 400 });
      const [insert] = await db.execute("INSERT INTO topics (subject_id, name, slug, description, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)", [parentId, name, slug, description, status, principal.id, principal.id]);
      entityId = Number((insert as { insertId: number }).insertId);
    }
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "That URL slug is already in use. Choose another one." }, { status: 409 });
    console.error("Admin category creation failed", error);
    return NextResponse.json({ error: "The category could not be saved." }, { status: 500 });
  }
  await auditAdmin(principal, request, "create", kind, entityId, null, { name, slug, status });
  revalidateContent();
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  if (!hasDatabase || !db) return unavailable();
  const body = await request.json().catch(() => null);
  const kind = body?.kind === "topic" ? "topic" : body?.kind === "subject" ? "subject" : null;
  const id = Number(body?.id);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const slug = typeof body?.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(name);
  const parentId = Number(body?.subjectId);
  if (!kind || !Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Choose a valid category to update." }, { status: 400 });

  const canManage = requirePermission(principal, "category.manage");
  const canPublish = requirePermission(principal, "mcq.publish");
  const canDelete = requirePermission(principal, "mcq.archive");
  if (body?.status === "archived" && !canDelete) return NextResponse.json({ error: "Only the Super Admin can archive categories." }, { status: 403 });
  if (body?.status === "published" && !canManage) return NextResponse.json({ error: "Your role cannot publish categories." }, { status: 403 });
  if (!canManage) return NextResponse.json({ error: "Your role cannot manage categories." }, { status: 403 });
  if (body?.status === "draft" && !canPublish) {
    const table = kind === "subject" ? "subjects" : "topics";
    const [current] = await db.execute<Array<RowDataPacket & { status: string }>>(`SELECT status FROM ${table} WHERE id = ? LIMIT 1`, [id]);
    if (!current[0]) return NextResponse.json({ error: "Category not found." }, { status: 404 });
    if (current[0].status === "published") return NextResponse.json({ error: "Your role can edit draft categories only." }, { status: 403 });
  }

  try {
    if (body?.status === "archived") {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const topicFilter = kind === "subject" ? "t.subject_id = ?" : "t.id = ?";
        const [questions] = await connection.execute<Array<RowDataPacket & { id: number; status: string }>>(
          `SELECT q.id, q.status FROM questions q JOIN topics t ON t.id = q.topic_id WHERE ${topicFilter} FOR UPDATE`, [id],
        );
        for (const question of questions) {
          if (question.status === "archived") continue;
          const transition = getQuestionTransition(question.status, "archived");
          if (!transition || !requirePermission(principal, transition.permission)) {
            await connection.rollback();
            return NextResponse.json({ error: `Question #${question.id} cannot be archived from ${question.status}. No category changes were saved.` }, { status: 409 });
          }
        }
        const [affectedPapers] = await connection.execute<Array<RowDataPacket & { id: number; title: string }>>(
          `SELECT DISTINCT p.id, p.title FROM papers p JOIN paper_questions pq ON pq.paper_id = p.id JOIN questions q ON q.id = pq.question_id
           JOIN topics t ON t.id = q.topic_id WHERE ${topicFilter} AND p.status = 'published' FOR UPDATE`, [id],
        );
        if (affectedPapers.length && body?.confirmPaperRemoval !== true) {
          await connection.rollback();
          return NextResponse.json({ error: "Archiving this category will also archive papers containing its questions. Confirm to continue.", affectedPapers }, { status: 409 });
        }
        await connection.execute(
          `UPDATE papers SET status = 'archived', updated_by = ? WHERE id IN (
             SELECT pq.paper_id FROM paper_questions pq JOIN questions q ON q.id = pq.question_id
             JOIN topics t ON t.id = q.topic_id WHERE ${topicFilter}
           )`,
          [principal.id, id],
        );
        for (const question of questions) if (question.status !== "archived") {
          await connection.execute("UPDATE questions SET status = 'archived', updated_by = ?, version = version + 1 WHERE id = ?", [principal.id, question.id]);
        }
        await connection.execute(kind === "subject"
          ? "UPDATE topics SET status = 'archived', updated_by = ? WHERE subject_id = ?"
          : "UPDATE topics SET status = 'archived', updated_by = ? WHERE id = ?", [principal.id, id]);
        if (kind === "subject") await connection.execute("UPDATE subjects SET status = 'archived', updated_by = ? WHERE id = ?", [principal.id, id]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } else if (!canManage && body?.status === "published") {
      if (kind === "subject") await db.execute("UPDATE subjects SET status = 'published', updated_by = ? WHERE id = ?", [principal.id, id]);
      else {
        const [parent] = await db.execute<Array<RowDataPacket & { id: number; status: string }>>(
          `SELECT s.id, s.status FROM topics t JOIN subjects s ON s.id = t.subject_id
           WHERE t.id = ? LIMIT 1`, [id],
        );
        if (!parent[0] || parent[0].status !== "published") return NextResponse.json({ error: "Publish the parent subject before publishing this topic." }, { status: 400 });
        await db.execute("UPDATE topics SET status = 'published', updated_by = ? WHERE id = ?", [principal.id, id]);
      }
    } else if (body?.status === "published" || body?.status === "draft") {
      if (!canManage) return NextResponse.json({ error: "Reviewers can change publishing status only." }, { status: 403 });
      const status = requestedStatus(body.status, principal);
      const valid = name.length >= 2 && description.length <= 3000 && validSlug(slug) && (kind === "subject" || (Number.isInteger(parentId) && parentId > 0));
      if (!valid) return NextResponse.json({ error: "Enter a valid category name, slug, description, and parent subject for a topic." }, { status: 400 });
      if (kind === "subject") await db.execute("UPDATE subjects SET name = ?, slug = ?, description = ?, status = ?, updated_by = ? WHERE id = ?", [name, slug, description, status, principal.id, id]);
      else await db.execute("UPDATE topics SET subject_id = ?, name = ?, slug = ?, description = ?, status = ?, updated_by = ? WHERE id = ?", [parentId, name, slug, description, status, principal.id, id]);
    } else return NextResponse.json({ error: "Choose draft, published, or archive." }, { status: 400 });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "That URL slug is already in use. Choose another one." }, { status: 409 });
    console.error("Admin category update failed", error);
    return NextResponse.json({ error: "The category could not be updated." }, { status: 500 });
  }
  await auditAdmin(principal, request, body?.status === "archived" || body?.status === "published" ? String(body.status) : "update", kind, id, null, { name, slug, status: body?.status });
  revalidateContent();
  return NextResponse.json({ ok: true });
}
