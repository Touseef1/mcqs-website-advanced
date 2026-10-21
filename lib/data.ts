import type { RowDataPacket } from "mysql2";
import { cacheLife, cacheTag } from "next/cache";
import { db, hasDatabase } from "@/lib/db";
import {
  allDemoQuestions,
  allDemoTopics,
  demoPapers,
  demoSubjects,
  getDemoPaper,
  getDemoQuestionsForTopic,
  getDemoSubject,
  getDemoTopic,
  type Paper,
  type Question,
  type Subject,
  type Topic,
} from "@/lib/content";

export type TopicWithSubject = Topic & { subjectSlug: string; subjectName: string };
export type PublicQuestion = Omit<Question, "correctChoice">;
export type QuestionResult = Pick<Question, "id" | "correctChoice" | "explanation">;

export function toPublicQuestion(question: Question): PublicQuestion {
  return {
    id: question.id,
    topicSlug: question.topicSlug,
    prompt: question.prompt,
    choices: question.choices,
    explanation: question.explanation,
  };
}

type SubjectRow = RowDataPacket & { id: number; name: string; slug: string; description: string };
type TopicRow = RowDataPacket & { id: number; slug: string; name: string; description: string; subject_slug: string; subject_name: string; question_count: number };
type QuestionRow = RowDataPacket & { id: number; topic_slug: string; prompt: string; correct_choice: string; explanation: string | null };
type ChoiceRow = RowDataPacket & { question_id: number; label: string; choice_text: string };
type PaperRow = RowDataPacket & { id: number; slug: string; title: string; exam: string; year: number; type: Paper["type"]; description: string };

export async function getSubjects(): Promise<Subject[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("subjects");
  if (!hasDatabase || !db) return demoSubjects;
  const [rows] = await db.execute<SubjectRow[]>(
    `SELECT s.id, s.name, s.slug, s.description
     FROM subjects s WHERE s.status = 'published'
     ORDER BY s.sort_order, s.name`,
  );
  const [topicRows] = await db.execute<TopicRow[]>(
    `SELECT t.id, t.slug, t.name, t.description, s.slug AS subject_slug,
            s.name AS subject_name, COUNT(q.id) AS question_count
     FROM topics t JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN questions q ON q.topic_id = t.id AND q.status = 'published'
     WHERE t.status = 'published' AND s.status = 'published'
     GROUP BY t.id, t.slug, t.name, t.description, s.slug, s.name
     ORDER BY t.sort_order, t.name`,
  );
  return rows.map((subject) => ({
    id: subject.id,
    slug: subject.slug,
    name: subject.name,
    description: subject.description,
    icon: subject.name.slice(0, 2).toUpperCase(),
    topics: topicRows.filter((topic) => topic.subject_slug === subject.slug).map((topic) => ({
      id: topic.id,
      slug: topic.slug,
      name: topic.name,
      description: topic.description,
      questionCount: Number(topic.question_count),
    })),
  }));
}

export async function getSubject(slug: string): Promise<Subject | undefined> {
  "use cache";
  cacheLife("hours");
  cacheTag("subjects");
  if (!hasDatabase || !db) return getDemoSubject(slug);
  return (await getSubjects()).find((subject) => subject.slug === slug);
}

