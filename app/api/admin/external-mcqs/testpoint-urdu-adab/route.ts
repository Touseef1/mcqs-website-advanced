import { NextResponse } from "next/server";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { getTestPointTotalPages, parseTestPointQuestions } from "@/lib/testpoint-mcq-import";
import { rateLimit } from "@/lib/rate-limit";

const SOURCE_URL = "https://testpointpk.com/subcategory-mcqs/urdu-adab";

export async function GET(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "mcq.create")) {
    return NextResponse.json({ error: "Your role cannot import MCQs." }, { status: 403 });
  }

  const limited = await rateLimit(request, "testpoint-urdu-adab-import", 90, 600);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Too many import requests. Wait a few minutes, then try again." }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfter) },
    });
  }

  const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 80) {
    return NextResponse.json({ error: "Choose a valid source page." }, { status: 400 });
  }

  try {
    const source = new URL(SOURCE_URL);
    if (page > 1) source.searchParams.set("page", String(page));
    const response = await fetch(source, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "MCQPath content importer/1.0",
      },
    });
    if (!response.ok) {
      return NextResponse.json({ error: `The source site returned HTTP ${response.status} for page ${page}.` }, { status: 502 });
    }

    const html = await response.text();
    if (!html.includes("question-explanation") || !html.includes("/mcqs/")) {
      return NextResponse.json({ error: "The source page format changed or did not contain MCQs." }, { status: 502 });
    }

    const totalPages = getTestPointTotalPages(html);
    if (page > totalPages) return NextResponse.json({ error: `The source has only ${totalPages} pages.` }, { status: 400 });
    const questions = parseTestPointQuestions(html);
    if (!questions.length) return NextResponse.json({ error: `No MCQs could be parsed from source page ${page}.` }, { status: 502 });

    return NextResponse.json({ source: SOURCE_URL, page, totalPages, questions }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json({ error: timedOut ? "The source site took too long to respond. Try again." : "Could not reach the source site. Try again later." }, { status: 502 });
  }
}
