USE mcqs_website;

CREATE TABLE IF NOT EXISTS learners (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(140) NOT NULL,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(180) NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_learners_email (email),
    KEY idx_learners_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS learner_bookmarks (
    learner_id BIGINT UNSIGNED NOT NULL,
    question_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (learner_id, question_id),
    KEY idx_learner_bookmarks_question (question_id),
    CONSTRAINT fk_learner_bookmarks_learner FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE,
    CONSTRAINT fk_learner_bookmarks_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    learner_id BIGINT UNSIGNED NOT NULL,
    quiz_title VARCHAR(220) NOT NULL,
    quiz_path VARCHAR(260) NOT NULL,
    score SMALLINT UNSIGNED NOT NULL,
    question_count SMALLINT UNSIGNED NOT NULL,
    elapsed_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_quiz_attempts_learner_date (learner_id, completed_at),
    CONSTRAINT fk_quiz_attempts_learner FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
