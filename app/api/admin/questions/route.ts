import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

const labels = ["A", "B", "C", "D"];

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Please sign in as an administrator." }, { status: 401 });
  }
  if (!hasDatabase || !db) {
    return NextResponse.json({ error: "Configure the MySQL connection to publish questions." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const topicId = Number(body?.topicId);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const explanation = typeof body?.explanation === "string" ? body.explanation.trim() : "";
  const choices = Array.isArray(body?.choices) ? body.choices.map((choice: unknown) => String(choice).trim()) : [];
  const correctChoice = typeof body?.correctChoice === "string" ? body.correctChoice : "";

  if (!Number.isInteger(topicId) || topicId < 1 || prompt.length < 8 || prompt.length > 1500 ||
      explanation.length < 3 || explanation.length > 3000 || choices.length !== 4 ||
      choices.some((choice: string) => choice.length < 1 || choice.length > 800) ||
      !labels.includes(correctChoice)) {
    return NextResponse.json({ error: "Check the question, four choices, correct answer, and explanation." }, { status: 400 });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [insert] = await connection.execute(
      `INSERT INTO questions (topic_id, question_text, explanation, correct_choice, status)
       SELECT id, ?, ?, ?, 'published' FROM topics WHERE id = ? AND status = 'published'`,
      [prompt, explanation, correctChoice, topicId],
    );
    const questionId = (insert as { insertId: number; affectedRows: number }).insertId;
    if (!questionId) {
      await connection.rollback();
      return NextResponse.json({ error: "Choose a published topic." }, { status: 400 });
    }
    for (let index = 0; index < labels.length; index++) {
      await connection.execute(
        "INSERT INTO choices (question_id, label, choice_text) VALUES (?, ?, ?)",
        [questionId, labels[index], choices[index]],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    console.error("Admin question creation failed", error);
    return NextResponse.json({ error: "The question could not be saved." }, { status: 500 });
  } finally {
    connection.release();
  }

  revalidatePath("/");
  revalidatePath("/subjects");
  revalidatePath("/past-papers");
  revalidateTag("questions", "max");
  revalidateTag("subjects", "max");
  revalidateTag("topics", "max");
  return NextResponse.json({ ok: true });
}
