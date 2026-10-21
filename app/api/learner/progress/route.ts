import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getLearnerPrincipal } from "@/lib/learner-auth";
import { db } from "@/lib/db";

export async function GET() {
  const learner = await getLearnerPrincipal();
  if (!learner || !db) return NextResponse.json({ error: "Sign in to view your progress." }, { status: 401 });
  const [summaryRows] = await db.execute<(RowDataPacket & { attempts: number; average_score: number | null; saved_count: number })[]>(
    `SELECT (SELECT COUNT(*) FROM quiz_attempts WHERE learner_id = ?) AS attempts,
            (SELECT ROUND(AVG(score / NULLIF(question_count, 0) * 100)) FROM quiz_attempts WHERE learner_id = ?) AS average_score,
            (SELECT COUNT(*) FROM learner_bookmarks WHERE learner_id = ?) AS saved_count`,
    [learner.id, learner.id, learner.id],
  );
  const [attempts] = await db.execute<(RowDataPacket & { id: number; quiz_title: string; quiz_path: string; score: number; question_count: number; completed_at: Date })[]>(
    `SELECT id, quiz_title, quiz_path, score, question_count, completed_at
     FROM quiz_attempts WHERE learner_id = ? ORDER BY completed_at DESC LIMIT 20`, [learner.id],
  );
  const summary = summaryRows[0];
  return NextResponse.json({
    summary: { attempts: Number(summary?.attempts ?? 0), averageScore: Number(summary?.average_score ?? 0), savedQuestions: Number(summary?.saved_count ?? 0) },
    attempts: attempts.map((attempt) => ({ ...attempt, completed_at: attempt.completed_at.toISOString() })),
  });
}
