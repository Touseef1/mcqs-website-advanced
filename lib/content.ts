export type Choice = { label: string; text: string; imageUrl?: string | null };

export type Question = {
  id: number;
  topicSlug: string;
  prompt: string;
  questionImageUrl?: string | null;
  choices: Choice[];
  correctChoice: string;
  explanation: string;
  sourceNote: string;
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
  type: "Past paper" | "Model paper" | "Mock test";
  description: string;
  topicSlugs: string[];
};

// Empty content fallbacks prevent example questions from being presented as real exam material.
export const demoSubjects: Subject[] = [
  {
    id: 1, slug: "english", name: "English", description: "English exam questions organised by topic.", icon: "Aa",
    topics: [
      { id: 1, slug: "english-grammar", name: "Grammar", description: "English grammar questions.", questionCount: 0 },
      { id: 2, slug: "english-vocabulary", name: "Vocabulary", description: "English vocabulary questions.", questionCount: 0 },
    ],
  },
  {
    id: 2, slug: "general-knowledge", name: "General Knowledge", description: "General knowledge questions organised by topic.", icon: "◎",
    topics: [
      { id: 3, slug: "general-knowledge", name: "World General Knowledge", description: "World general knowledge questions.", questionCount: 0 },
      { id: 4, slug: "everyday-science", name: "Everyday Science", description: "Everyday science questions.", questionCount: 0 },
    ],
  },
  {
    id: 3, slug: "pakistan-studies", name: "Pakistan Studies", description: "Pakistan Studies questions organised by topic.", icon: "PK",
    topics: [
      { id: 5, slug: "pakistan-geography", name: "Geography of Pakistan", description: "Geography questions about Pakistan.", questionCount: 0 },
      { id: 6, slug: "pakistan-history", name: "History & National Identity", description: "History and national identity questions.", questionCount: 0 },
    ],
  },
];

export const demoQuestions: Question[] = [];
export const demoPapers: Paper[] = [];
export const allDemoTopics = demoSubjects.flatMap((subject) => subject.topics);
export const allDemoQuestions = demoQuestions;
export const getDemoSubject = (slug: string) => demoSubjects.find((subject) => subject.slug === slug);
export const getDemoTopic = (slug: string) => allDemoTopics.find((topic) => topic.slug === slug);
export const getDemoPaper = (slug: string) => demoPapers.find((paper) => paper.slug === slug);
export const getDemoQuestionsForTopic = (slug: string) => demoQuestions.filter((question) => question.topicSlug === slug);
