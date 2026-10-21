import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SubjectCard } from "@/components/SubjectCard";
import { getSubjects } from "@/lib/data";

export const metadata: Metadata = {
  title: "MCQ Subjects for Exam Preparation",
  description: "Browse free English, General Knowledge, Pakistan Studies, and other subject MCQs with clear explanations.",
};

export default async function SubjectsPage() {
  const subjects = await getSubjects();
  return (
    <main className="content-page">
      <Breadcrumbs items={[{ label: "Subjects" }]} />
      <div className="page-intro"><span className="eyebrow">BROWSE & PRACTISE</span><h1>Choose your subject</h1><p>Build a strong foundation with focused topics, practice questions, and explanations.</p></div>
      <div className="subject-grid subject-grid-page">{subjects.map((subject) => <SubjectCard subject={subject} key={subject.slug} />)}</div>
    </main>
  );
}
