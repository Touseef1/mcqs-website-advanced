import { NextResponse } from "next/server";
import { gradeQuestions } from "@/lib/data";
import { getLearnerPrincipal } from "@/lib/learner-auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    !("answers" in body) ||
    !Array.isArray(body.answers) ||
    body.answers.length > 100
  ) {
    return NextResponse.json({ error: "Invalid quiz answers." }, { status: 400 });
  }

  const answers = body.answers as Array<{ questionId: number; choice: string }>;
  if (answers.some((answer) =>
    !Number.isInteger(answer.questionId) ||
    typeof answer.choice !== "string" ||
    !(answer.choice === "" || ["A", "B", "C", "D"].includes(answer.choice))
  )) {
    return NextResponse.json({ error: "Each answer must include a question ID and a valid choice." }, { status: 400 });
  }

  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) {
    return NextResponse.json({ error: "A question can only be answered once." }, { status: 400 });
  }

  const result = await gradeQuestions(answers);
  const learner = await getLearnerPrincipal();
  const rawQuizPath = "quizPath" in body && typeof body.quizPath === "string" ? body.quizPath : "";
  const quizPath = /^\/(quiz|past-papers)\/[a-z0-9][a-z0-9-]{0,239}$/i.test(rawQuizPath) ? rawQuizPath : "/subjects";
  const quizTitle = "quizTitle" in body && typeof body.quizTitle === "string" ? body.quizTitle.trim().slice(0, 220) : "Practice quiz";
  const elapsedSeconds = "elapsedSeconds" in body && typeof body.elapsedSeconds === "number" && Number.isFinite(body.elapsedSeconds)
    ? Math.max(0, Math.min(7200, Math.floor(body.elapsedSeconds)))
    : 0;
  if (learner && db && result.total > 0) {
    await db.execute(
      `INSERT INTO quiz_attempts (learner_id, quiz_title, quiz_path, score, question_count, elapsed_seconds)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [learner.id, quizTitle || "Practice quiz", quizPath, result.score, result.total, elapsedSeconds],
    );
  }
  return NextResponse.json(result);
}
