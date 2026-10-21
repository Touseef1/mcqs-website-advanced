import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, hasPermission } from "@/lib/admin-auth";
import { requestedStatus, slugify, validSlug } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";

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
  if (!principal || !hasPermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
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
  const principal = await getAdminPrincipal();
  if (!principal || !hasPermission(principal, "categories:manage")) return NextResponse.json({ error: "Your role cannot manage categories." }, { status: 403 });
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
  try {
    if (kind === "subject") {
      await db.execute("INSERT INTO subjects (name, slug, description, status) VALUES (?, ?, ?, ?)", [name, slug, description, status]);
    } else {
      const [parent] = await db.execute<Array<RowDataPacket & { id: number; status: string }>>("SELECT id, status FROM subjects WHERE id = ? LIMIT 1", [parentId]);
      if (!parent[0] || (status === "published" && parent[0].status !== "published")) return NextResponse.json({ error: "Choose an existing published subject to publish this topic." }, { status: 400 });
      await db.execute("INSERT INTO topics (subject_id, name, slug, description, status) VALUES (?, ?, ?, ?, ?)", [parentId, name, slug, description, status]);
    }
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "That URL slug is already in use. Choose another one." }, { status: 409 });
    console.error("Admin category creation failed", error);
    return NextResponse.json({ error: "The category could not be saved." }, { status: 500 });
  }
  revalidateContent();
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
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

  const canManage = hasPermission(principal, "categories:manage");
  const canReview = hasPermission(principal, "content:publish") && (body?.status === "published" || body?.status === "archived");
  if (!canManage && !canReview) return NextResponse.json({ error: "Your role cannot manage categories." }, { status: 403 });

  try {
    if (body?.status === "archived") {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const topicFilter = kind === "subject" ? "t.subject_id = ?" : "t.id = ?";
        const topicIds = kind === "subject" ? "SELECT id FROM topics WHERE subject_id = ?" : "SELECT id FROM topics WHERE id = ?";
        await connection.execute(
          `UPDATE papers SET status = 'archived' WHERE id IN (
             SELECT pq.paper_id FROM paper_questions pq JOIN questions q ON q.id = pq.question_id
             JOIN topics t ON t.id = q.topic_id WHERE ${topicFilter}
           )`,
          [id],
        );
        await connection.execute(
          `UPDATE questions SET status = 'archived' WHERE topic_id IN (${topicIds})`,
          [id],
        );
        await connection.execute(kind === "subject"
          ? "UPDATE topics SET status = 'archived' WHERE subject_id = ?"
          : "UPDATE topics SET status = 'archived' WHERE id = ?", [id]);
        if (kind === "subject") await connection.execute("UPDATE subjects SET status = 'archived' WHERE id = ?", [id]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } else if (!canManage && body?.status === "published") {
      if (kind === "subject") await db.execute("UPDATE subjects SET status = 'published' WHERE id = ?", [id]);
      else {
        const [parent] = await db.execute<Array<RowDataPacket & { id: number; status: string }>>(
          `SELECT s.id, s.status FROM topics t JOIN subjects s ON s.id = t.subject_id
           WHERE t.id = ? LIMIT 1`, [id],
        );
        if (!parent[0] || parent[0].status !== "published") return NextResponse.json({ error: "Publish the parent subject before publishing this topic." }, { status: 400 });
        await db.execute("UPDATE topics SET status = 'published' WHERE id = ?", [id]);
      }
    } else if (body?.status === "published" || body?.status === "draft") {
      if (!canManage) return NextResponse.json({ error: "Reviewers can change publishing status only." }, { status: 403 });
      const status = requestedStatus(body.status, principal);
      const valid = name.length >= 2 && description.length <= 3000 && validSlug(slug) && (kind === "subject" || (Number.isInteger(parentId) && parentId > 0));
      if (!valid) return NextResponse.json({ error: "Enter a valid category name, slug, description, and parent subject for a topic." }, { status: 400 });
      if (kind === "subject") await db.execute("UPDATE subjects SET name = ?, slug = ?, description = ?, status = ? WHERE id = ?", [name, slug, description, status, id]);
      else await db.execute("UPDATE topics SET subject_id = ?, name = ?, slug = ?, description = ?, status = ? WHERE id = ?", [parentId, name, slug, description, status, id]);
    } else return NextResponse.json({ error: "Choose draft, published, or archive." }, { status: 400 });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "That URL slug is already in use. Choose another one." }, { status: 409 });
    console.error("Admin category update failed", error);
    return NextResponse.json({ error: "The category could not be updated." }, { status: 500 });
  }
  revalidateContent();
  return NextResponse.json({ ok: true });
}
