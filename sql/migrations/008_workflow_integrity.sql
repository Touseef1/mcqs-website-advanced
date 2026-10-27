USE mcqs_website;

-- Expand the workflow safely: all existing status values are valid members.
ALTER TABLE questions
  MODIFY status ENUM('draft','in_review','approved','published','rejected','archived') NOT NULL DEFAULT 'draft',
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN current_revision_id BIGINT UNSIGNED NULL;

CREATE TABLE question_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  question_id BIGINT UNSIGNED NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  content_snapshot JSON NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_question_revision_number (question_id, revision_number),
  KEY idx_question_revision_question (question_id, created_at),
  CONSTRAINT fk_question_revision_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_question_revision_creator FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE questions
  ADD CONSTRAINT fk_questions_current_revision FOREIGN KEY (current_revision_id) REFERENCES question_revisions(id) ON DELETE SET NULL;

ALTER TABLE quiz_attempt_answers
  ADD COLUMN question_revision_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_attempt_answer_revision FOREIGN KEY (question_revision_id) REFERENCES question_revisions(id) ON DELETE SET NULL;
