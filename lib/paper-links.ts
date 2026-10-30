import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Sql = Pool | PoolConnection;

const sourceMatch = "TRIM(q.source_note) = CONCAT(e.name, ' ', p.year, ' Past Paper')";

async function insertLinks(executor: Sql, paperId: number, questionIds: number[]) {
  if (!questionIds.length) return 0;
  await executor.execute("SELECT id FROM papers WHERE id = ? FOR UPDATE", [paperId]);
  const [rows] = await executor.execute<Array<RowDataPacket & { max_order: number | null }>>(
    "SELECT MAX(question_order) AS max_order FROM paper_questions WHERE paper_id = ? FOR UPDATE",
    [paperId],
  );
  let order = Number(rows[0]?.max_order ?? 0);
  for (const questionId of questionIds) {
    order += 1;
    await executor.execute(
      "INSERT INTO paper_questions (paper_id, question_id, question_order) VALUES (?, ?, ?)",
      [paperId, questionId, order],
    );
  }
  return questionIds.length;
}

async function withSql<T>(executor: Sql, run: (connection: PoolConnection) => Promise<T>) {
  if (!("getConnection" in executor)) return run(executor);
  const connection = await executor.getConnection();
  try {
    await connection.beginTransaction();
    const result = await run(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Attach published MCQs to the one published paper whose exam and year match the source note. */
export async function linkPublishedQuestionsBySource(executor: Sql, questionIds: number[]) {
  return withSql(executor, (connection) => linkPublishedQuestionsOnConnection(connection, questionIds));
}

async function linkPublishedQuestionsOnConnection(executor: PoolConnection, questionIds: number[]) {
  const ids = [...new Set(questionIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return 0;
  const marks = ids.map(() => "?").join(",");
  const [rows] = await executor.execute<Array<RowDataPacket & { question_id: number; paper_id: number }>>(
    `SELECT q.id AS question_id, p.id AS paper_id
     FROM questions q
     JOIN papers p ON p.status = 'published'
     JOIN exams e ON e.id = p.exam_id
     LEFT JOIN paper_questions existing ON existing.paper_id = p.id AND existing.question_id = q.id
     WHERE q.id IN (${marks})
       AND q.status = 'published'
       AND existing.question_id IS NULL
       AND ${sourceMatch}
     ORDER BY p.id, q.id`,
    ids,
  );
  const papersByQuestion = new Map<number, number[]>();
  for (const row of rows) {
    const papers = papersByQuestion.get(row.question_id) ?? [];
    papers.push(row.paper_id);
    papersByQuestion.set(row.question_id, papers);
  }
  const questionsByPaper = new Map<number, number[]>();
  for (const [questionId, papers] of papersByQuestion) {
    if (papers.length !== 1) continue;
    const list = questionsByPaper.get(papers[0]) ?? [];
    list.push(questionId);
    questionsByPaper.set(papers[0], list);
  }
  let linked = 0;
  for (const [paperId, linkedIds] of questionsByPaper) linked += await insertLinks(executor, paperId, linkedIds);
  return linked;
}

/** When a paper is published, pull in published MCQs that already name that exam and year. */
export async function linkPaperBySource(executor: Sql, paperId: number) {
  return withSql(executor, (connection) => linkPaperOnConnection(connection, paperId));
}

async function linkPaperOnConnection(executor: PoolConnection, paperId: number) {
  const [rows] = await executor.execute<Array<RowDataPacket & { id: number }>>(
    `SELECT q.id
     FROM questions q
     JOIN papers p ON p.id = ?
     JOIN exams e ON e.id = p.exam_id
     LEFT JOIN paper_questions existing ON existing.paper_id = p.id AND existing.question_id = q.id
     WHERE p.status = 'published'
       AND q.status = 'published'
       AND existing.question_id IS NULL
       AND ${sourceMatch}
       AND (
         SELECT COUNT(*) FROM papers p2
         JOIN exams e2 ON e2.id = p2.exam_id
         WHERE p2.status = 'published'
           AND TRIM(q.source_note) = CONCAT(e2.name, ' ', p2.year, ' Past Paper')
       ) = 1
     ORDER BY q.id`,
    [paperId],
  );
  if (!rows.length) return 0;
  return linkPublishedQuestionsOnConnection(executor, rows.map((row) => Number(row.id)));
}
