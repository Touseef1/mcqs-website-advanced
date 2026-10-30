USE mcqs_website;

-- Published MCQs whose source note is "{Exam} {Year} Past Paper" belong on that paper.
-- They were stored in the bank without a paper_questions row, so the public paper stayed empty.
CREATE TEMPORARY TABLE tmp_source_paper_links AS
SELECT ranked.paper_id, ranked.question_id,
       ranked.ord + COALESCE((
         SELECT MAX(pq.question_order) FROM paper_questions pq WHERE pq.paper_id = ranked.paper_id
       ), 0) AS question_order
FROM (
  SELECT p.id AS paper_id, q.id AS question_id,
         ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY q.id) AS ord
  FROM questions q
  JOIN papers p ON p.status = 'published'
  JOIN exams e ON e.id = p.exam_id
  WHERE q.status = 'published'
    AND TRIM(q.source_note) = CONCAT(e.name, ' ', p.year, ' Past Paper')
    AND (
      SELECT COUNT(*)
      FROM papers p2
      JOIN exams e2 ON e2.id = p2.exam_id
      WHERE p2.status = 'published'
        AND TRIM(q.source_note) = CONCAT(e2.name, ' ', p2.year, ' Past Paper')
    ) = 1
) ranked
WHERE NOT EXISTS (
  SELECT 1 FROM paper_questions pq
  WHERE pq.paper_id = ranked.paper_id AND pq.question_id = ranked.question_id
);

INSERT INTO paper_questions (paper_id, question_id, question_order)
SELECT paper_id, question_id, question_order FROM tmp_source_paper_links;

DROP TEMPORARY TABLE tmp_source_paper_links;
