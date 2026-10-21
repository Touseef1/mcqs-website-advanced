USE mcqs_website;

INSERT IGNORE INTO subjects (id, name, slug, description, sort_order, status) VALUES
(1, 'English', 'english', 'Build confidence in grammar, vocabulary, and sentence usage.', 1, 'published'),
(2, 'General Knowledge', 'general-knowledge', 'Practise world facts and everyday science concepts.', 2, 'published'),
(3, 'Pakistan Studies', 'pakistan-studies', 'Review Pakistan’s geography, history, and national symbols.', 3, 'published');

INSERT IGNORE INTO topics (id, subject_id, name, slug, description, sort_order, status) VALUES
(1, 1, 'Grammar', 'english-grammar', 'Parts of speech, tenses, and correct sentence structure.', 1, 'published'),
(2, 1, 'Vocabulary', 'english-vocabulary', 'Synonyms, antonyms, and commonly tested words.', 2, 'published'),
(3, 2, 'World General Knowledge', 'general-knowledge', 'Countries, organisations, geography, and world facts.', 1, 'published'),
(4, 2, 'Everyday Science', 'everyday-science', 'Basic science questions used in general recruitment tests.', 2, 'published'),
(5, 3, 'Geography of Pakistan', 'pakistan-geography', 'Rivers, provinces, mountains, and national landmarks.', 1, 'published'),
(6, 3, 'History & National Identity', 'pakistan-history', 'Key facts about Pakistan and its national identity.', 2, 'published');

INSERT IGNORE INTO questions (id, topic_id, question_text, explanation, correct_choice, difficulty, status) VALUES
(1, 1, 'Choose the grammatically correct sentence.', 'With the singular subject “she” in the simple present, the verb takes -s: “goes.”', 'B', 'easy', 'published'),
(2, 1, 'What is the past tense of “write”?', '“Wrote” is the simple past form. “Written” is the past participle.', 'B', 'easy', 'published'),
(3, 1, 'Choose the correct article: “He is ___ honest officer.”', '“Honest” begins with a vowel sound because the “h” is silent, so use “an.”', 'B', 'easy', 'published'),
(4, 2, 'Choose the closest synonym of “brave.”', '“Courageous” means showing courage and is closest in meaning to “brave.”', 'A', 'easy', 'published'),
(5, 2, 'Choose the opposite of “ancient.”', '“Modern” means relating to the present or recent times.', 'C', 'easy', 'published'),
(6, 2, 'What does “brief” mean?', '“Brief” means short in time or length.', 'B', 'easy', 'published'),
(7, 3, 'Which is the largest ocean on Earth?', 'The Pacific Ocean is the largest ocean on Earth.', 'D', 'easy', 'published'),
(8, 3, 'Where is the headquarters of the United Nations?', 'The United Nations headquarters is in New York City, United States.', 'B', 'easy', 'published'),
(9, 3, 'How many continents are commonly recognised?', 'The commonly taught model recognises seven continents.', 'C', 'easy', 'published'),
(10, 4, 'What is the chemical formula for water?', 'A water molecule contains two hydrogen atoms and one oxygen atom: H₂O.', 'B', 'easy', 'published'),
(11, 4, 'Which gas do plants absorb during photosynthesis?', 'Plants use carbon dioxide, water, and light energy to make sugars.', 'C', 'easy', 'published'),
(12, 4, 'At standard atmospheric pressure, water boils at approximately:', 'At standard atmospheric pressure, water boils at 100°C.', 'C', 'easy', 'published'),
(13, 5, 'Which is the longest river in Pakistan?', 'The Indus is Pakistan’s longest river and its major river system.', 'C', 'easy', 'published'),
(14, 5, 'Which is the highest mountain in Pakistan?', 'K2, in the Karakoram range, is the highest mountain in Pakistan.', 'B', 'easy', 'published'),
(15, 5, 'Which province is the largest by area?', 'Balochistan is Pakistan’s largest province by area.', 'D', 'easy', 'published'),
(16, 6, 'Pakistan became independent in which year?', 'Pakistan became independent on 14 August 1947.', 'B', 'easy', 'published'),
(17, 6, 'What is the national language of Pakistan?', 'Urdu is the national language of Pakistan.', 'C', 'easy', 'published'),
(18, 6, 'What is the national animal of Pakistan?', 'The markhor is Pakistan’s national animal.', 'B', 'easy', 'published');

