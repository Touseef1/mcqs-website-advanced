USE mcqs_website;

-- Compatibility repair for databases that did not receive migration 011.
-- Existing questions are preserved and receive the English default.
SET @language_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'questions'
    AND COLUMN_NAME = 'language'
);
SET @language_column_sql = IF(
  @language_column_exists = 0,
  'ALTER TABLE questions ADD COLUMN language ENUM(''en'', ''ur'') NOT NULL DEFAULT ''en'' AFTER difficulty',
  'SELECT 1'
);
PREPARE ensure_question_language_column FROM @language_column_sql;
EXECUTE ensure_question_language_column;
DEALLOCATE PREPARE ensure_question_language_column;

SET @language_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'questions'
    AND INDEX_NAME = 'idx_questions_language_status'
);
SET @language_index_sql = IF(
  @language_index_exists = 0,
  'CREATE INDEX idx_questions_language_status ON questions (language, status)',
  'SELECT 1'
);
PREPARE ensure_question_language_index FROM @language_index_sql;
EXECUTE ensure_question_language_index;
DEALLOCATE PREPARE ensure_question_language_index;
