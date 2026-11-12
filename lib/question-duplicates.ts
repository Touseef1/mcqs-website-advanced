import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

export type DuplicateCandidate = {
  rowNumber: number;
  prompt: string;
  choices: string[];
  correctChoice: string;
};

export type ExistingQuestionMatch = {
  id: number;
  prompt: string;
  status: string;
  topicId: number;
  topicName: string;
  subjectName: string;
  attachedPaperIds: number[];
  exact?: boolean;
  similarity?: number;
};

export function normalizeDuplicateText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function duplicateKey(question: Pick<DuplicateCandidate, "prompt" | "choices" | "correctChoice">) {
  const choices = question.choices.map(normalizeDuplicateText);
  const answerIndex = "ABCD".indexOf(question.correctChoice.toUpperCase());
  const correctAnswer = answerIndex >= 0 ? choices[answerIndex] : "";
  return JSON.stringify([normalizeDuplicateText(question.prompt), ...choices.sort(), correctAnswer]);
}

export async function findExistingQuestionMatches(
  connection: PoolConnection,
  candidates: DuplicateCandidate[],
  preferredTopicId: number,
  paperIds: number[] = [],
) {
  const matches = new Map<number, ExistingQuestionMatch>();
  if (!candidates.length) return matches;

  const candidatePrompts = [...new Set(candidates.map((candidate) => candidate.prompt.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()).filter(Boolean))];
  const grouped = new Map<number, { prompt: string; correctChoice: string; status: string; topicId: number; topicName: string; subjectName: string; choices: string[] }>();

  // Keep each IN list bounded so larger category-only bulk imports remain safe.
  for (let offset = 0; offset < candidatePrompts.length; offset += 100) {
    const prompts = candidatePrompts.slice(offset, offset + 100);
    const [rows] = await connection.execute<Array<RowDataPacket & {
      id: number; question_text: string; correct_choice: string; status: string; topic_id: number;
      topic_name: string; subject_name: string; label: string | null; choice_text: string | null;
    }>>(
      `SELECT q.id, q.question_text, q.correct_choice, q.status, q.topic_id,
              t.name AS topic_name, s.name AS subject_name, c.label, c.choice_text
       FROM questions q
       JOIN topics t ON t.id = q.topic_id
       JOIN subjects s ON s.id = t.subject_id
       LEFT JOIN choices c ON c.question_id = q.id
       WHERE q.status != 'archived'
         AND LOWER(REGEXP_REPLACE(TRIM(q.question_text), '[[:space:]]+', ' ')) IN (${prompts.map(() => "?").join(",")})
       ORDER BY (q.topic_id = ?) DESC, (q.status = 'published') DESC, q.id DESC, c.label`,
      [...prompts, preferredTopicId],
    );

    for (const row of rows) {
      let item = grouped.get(row.id);
      if (!item) {
        item = { prompt: row.question_text, correctChoice: row.correct_choice, status: row.status, topicId: row.topic_id, topicName: row.topic_name, subjectName: row.subject_name, choices: ["", "", "", ""] };
        grouped.set(row.id, item);
      }
      if (row.label && row.choice_text) item.choices[row.label.charCodeAt(0) - 65] = row.choice_text;
    }
  }

  const byKey = new Map<string, number>();
  for (const [id, item] of grouped) {
    const key = duplicateKey({ prompt: item.prompt, choices: item.choices, correctChoice: item.correctChoice });
    if (!byKey.has(key)) byKey.set(key, id);
  }
  const ids = [...new Set(candidates.flatMap((candidate) => {
    const id = byKey.get(duplicateKey(candidate));
    return id ? [id] : [];
  }))];
  const attachedByQuestion = new Map<number, number[]>();
  if (paperIds.length && ids.length) {
    for (let offset = 0; offset < ids.length; offset += 200) {
      const chunk = ids.slice(offset, offset + 200);
      const [links] = await connection.execute<Array<RowDataPacket & { paper_id: number; question_id: number }>>(
        `SELECT paper_id, question_id FROM paper_questions WHERE paper_id IN (${paperIds.map(() => "?").join(",")}) AND question_id IN (${chunk.map(() => "?").join(",")})`,
        [...paperIds, ...chunk],
      );
      for (const link of links) attachedByQuestion.set(link.question_id, [...(attachedByQuestion.get(link.question_id) ?? []), link.paper_id]);
    }
  }

  for (const candidate of candidates) {
    const id = byKey.get(duplicateKey(candidate));
    if (!id) continue;
    const item = grouped.get(id)!;
    matches.set(candidate.rowNumber, {
      id, prompt: item.prompt, status: item.status, topicId: item.topicId, topicName: item.topicName,
      subjectName: item.subjectName, attachedPaperIds: attachedByQuestion.get(id) ?? [], exact: true, similarity: 100,
    });
  }
  return matches;
}