INSERT IGNORE INTO choices (question_id, label, choice_text) VALUES
(1,'A','She go to school every day.'),(1,'B','She goes to school every day.'),(1,'C','She going to school every day.'),(1,'D','She gone to school every day.'),
(2,'A','Writed'),(2,'B','Wrote'),(2,'C','Written'),(2,'D','Writing'),
(3,'A','a'),(3,'B','an'),(3,'C','the'),(3,'D','no article'),
(4,'A','Courageous'),(4,'B','Careless'),(4,'C','Quiet'),(4,'D','Weak'),
(5,'A','Old'),(5,'B','Historic'),(5,'C','Modern'),(5,'D','Former'),
(6,'A','Very loud'),(6,'B','Short in duration or length'),(6,'C','Difficult to understand'),(6,'D','Full of detail'),
(7,'A','Atlantic Ocean'),(7,'B','Indian Ocean'),(7,'C','Arctic Ocean'),(7,'D','Pacific Ocean'),
(8,'A','Geneva'),(8,'B','New York City'),(8,'C','Paris'),(8,'D','Vienna'),
(9,'A','Five'),(9,'B','Six'),(9,'C','Seven'),(9,'D','Eight'),
(10,'A','CO₂'),(10,'B','H₂O'),(10,'C','O₂'),(10,'D','NaCl'),
(11,'A','Oxygen'),(11,'B','Nitrogen'),(11,'C','Carbon dioxide'),(11,'D','Hydrogen'),
(12,'A','50°C'),(12,'B','75°C'),(12,'C','100°C'),(12,'D','150°C'),
(13,'A','Ravi'),(13,'B','Chenab'),(13,'C','Indus'),(13,'D','Sutlej'),
(14,'A','Nanga Parbat'),(14,'B','K2'),(14,'C','Tirich Mir'),(14,'D','Rakaposhi'),
(15,'A','Punjab'),(15,'B','Sindh'),(15,'C','Khyber Pakhtunkhwa'),(15,'D','Balochistan'),
(16,'A','1940'),(16,'B','1947'),(16,'C','1956'),(16,'D','1971'),
(17,'A','Punjabi'),(17,'B','Sindhi'),(17,'C','Urdu'),(17,'D','English'),
(18,'A','Snow leopard'),(18,'B','Markhor'),(18,'C','Indus dolphin'),(18,'D','Chinkara');

INSERT IGNORE INTO exams (id, name, slug) VALUES
(1, 'PPSC-style', 'ppsc-style'), (2, 'FPSC-style', 'fpsc-style');

INSERT IGNORE INTO papers (id, exam_id, title, slug, year, paper_type, description, status) VALUES
(1, 1, 'General Ability Practice Paper', 'ppsc-general-ability-practice', 2026, 'Practice set', 'A short practice paper built from the sample questions on this site. It is not an official or previous PPSC paper.', 'published'),
(2, 2, 'Federal Recruitment Practice Set', 'federal-recruitment-practice', 2026, 'Practice set', 'A sample practice set for exploring the past-paper experience. It is not an official or previous FPSC paper.', 'published');

INSERT IGNORE INTO paper_questions (paper_id, question_id, question_order) VALUES
(1,1,1),(1,4,2),(1,7,3),(1,13,4),(1,15,5),
(2,5,1),(2,6,2),(2,10,3),(2,16,4),(2,18,5);
