USE mcqs_website;

-- Remove the generated sample sets and the sample questions that shipped with Phase 1.
DELETE FROM papers WHERE paper_type = 'Practice set';

DELETE FROM paper_questions
WHERE question_id IN (
    SELECT id FROM questions WHERE question_text IN (
        'Choose the grammatically correct sentence.',
        'What is the past tense of “write”?',
        'Choose the correct article: “He is ___ honest officer.”',
        'Choose the closest synonym of “brave.”',
        'Choose the opposite of “ancient.”',
        'What does “brief” mean?',
        'Which is the largest ocean on Earth?',
        'Where is the headquarters of the United Nations?',
        'How many continents are commonly recognised?',
        'What is the chemical formula for water?',
        'Which gas do plants absorb during photosynthesis?',
        'At standard atmospheric pressure, water boils at approximately:',
        'Which is the longest river in Pakistan?',
        'Which is the highest mountain in Pakistan?',
        'Which province is the largest by area?',
        'Pakistan became independent in which year?',
        'What is the national language of Pakistan?',
        'What is the national animal of Pakistan?'
    )
);

DELETE FROM questions
WHERE question_text IN (
    'Choose the grammatically correct sentence.',
    'What is the past tense of “write”?',
    'Choose the correct article: “He is ___ honest officer.”',
    'Choose the closest synonym of “brave.”',
    'Choose the opposite of “ancient.”',
    'What does “brief” mean?',
    'Which is the largest ocean on Earth?',
    'Where is the headquarters of the United Nations?',
    'How many continents are commonly recognised?',
    'What is the chemical formula for water?',
    'Which gas do plants absorb during photosynthesis?',
    'At standard atmospheric pressure, water boils at approximately:',
    'Which is the longest river in Pakistan?',
    'Which is the highest mountain in Pakistan?',
    'Which province is the largest by area?',
    'Pakistan became independent in which year?',
    'What is the national language of Pakistan?',
    'What is the national animal of Pakistan?'
);

ALTER TABLE questions
    ADD COLUMN source_note VARCHAR(500) NOT NULL DEFAULT '' AFTER explanation;

-- Existing MCQs without source details must be reviewed before they can be published.
UPDATE questions SET status = 'draft' WHERE source_note = '' AND status = 'published';

ALTER TABLE papers
    MODIFY paper_type ENUM('Past paper') NOT NULL DEFAULT 'Past paper';