export async function findSimilarQuestionMatches(
  connection: PoolConnection,
  candidates: DuplicateCandidate[],
  preferredTopicId: number,
  paperIds: number[] = [],
) {
  const matches = new Map<number, ExistingQuestionMatch>();
  if (!candidates.length) return matches;
  const [rows] = await connection.execute<Array<RowDataPacket & {
    id: number; question_text: string; status: string; topic_id: number;
    topic_name: string; subject_name: string; label: string | null; choice_text: string | null;
  }>>(
    `SELECT q.id, q.question_text, q.status, q.topic_id,
            t.name AS topic_name, s.name AS subject_name, c.label, c.choice_text
     FROM questions q JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN choices c ON c.question_id = q.id
     WHERE q.status != 'archived'
     ORDER BY (q.status = 'published') DESC, (q.topic_id = ?) DESC, q.id DESC
     LIMIT 8000`, [preferredTopicId],
  );
  const grouped = new Map<number, { prompt: string; status: string; topicId: number; topicName: string; subjectName: string; choices: string[] }>();
  for (const row of rows) {
    let item = grouped.get(row.id);
    if (!item) {
      item = { prompt: row.question_text, status: row.status, topicId: row.topic_id, topicName: row.topic_name, subjectName: row.subject_name, choices: ["", "", "", ""] };
      grouped.set(row.id, item);
    }
    if (row.label && row.choice_text) item.choices[row.label.charCodeAt(0) - 65] = row.choice_text;
  }
  const candidateTokens = candidates.map((candidate) => new Set(normalizeDuplicateText(candidate.prompt).split(" ").filter(Boolean)));
  const best = new Map<number, ExistingQuestionMatch & { score: number }>();
  for (const [id, existing] of grouped) {
    const tokens = new Set(normalizeDuplicateText(existing.prompt).split(" ").filter(Boolean));
    for (let index = 0; index < candidates.length; index++) {
      const queryTokens = candidateTokens[index];
      if (!tokens.size || !queryTokens.size) continue;
      const common = [...queryTokens].filter((token) => tokens.has(token)).length;
      const score = Math.round((2 * common / (tokens.size + queryTokens.size)) * 100);
      if (score < 78) continue;
      const prior = best.get(candidates[index].rowNumber);
      if (prior && prior.score >= score) continue;
      best.set(candidates[index].rowNumber, {
        id, prompt: existing.prompt, status: existing.status, topicId: existing.topicId, topicName: existing.topicName,
        subjectName: existing.subjectName, attachedPaperIds: [], exact: false, similarity: score, score,
      });
    }
  }
  const paperLinks = new Map<number, number[]>();
  const ids = [...new Set([...best.values()].map((match) => match.id))];
  if (paperIds.length && ids.length) {
    const [links] = await connection.execute<Array<RowDataPacket & { question_id: number; paper_id: number }>>(
      `SELECT question_id, paper_id FROM paper_questions WHERE paper_id IN (${paperIds.map(() => "?").join(",")}) AND question_id IN (${ids.map(() => "?").join(",")})`,
      [...paperIds, ...ids],
    );
    for (const link of links) paperLinks.set(link.question_id, [...(paperLinks.get(link.question_id) ?? []), link.paper_id]);
  }
  for (const [row, match] of best) matches.set(row, { ...match, attachedPaperIds: paperLinks.get(match.id) ?? [] });
  return matches;
}
