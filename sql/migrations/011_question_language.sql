USE mcqs_website;

-- Existing rows safely default to English. Staff can set Urdu for new or edited MCQs.
ALTER TABLE questions
  ADD COLUMN language ENUM('en', 'ur') NOT NULL DEFAULT 'en' AFTER difficulty;

CREATE INDEX idx_questions_language_status ON questions (language, status);
