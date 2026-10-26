USE mcqs_website;

-- Paper metadata introduced before the practice-content cleanup (005).
ALTER TABLE papers
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD COLUMN shift_session VARCHAR(120) NULL,
  ADD COLUMN expected_question_count SMALLINT UNSIGNED NULL,
  MODIFY paper_type ENUM('Past paper','Model paper','Mock test') NOT NULL DEFAULT 'Past paper';
