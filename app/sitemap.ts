import type { MetadataRoute } from "next";
import { getPapers, getSubjects, getTopics } from "@/lib/data";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [subjects, topics, papers] = await Promise.all([getSubjects(), getTopics(), getPapers()]);
  const staticUrls = [
    { url: baseUrl, changeFrequency: "weekly" as const, priority: 1 },
    { url: baseUrl + "/subjects", changeFrequency: "weekly" as const, priority: 0.8 },
    { url: baseUrl + "/past-papers", changeFrequency: "weekly" as const, priority: 0.8 },
  ];
  return [
    ...staticUrls,
    ...subjects.map((subject) => ({ url: baseUrl + "/subjects/" + subject.slug, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...topics.map((topic) => ({ url: baseUrl + "/topics/" + topic.slug, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...papers.map((paper) => ({ url: baseUrl + "/past-papers/" + paper.slug, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
