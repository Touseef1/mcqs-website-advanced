USE mcqs_website;

-- Learners can remove missed questions from their personal retry list without
-- deleting immutable quiz attempt history. A later wrong answer clears dismissal.
CREATE TABLE IF NOT EXISTS learner_wrong_question_dismissals (
  learner_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  dismissed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (learner_id, question_id),
  KEY idx_wrong_question_dismissals_question (question_id),
  CONSTRAINT fk_wrong_dismissals_learner FOREIGN KEY (learner_id)
    REFERENCES learners(id) ON DELETE CASCADE,
  CONSTRAINT fk_wrong_dismissals_question FOREIGN KEY (question_id)
    REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
