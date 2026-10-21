import { NextResponse } from "next/server";
import { gradeQuestions } from "@/lib/data";

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

  const result = await gradeQuestions(answers);
  return NextResponse.json(result);
}
