export type Choice = { label: string; text: string };

export type Question = {
  id: number;
  topicSlug: string;
  prompt: string;
  choices: Choice[];
  correctChoice: string;
  explanation: string;
};

export type Topic = {
  id: number;
  slug: string;
  name: string;
  description: string;
  questionCount: number;
};

export type Subject = {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  topics: Topic[];
};

export type Paper = {
  id: number;
  slug: string;
  title: string;
  exam: string;
  year: number;
  type: "Practice set" | "Past paper";
  description: string;
  topicSlugs: string[];
};

const choiceSet = (a: string, b: string, c: string, d: string): Choice[] => [
  { label: "A", text: a },
  { label: "B", text: b },
  { label: "C", text: c },
  { label: "D", text: d },
];

export const demoSubjects: Subject[] = [
  {
    id: 1,
    slug: "english",
    name: "English",
    description: "Build confidence in grammar, vocabulary, and sentence usage.",
    icon: "Aa",
    topics: [
      { id: 1, slug: "english-grammar", name: "Grammar", description: "Parts of speech, tenses, and correct sentence structure.", questionCount: 3 },
      { id: 2, slug: "english-vocabulary", name: "Vocabulary", description: "Synonyms, antonyms, and commonly tested words.", questionCount: 3 },
    ],
  },
  {
    id: 2,
    slug: "general-knowledge",
    name: "General Knowledge",
    description: "Practise important world facts and everyday science concepts.",
    icon: "◎",
    topics: [
      { id: 3, slug: "general-knowledge", name: "World General Knowledge", description: "Countries, organisations, geography, and world facts.", questionCount: 3 },
      { id: 4, slug: "everyday-science", name: "Everyday Science", description: "Basic science questions used in general recruitment tests.", questionCount: 3 },
    ],
  },
  {
    id: 3,
    slug: "pakistan-studies",
    name: "Pakistan Studies",
    description: "Review Pakistan’s geography, history, and national symbols.",
    icon: "PK",
    topics: [
      { id: 5, slug: "pakistan-geography", name: "Geography of Pakistan", description: "Rivers, provinces, mountains, and national landmarks.", questionCount: 3 },
      { id: 6, slug: "pakistan-history", name: "History & National Identity", description: "Key facts about Pakistan and its national identity.", questionCount: 3 },
    ],
  },
];