export async function getTopics(): Promise<TopicWithSubject[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("topics");
  if (!hasDatabase || !db) {
    return demoSubjects.flatMap((subject) => subject.topics.map((topic) => ({
      ...topic,
      subjectSlug: subject.slug,
      subjectName: subject.name,
    })));
  }
  const [rows] = await db.execute<TopicRow[]>(
    `SELECT t.id, t.slug, t.name, t.description, s.slug AS subject_slug,
            s.name AS subject_name, COUNT(q.id) AS question_count
     FROM topics t JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN questions q ON q.topic_id = t.id AND q.status = 'published'
     WHERE t.status = 'published' AND s.status = 'published'
     GROUP BY t.id, t.slug, t.name, t.description, s.slug, s.name
     ORDER BY s.sort_order, t.sort_order, t.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    questionCount: Number(row.question_count),
    subjectSlug: row.subject_slug,
    subjectName: row.subject_name,
  }));
}

export async function getTopic(slug: string): Promise<TopicWithSubject | undefined> {
  "use cache";
  cacheLife("hours");
  cacheTag("topics");
  if (!hasDatabase || !db) {
    const topic = getDemoTopic(slug);
    const subject = demoSubjects.find((item) => item.topics.some((entry) => entry.slug === slug));
    return topic && subject ? { ...topic, subjectSlug: subject.slug, subjectName: subject.name } : undefined;
  }
  const [rows] = await db.execute<TopicRow[]>(
    `SELECT t.id, t.slug, t.name, t.description, s.slug AS subject_slug,
            s.name AS subject_name, COUNT(q.id) AS question_count
     FROM topics t JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN questions q ON q.topic_id = t.id AND q.status = 'published'
     WHERE t.slug = ? AND t.status = 'published' AND s.status = 'published'
     GROUP BY t.id, t.slug, t.name, t.description, s.slug, s.name LIMIT 1`,
    [slug],
  );
  const row = rows[0];
  return row ? {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    questionCount: Number(row.question_count),
    subjectSlug: row.subject_slug,
    subjectName: row.subject_name,
  } : undefined;
}

export async function getQuestions(topicSlug: string): Promise<Question[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("questions");
  if (!hasDatabase || !db) return getDemoQuestionsForTopic(topicSlug);
  const [questionRows] = await db.execute<QuestionRow[]>(
    `SELECT q.id, t.slug AS topic_slug, q.question_text AS prompt,
            q.correct_choice, q.explanation
     FROM questions q JOIN topics t ON t.id = q.topic_id
     WHERE t.slug = ? AND q.status = 'published' ORDER BY q.id`,
    [topicSlug],
  );
  if (!questionRows.length) return [];
  const ids = questionRows.map((row) => row.id);
  const marks = ids.map(() => "?").join(",");
  const [choiceRows] = await db.execute<ChoiceRow[]>(
    `SELECT question_id, label, choice_text FROM choices
     WHERE question_id IN (${marks}) ORDER BY label`,
    ids,
  );
  return questionRows.map((row) => ({
    id: row.id,
    topicSlug: row.topic_slug,
    prompt: row.prompt,
    correctChoice: row.correct_choice,
    explanation: row.explanation ?? "",
    choices: choiceRows.filter((choice) => choice.question_id === row.id)
      .map((choice) => ({ label: choice.label, text: choice.choice_text })),
  }));
}

export async function getPublicQuestions(topicSlug: string): Promise<PublicQuestion[]> {
  const questions = await getQuestions(topicSlug);
  return questions.map(toPublicQuestion);
}

export async function gradeQuestions(answers: Array<{ questionId: number; choice: string }>) {
  const ids = [...new Set(answers.map((answer) => answer.questionId))];
  let questions: QuestionResult[];
  if (!hasDatabase || !db) {
    questions = allDemoQuestions.filter((question) => ids.includes(question.id))
      .map(({ id, correctChoice, explanation }) => ({ id, correctChoice, explanation }));
  } else if (ids.length) {
    const marks = ids.map(() => "?").join(",");
    const [rows] = await db.execute<(RowDataPacket & QuestionResult)[]>(
      `SELECT id, correct_choice AS correctChoice, explanation
       FROM questions WHERE id IN (${marks}) AND status = 'published'`,
      ids,
    );
    questions = rows;
  } else {
    questions = [];
  }
  const results = answers.map((answer) => {
    const question = questions.find((item) => item.id === answer.questionId);
    return {
      questionId: answer.questionId,
      selectedChoice: answer.choice,
      correctChoice: question?.correctChoice ?? "",
      correct: Boolean(question && answer.choice === question.correctChoice),
      explanation: question?.explanation ?? "This question is no longer available.",
    };
  });
  return { score: results.filter((result) => result.correct).length, total: results.length, results };
}

export async function getPapers(): Promise<Paper[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("papers");
  if (!hasDatabase || !db) return demoPapers;
  const [rows] = await db.execute<PaperRow[]>(
    `SELECT p.id, p.slug, p.title, e.name AS exam, p.year,
            p.paper_type AS type, p.description
     FROM papers p JOIN exams e ON e.id = p.exam_id
     WHERE p.status = 'published' ORDER BY p.year DESC, p.id DESC`,
  );
  const papers: Paper[] = [];
  for (const row of rows) {
    const [topics] = await db.execute<(RowDataPacket & { slug: string })[]>(
      `SELECT DISTINCT t.slug FROM paper_questions pq
       JOIN questions q ON q.id = pq.question_id
       JOIN topics t ON t.id = q.topic_id
       WHERE pq.paper_id = ? ORDER BY t.slug`,
      [row.id],
    );
    papers.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      exam: row.exam,
      year: row.year,
      type: row.type,
      description: row.description,
      topicSlugs: topics.map((topic) => topic.slug),
    });
  }
  return papers;
}

export async function getPaper(slug: string): Promise<Paper | undefined> {
  "use cache";
  cacheLife("hours");
  cacheTag("papers");
  if (!hasDatabase || !db) return getDemoPaper(slug);
  return (await getPapers()).find((paper) => paper.slug === slug);
}

export async function getQuestionsForPaper(slug: string): Promise<Question[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("questions");
  if (!hasDatabase || !db) {
    const paper = getDemoPaper(slug);
    return paper ? paper.topicSlugs.flatMap((topicSlug) => getDemoQuestionsForTopic(topicSlug)) : [];
  }
  const [rows] = await db.execute<QuestionRow[]>(
    `SELECT q.id, t.slug AS topic_slug, q.question_text AS prompt,
            q.correct_choice, q.explanation
     FROM papers p
     JOIN paper_questions pq ON pq.paper_id = p.id
     JOIN questions q ON q.id = pq.question_id
     JOIN topics t ON t.id = q.topic_id
     WHERE p.slug = ? AND p.status = 'published' AND q.status = 'published'
     ORDER BY pq.question_order`,
    [slug],
  );
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const marks = ids.map(() => "?").join(",");
  const [choiceRows] = await db.execute<ChoiceRow[]>(
    `SELECT question_id, label, choice_text FROM choices
     WHERE question_id IN (${marks}) ORDER BY label`,
    ids,
  );
  return rows.map((row) => ({
    id: row.id,
    topicSlug: row.topic_slug,
    prompt: row.prompt,
    correctChoice: row.correct_choice,
    explanation: row.explanation ?? "",
    choices: choiceRows.filter((choice) => choice.question_id === row.id)
      .map((choice) => ({ label: choice.label, text: choice.choice_text })),
  }));
}

export async function searchContent(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { subjects: [], topics: [], questions: [] };
  if (!hasDatabase || !db) {
    return {
      subjects: demoSubjects.filter((item) => item.name.toLowerCase().includes(normalized)),
      topics: allDemoTopics
        .filter((item) => item.name.toLowerCase().includes(normalized) || item.description.toLowerCase().includes(normalized))
        .map((topic) => {
          const subject = demoSubjects.find((item) => item.topics.some((candidate) => candidate.slug === topic.slug));
          return { ...topic, subjectSlug: subject?.slug ?? "", subjectName: subject?.name ?? "" };
        }),
      questions: allDemoQuestions.filter((item) => item.prompt.toLowerCase().includes(normalized)).slice(0, 10),
    };
  }
  const wildcard = "%" + normalized + "%";
  const [subjects] = await db.execute<SubjectRow[]>(
    `SELECT id, name, slug, description FROM subjects
     WHERE status = 'published' AND (name LIKE ? OR description LIKE ?) LIMIT 10`,
    [wildcard, wildcard],
  );
  const [topics] = await db.execute<TopicRow[]>(
    `SELECT t.id, t.slug, t.name, t.description, s.slug AS subject_slug,
            s.name AS subject_name, COUNT(q.id) AS question_count
     FROM topics t JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN questions q ON q.topic_id = t.id AND q.status = 'published'
     WHERE t.status = 'published' AND s.status = 'published'
       AND (t.name LIKE ? OR t.description LIKE ?)
     GROUP BY t.id, t.slug, t.name, t.description, s.slug, s.name LIMIT 10`,
    [wildcard, wildcard],
  );
  const [questions] = await db.execute<QuestionRow[]>(
    `SELECT q.id, t.slug AS topic_slug, q.question_text AS prompt,
            q.correct_choice, q.explanation
     FROM questions q JOIN topics t ON t.id = q.topic_id
     WHERE q.status = 'published' AND q.question_text LIKE ? LIMIT 10`,
    [wildcard],
  );
  return {
    subjects: subjects.map((item) => ({ id: item.id, slug: item.slug, name: item.name, description: item.description, icon: item.name.slice(0, 2).toUpperCase(), topics: [] })),
    topics: topics.map((item) => ({ id: item.id, slug: item.slug, name: item.name, description: item.description, questionCount: Number(item.question_count), subjectSlug: item.subject_slug, subjectName: item.subject_name })),
    questions: questions.map((item) => ({ id: item.id, topicSlug: item.topic_slug, prompt: item.prompt, choices: [], correctChoice: "", explanation: "" })),
  };
}
