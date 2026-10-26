USE mcqs_website;

-- Search, media, learner verification/reset, quiz review and rate limits.
ALTER TABLE papers
  MODIFY paper_type ENUM('Past paper','Model paper','Mock test') NOT NULL DEFAULT 'Past paper';

ALTER TABLE questions
  ADD COLUMN question_image_url VARCHAR(500) NULL,
  ADD FULLTEXT KEY ft_questions_question_text (question_text);

ALTER TABLE choices ADD COLUMN image_url VARCHAR(500) NULL;

ALTER TABLE learners
  ADD COLUMN email_verified_at DATETIME NULL,
  ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 1;

-- Keep existing learner accounts usable; only newly registered accounts must verify email.
UPDATE learners SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE learner_action_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  learner_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  purpose ENUM('verify_email','reset_password') NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learner_action_token_hash (token_hash),
  KEY idx_learner_action_owner_purpose (learner_id,purpose,expires_at),
  CONSTRAINT fk_learner_action_token_learner FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE quiz_attempt_answers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  learner_id BIGINT UNSIGNED NOT NULL,
  attempt_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  selected_choice CHAR(1) NULL,
  correct_choice CHAR(1) NOT NULL,
  is_correct TINYINT(1) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attempt_answer (attempt_id,question_id),
  KEY idx_learner_topic_weakness (learner_id,topic_id,is_correct),
  CONSTRAINT fk_attempt_answers_learner FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_answers_attempt FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_answers_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_answers_topic FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE api_rate_limit_buckets (
  bucket_key CHAR(64) NOT NULL,
  window_started_at DATETIME NOT NULL,
  hits INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket_key),
  KEY idx_rate_limit_expiry (window_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