export const demoQuestions: Question[] = [
  { id: 1, topicSlug: "english-grammar", prompt: "Choose the grammatically correct sentence.", choices: choiceSet("She go to school every day.", "She goes to school every day.", "She going to school every day.", "She gone to school every day."), correctChoice: "B", explanation: "With the singular subject “she” in the simple present, the verb takes -s: “goes.”" },
  { id: 2, topicSlug: "english-grammar", prompt: "What is the past tense of “write”?", choices: choiceSet("Writed", "Wrote", "Written", "Writing"), correctChoice: "B", explanation: "“Wrote” is the simple past form. “Written” is the past participle, as in “has written.”" },
  { id: 3, topicSlug: "english-grammar", prompt: "Choose the correct article: “He is ___ honest officer.”", choices: choiceSet("a", "an", "the", "no article"), correctChoice: "B", explanation: "“Honest” begins with a vowel sound because the “h” is silent, so we use “an.”" },
  { id: 4, topicSlug: "english-vocabulary", prompt: "Choose the closest synonym of “brave.”", choices: choiceSet("Courageous", "Careless", "Quiet", "Weak"), correctChoice: "A", explanation: "“Courageous” means showing courage, so it is closest in meaning to “brave.”" },
  { id: 5, topicSlug: "english-vocabulary", prompt: "Choose the opposite of “ancient.”", choices: choiceSet("Old", "Historic", "Modern", "Former"), correctChoice: "C", explanation: "“Modern” means relating to the present or recent times; it is the opposite of “ancient.”" },
  { id: 6, topicSlug: "english-vocabulary", prompt: "What does “brief” mean?", choices: choiceSet("Very loud", "Short in duration or length", "Difficult to understand", "Full of detail"), correctChoice: "B", explanation: "“Brief” means short in time or length." },
  { id: 7, topicSlug: "general-knowledge", prompt: "Which is the largest ocean on Earth?", choices: choiceSet("Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"), correctChoice: "D", explanation: "The Pacific Ocean is the largest ocean on Earth." },
  { id: 8, topicSlug: "general-knowledge", prompt: "Where is the headquarters of the United Nations?", choices: choiceSet("Geneva", "New York City", "Paris", "Vienna"), correctChoice: "B", explanation: "The United Nations headquarters is in New York City, United States." },
  { id: 9, topicSlug: "general-knowledge", prompt: "How many continents are commonly recognised?", choices: choiceSet("Five", "Six", "Seven", "Eight"), correctChoice: "C", explanation: "The commonly taught model recognises seven continents." },
  { id: 10, topicSlug: "everyday-science", prompt: "What is the chemical formula for water?", choices: choiceSet("CO₂", "H₂O", "O₂", "NaCl"), correctChoice: "B", explanation: "A water molecule contains two hydrogen atoms and one oxygen atom: H₂O." },
  { id: 11, topicSlug: "everyday-science", prompt: "Which gas do plants absorb from the atmosphere during photosynthesis?", choices: choiceSet("Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"), correctChoice: "C", explanation: "Plants use carbon dioxide, water, and light energy to make sugars during photosynthesis." },
  { id: 12, topicSlug: "everyday-science", prompt: "At standard atmospheric pressure, water boils at approximately:", choices: choiceSet("50°C", "75°C", "100°C", "150°C"), correctChoice: "C", explanation: "At standard atmospheric pressure, water boils at 100°C." },
  { id: 13, topicSlug: "pakistan-geography", prompt: "Which is the longest river in Pakistan?", choices: choiceSet("Ravi", "Chenab", "Indus", "Sutlej"), correctChoice: "C", explanation: "The Indus is Pakistan’s longest river and the country’s major river system." },
  { id: 14, topicSlug: "pakistan-geography", prompt: "Which is the highest mountain in Pakistan?", choices: choiceSet("Nanga Parbat", "K2", "Tirich Mir", "Rakaposhi"), correctChoice: "B", explanation: "K2, in the Karakoram range, is the highest mountain in Pakistan." },
  { id: 15, topicSlug: "pakistan-geography", prompt: "Which province is the largest by area?", choices: choiceSet("Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan"), correctChoice: "D", explanation: "Balochistan is Pakistan’s largest province by area." },
  { id: 16, topicSlug: "pakistan-history", prompt: "Pakistan became independent in which year?", choices: choiceSet("1940", "1947", "1956", "1971"), correctChoice: "B", explanation: "Pakistan became independent on 14 August 1947." },
  { id: 17, topicSlug: "pakistan-history", prompt: "What is the national language of Pakistan?", choices: choiceSet("Punjabi", "Sindhi", "Urdu", "English"), correctChoice: "C", explanation: "Urdu is the national language of Pakistan." },
  { id: 18, topicSlug: "pakistan-history", prompt: "What is the national animal of Pakistan?", choices: choiceSet("Snow leopard", "Markhor", "Indus dolphin", "Chinkara"), correctChoice: "B", explanation: "The markhor is Pakistan’s national animal." },
];

export const demoPapers: Paper[] = [
  { id: 1, slug: "ppsc-general-ability-practice", title: "General Ability Practice Paper", exam: "PPSC-style", year: 2026, type: "Practice set", description: "A short practice paper built from the sample questions on this site. It is not an official or previous PPSC paper.", topicSlugs: ["english-grammar", "general-knowledge", "pakistan-geography"] },
  { id: 2, slug: "federal-recruitment-practice", title: "Federal Recruitment Practice Set", exam: "FPSC-style", year: 2026, type: "Practice set", description: "A sample practice set for exploring the past-paper experience. It is not an official or previous FPSC paper.", topicSlugs: ["english-vocabulary", "everyday-science", "pakistan-history"] },
];

export const allDemoTopics = demoSubjects.flatMap((subject) => subject.topics);
export const allDemoQuestions = demoQuestions;
export const getDemoSubject = (slug: string) => demoSubjects.find((subject) => subject.slug === slug);
export const getDemoTopic = (slug: string) => allDemoTopics.find((topic) => topic.slug === slug);
export const getDemoPaper = (slug: string) => demoPapers.find((paper) => paper.slug === slug);
export const getDemoQuestionsForTopic = (slug: string) => demoQuestions.filter((question) => question.topicSlug === slug);
