import { NextResponse } from "next/server";
import { gradeQuestions } from "@/lib/data";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limit = await rateLimit(request, "quiz-reveal", 90, 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many answer checks. Please wait a minute and try again." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter) },
    });
  }

  const rawIds = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = rawIds.split(",").map(Number);
  if (!ids.length || ids.length > 10 || ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "Request up to 10 unique question IDs." }, { status: 400 });
  }

  const graded = await gradeQuestions(ids.map((questionId) => ({ questionId, choice: "" })));
  return NextResponse.json({ answers: graded.results.map(({ questionId, correctChoice, explanation }) => ({ questionId, correctChoice, explanation })) }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
