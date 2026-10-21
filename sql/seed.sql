USE mcqs_website;

-- Seed only the subject and topic structure. Real exam MCQs and verified papers
-- must be entered through the admin workspace after their source is checked.
INSERT IGNORE INTO subjects (id, name, slug, description, sort_order, status) VALUES
(1, 'English', 'english', 'English exam questions organised by topic.', 1, 'published'),
(2, 'General Knowledge', 'general-knowledge', 'General knowledge questions organised by topic.', 2, 'published'),
(3, 'Pakistan Studies', 'pakistan-studies', 'Pakistan Studies questions organised by topic.', 3, 'published');

INSERT IGNORE INTO topics (id, subject_id, name, slug, description, sort_order, status) VALUES
(1, 1, 'Grammar', 'english-grammar', 'English grammar questions.', 1, 'published'),
(2, 1, 'Vocabulary', 'english-vocabulary', 'English vocabulary questions.', 2, 'published'),
(3, 2, 'World General Knowledge', 'general-knowledge', 'World general knowledge questions.', 1, 'published'),
(4, 2, 'Everyday Science', 'everyday-science', 'Everyday science questions.', 2, 'published'),
(5, 3, 'Geography of Pakistan', 'pakistan-geography', 'Geography questions about Pakistan.', 1, 'published'),
(6, 3, 'History & National Identity', 'pakistan-history', 'History and national identity questions.', 2, 'published');
