import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { auditAdmin, csrfFailure } from "@/lib/admin-security";
import { slugify } from "@/lib/admin-content";
import { db, hasDatabase } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getTestPointTotalPages, parseTestPointListingUrl, parseTestPointQuestions, parseTestPointTaxonomy } from "@/lib/testpoint-mcq-import";

const ORIGIN = "https://testpointpk.com";

function forbidden() {
  return NextResponse.json({ error: "Only the Super Admin can use the TestPoint importer." }, { status: 403 });
}

async function getHtml(url: URL) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "MCQPath content importer/1.0" },
  });
  if (!response.ok) throw new Error(`The source site returned HTTP ${response.status}.`);
  return response.text();
}

export async function GET(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal || principal.role !== "super_admin") return forbidden();
  const limited = await rateLimit(request, "testpoint-import", 120, 600);
  if (!limited.allowed) return NextResponse.json({ error: "Too many import requests. Wait a few minutes, then try again." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });

  const requestUrl = new URL(request.url);
  const source = parseTestPointListingUrl(requestUrl.searchParams.get("url"));
  if (!source) return NextResponse.json({ error: "Enter a valid TestPoint categories, subject, or subcategory URL." }, { status: 400 });
  const page = Number(requestUrl.searchParams.get("page") ?? source.searchParams.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 80) return NextResponse.json({ error: "Choose a valid source page." }, { status: 400 });

  try {
    source.searchParams.delete("page");
    if (page > 1) source.searchParams.set("page", String(page));
    const html = await getHtml(source);
    if (!html.includes("/mcqs/") || !html.includes("question-explanation")) return NextResponse.json({ error: "This TestPoint URL does not contain a supported MCQ listing." }, { status: 422 });
    const totalPages = getTestPointTotalPages(html);
    if (page > totalPages) return NextResponse.json({ error: `The source has only ${totalPages} pages.` }, { status: 400 });
    const questions = parseTestPointQuestions(html);
    if (!questions.length) return NextResponse.json({ error: `No MCQs could be parsed from source page ${page}.` }, { status: 502 });
    return NextResponse.json({ source: `${ORIGIN}${source.pathname}`, page, totalPages, questions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    const message = cause instanceof Error && cause.message.startsWith("The source site returned") ? cause.message : timedOut ? "The source site took too long to respond. Try again." : "Could not reach the source site. Try again later.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || principal.role !== "super_admin") return forbidden();
  if (!requirePermission(principal, "category.manage")) return NextResponse.json({ error: "Your account cannot manage categories." }, { status: 403 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply the database migrations first." }, { status: 503 });
  const limited = await rateLimit(request, "testpoint-taxonomy-import", 8, 3600);
  if (!limited.allowed) return NextResponse.json({ error: "Taxonomy import is limited. Try again in a few minutes." }, { status: 429 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const source = parseTestPointListingUrl(body?.url);
  if (!source || source.searchParams.has("page")) return NextResponse.json({ error: "Enter a TestPoint categories page or subject page URL without a page number." }, { status: 400 });

  try {
    const rootHtml = await getHtml(source);
    let taxonomy = parseTestPointTaxonomy(rootHtml, source);
    if (/^\/all-mcqs-categories\/?$/i.test(source.pathname)) {
      const topicsBySubject = new Map<string, Array<{ name: string; slug: string }>>();
      let cursor = 0;
      const workers = Array.from({ length: Math.min(4, taxonomy.subjects.length) }, async () => {
        while (cursor < taxonomy.subjects.length) {
          const subject = taxonomy.subjects[cursor++];
          try {
            const subjectUrl = new URL(subject.url);
            const pageHtml = await getHtml(subjectUrl);
            topicsBySubject.set(subject.slug, parseTestPointTaxonomy(pageHtml, subjectUrl).topics);
          } catch {
            topicsBySubject.set(subject.slug, []);
          }
        }
      });
      await Promise.all(workers);
      taxonomy = { ...taxonomy, topics: taxonomy.subjects.flatMap((item) => (topicsBySubject.get(item.slug) ?? []).map((topic) => ({ ...topic, subjectSlug: item.slug }))) };
    }
    const selectedSubject = taxonomy.subject;
    if (!selectedSubject && !taxonomy.subjects.length) return NextResponse.json({ error: "No subjects or categories were found at that TestPoint URL." }, { status: 422 });

    const connection = await db.getConnection();
    let createdSubjects = 0;
    let createdTopics = 0;
    const inserted: Array<{ id: number; kind: string; name: string; slug: string }> = [];
    try {
      await connection.beginTransaction();
      const rootItems = selectedSubject ? [selectedSubject] : taxonomy.subjects;
      const subjectIds = new Map<string, number>();
      for (const item of rootItems) {
        const slug = slugify(item.slug || item.name);
        const [found] = await connection.execute<Array<RowDataPacket & { id: number }>>("SELECT id FROM subjects WHERE slug = ? LIMIT 1 FOR UPDATE", [slug]);
        let id = Number(found[0]?.id ?? 0);
        if (!id) {
          const [result] = await connection.execute("INSERT INTO subjects (name, slug, description, status, created_by, updated_by) VALUES (?, ?, ?, 'draft', ?, ?)", [item.name.slice(0, 120), slug.slice(0, 140), "Imported from TestPoint; review before publishing.", principal.id, principal.id]);
          id = Number((result as { insertId: number }).insertId);
          createdSubjects++;
          inserted.push({ id, kind: "subject", name: item.name, slug });
        }
        subjectIds.set(item.slug, id);
      }

      const topics = selectedSubject
        ? taxonomy.topics.map((topic) => ({ ...topic, subjectSlug: selectedSubject.slug }))
        : taxonomy.topics;
      const seenTopicSlugs = new Set<string>();
      for (const topic of topics) {
        if (!topic.subjectSlug) continue;
        const subjectId = subjectIds.get(topic.subjectSlug);
        const slug = slugify(topic.slug || topic.name);
        if (!subjectId || !slug || seenTopicSlugs.has(slug)) continue;
        seenTopicSlugs.add(slug);
        const [found] = await connection.execute<Array<RowDataPacket & { id: number }>>("SELECT id FROM topics WHERE slug = ? LIMIT 1 FOR UPDATE", [slug]);
        if (found[0]) continue;
        const [result] = await connection.execute("INSERT INTO topics (subject_id, name, slug, description, status, created_by, updated_by) VALUES (?, ?, ?, ?, 'draft', ?, ?)", [subjectId, topic.name.slice(0, 160), slug.slice(0, 180), "Imported from TestPoint; review before publishing.", principal.id, principal.id]);
        createdTopics++;
        inserted.push({ id: Number((result as { insertId: number }).insertId), kind: "topic", name: topic.name, slug });
      }
      await connection.commit();
    } catch (cause) {
      await connection.rollback();
      if ((cause as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ error: "A matching category was added at the same time. Reload categories and retry." }, { status: 409 });
      throw cause;
    } finally {
      connection.release();
    }

    await auditAdmin(principal, request, "testpoint_taxonomy_import", "subject", null, null, { sourceUrl: source.toString(), createdSubjects, createdTopics, items: inserted });
    for (const path of ["/admin", "/subjects", "/past-papers"]) revalidatePath(path);
    revalidateTag("subjects", "max");
    revalidateTag("topics", "max");
    return NextResponse.json({ ok: true, createdSubjects, createdTopics, skippedExisting: Math.max(0, taxonomy.subjects.length + taxonomy.topics.length - createdSubjects - createdTopics) });
  } catch (cause) {
    console.error("TestPoint taxonomy import failed", cause);
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return NextResponse.json({ error: timedOut ? "TestPoint took too long to respond. Try again." : "Could not import TestPoint categories. Check the URL and retry." }, { status: 502 });
  }
}
