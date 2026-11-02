import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getLearnerPrincipal } from "@/lib/learner-auth";
import { db } from "@/lib/db";

export async function GET() {
  const learner = await getLearnerPrincipal();
  if (!learner || !db) return NextResponse.json({ error: "Sign in to view your progress." }, { status: 401 });
  const [summaryRows] = await db.execute<(RowDataPacket & { attempts: number; average_score: number | null; saved_count: number })[]>(
    `SELECT (SELECT COUNT(*) FROM quiz_attempts WHERE learner_id = ?) AS attempts,
            (SELECT ROUND(AVG(CASE WHEN COALESCE(ac.attempted, 0) > 0
                                    THEN ac.correct / ac.attempted * 100
                                    ELSE a.score / NULLIF(a.question_count, 0) * 100 END))
               FROM quiz_attempts a
               LEFT JOIN (
                 SELECT attempt_id,
                        COUNT(CASE WHEN selected_choice IS NOT NULL THEN 1 END) AS attempted,
                        SUM(CASE WHEN selected_choice IS NOT NULL AND is_correct = 1 THEN 1 ELSE 0 END) AS correct
                   FROM quiz_attempt_answers GROUP BY attempt_id
               ) ac ON ac.attempt_id = a.id
              WHERE a.learner_id = ?) AS average_score,
            (SELECT COUNT(*) FROM learner_bookmarks WHERE learner_id = ?) AS saved_count`,
    [learner.id, learner.id, learner.id],
  );
  const [attempts] = await db.execute<(RowDataPacket & { id: number; quiz_title: string; quiz_path: string; score: number; question_count: number; completed_at: Date })[]>(
    `SELECT a.id, a.quiz_title, a.quiz_path,
            CASE WHEN COALESCE(ac.attempted, 0) > 0 THEN ac.correct ELSE a.score END AS score,
            CASE WHEN COALESCE(ac.attempted, 0) > 0 THEN ac.attempted ELSE a.question_count END AS question_count,
            a.completed_at
       FROM quiz_attempts a
       LEFT JOIN (
         SELECT attempt_id,
                COUNT(CASE WHEN selected_choice IS NOT NULL THEN 1 END) AS attempted,
                SUM(CASE WHEN selected_choice IS NOT NULL AND is_correct = 1 THEN 1 ELSE 0 END) AS correct
           FROM quiz_attempt_answers GROUP BY attempt_id
       ) ac ON ac.attempt_id = a.id
      WHERE a.learner_id = ? ORDER BY a.completed_at DESC LIMIT 20`, [learner.id],
  );
  const [weakTopics] = await db.execute<Array<RowDataPacket & { slug: string; topic_name: string; subject_name: string; attempted: number; correct: number }>>(
    `SELECT t.slug, t.name AS topic_name, s.name AS subject_name, COUNT(*) AS attempted,
            SUM(qa.is_correct) AS correct
       FROM quiz_attempt_answers qa JOIN topics t ON t.id = qa.topic_id JOIN subjects s ON s.id = t.subject_id
      WHERE qa.learner_id = ? AND qa.selected_choice IS NOT NULL GROUP BY t.id
     HAVING COUNT(*) >= 2 AND SUM(qa.is_correct) / COUNT(*) < 0.6
      ORDER BY SUM(qa.is_correct) / COUNT(*) ASC, COUNT(*) DESC LIMIT 6`, [learner.id],
  );
  const summary = summaryRows[0];
  return NextResponse.json({
    summary: { attempts: Number(summary?.attempts ?? 0), averageScore: Number(summary?.average_score ?? 0), savedQuestions: Number(summary?.saved_count ?? 0) },
    attempts: attempts.map((attempt) => ({ ...attempt, completed_at: attempt.completed_at.toISOString() })),
    weakTopics: weakTopics.map((topic) => ({ ...topic, attempted: Number(topic.attempted), correct: Number(topic.correct) })),
  });
}
