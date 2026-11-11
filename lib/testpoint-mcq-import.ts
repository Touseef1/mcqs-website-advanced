export type ExternalMcq = {
  sourceId: string;
  sourceUrl: string;
  prompt: string;
  choices: [string, string, string, string];
  correctChoice: "A" | "B" | "C" | "D";
  explanation: string;
};

export type TestPointTaxonomy = {
  subjects: Array<{ name: string; slug: string; url: string }>;
  subject?: { name: string; slug: string };
  topics: Array<{ name: string; slug: string; url?: string; subjectSlug?: string }>;
};

const TESTPOINT_ORIGIN = "https://testpointpk.com";

function isSupportedListingPath(pathname: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const normalized = decoded.replace(/\/+$/, "") || "/";
  if (normalized.toLowerCase() === "/all-mcqs-categories") return true;
  const match = normalized.match(/^\/(important-mcqs|subcategory-mcqs)\/([^/]+)$/i);
  return Boolean(match && match[2].length <= 180 && /^[\p{L}\p{N}&-]+$/u.test(match[2]));
}

function decodedPath(pathname: string) {
  try { return decodeURIComponent(pathname); } catch { return ""; }
}

/** Accept only public TestPoint taxonomy and MCQ listing pages (prevents SSRF). */
export function parseTestPointListingUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 800) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "testpointpk.com" || url.port || url.username || url.password) return null;
    if (!isSupportedListingPath(url.pathname)) return null;
    for (const key of url.searchParams.keys()) if (key !== "page") return null;
    const page = Number(url.searchParams.get("page") ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 80) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function slugFromUrl(path: string) {
  return (decodedPath(path).split("/").filter(Boolean).at(-1) ?? "");
}

export function parseTestPointTaxonomy(html: string, source: URL): TestPointTaxonomy {
  const subjects = new Map<string, { name: string; slug: string; url: string }>();
  const topics = new Map<string, { name: string; slug: string; url: string }>();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    let link: URL;
    try { link = new URL(decodeHtml(match[2]), TESTPOINT_ORIGIN); } catch { continue; }
    if (link.hostname !== "testpointpk.com" || link.protocol !== "https:") continue;
    const name = htmlToText(match[3]);
    if (name.length < 2 || name.length > 160) continue;
    const item = { name, slug: slugFromUrl(link.pathname), url: `${TESTPOINT_ORIGIN}${link.pathname}` };
    const path = decodedPath(link.pathname);
    if (isSupportedListingPath(link.pathname) && /^\/important-mcqs\//i.test(path)) subjects.set(item.slug, item);
    if (isSupportedListingPath(link.pathname) && /^\/subcategory-mcqs\//i.test(path)) topics.set(item.slug, item);
  }

  const slug = slugFromUrl(source.pathname);
  if (/^\/important-mcqs\//i.test(decodedPath(source.pathname))) {
    const heading = html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
    const name = (heading ? htmlToText(heading) : slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())).replace(/\s+mcqs?$/i, "").trim();
    return { subjects: [], subject: { name, slug }, topics: [...topics.values()] };
  }
  return { subjects: [...subjects.values()], topics: [] };
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", nbsp: " ", quot: '"', lt: "<", gt: ">",
    rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", bull: "•",
  };
  return value
    .replace(/&#(\d+);?/g, (_match, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([\da-f]+);?/gi, (_match, digits: string) => String.fromCodePoint(parseInt(digits, 16)))
    .replace(/&([a-z]+);/gi, (match, key: string) => named[key.toLowerCase()] ?? match)
    .replace(/\u00a0/g, " ");
}

function htmlToText(value: string, preserveParagraphs = false) {
  const lineBreaks = value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n");
  const text = decodeHtml(lineBreaks.replace(/<[^>]*>/g, " "));
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[\t ]+/g, " ").trim()).filter(Boolean);
  return (preserveParagraphs ? lines.join("\n") : lines.join(" ")).trim();
}

export function getTestPointTotalPages(html: string) {
  const pageNumbers = [...html.matchAll(/(?:\?|&)page=(\d+)/g)].map((match) => Number(match[1]));
  return Math.max(1, Math.min(80, Math.max(1, ...pageNumbers)));
}

export function parseTestPointQuestions(html: string): ExternalMcq[] {
  // TestPoint uses h5-wrapped question links on some subcategory pages, but
  // subject pages such as Maths put the same links directly inside a div.
  // Parse question links themselves and use the next question link as a boundary.
  const pageHtml = html.replace(/<!--[\s\S]*?-->/g, "");
  const questionLinks = [...pageHtml.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((match) => /\/mcqs\/\d+\//i.test(decodeHtml(match[2])) && !/#comment-form/i.test(match[2]));
  const results: ExternalMcq[] = [];

  for (const [index, link] of questionLinks.entries()) {
    const blockStart = (link.index ?? 0) + link[0].length;
    const blockEnd = questionLinks[index + 1]?.index ?? pageHtml.length;
    const block = pageHtml.slice(blockStart, blockEnd);
    const optionsList = block.match(/<ol\b[^>]*>([\s\S]*?)<\/ol>/i)?.[1];
    if (!optionsList) continue;

    const optionMatches = [...optionsList.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)];
    if (optionMatches.length !== 4) continue;
    const choices = optionMatches.map((option) => htmlToText(option[2])) as [string, string, string, string];
    const correctIndex = optionMatches.findIndex((option) => /\bcorrect\b/i.test(option[1]));
    const optionsStart = block.search(/<ol\b/i);
    const secondaryPrompts = [...block.slice(0, optionsStart).matchAll(/<h[56]\b[^>]*>([\s\S]*?)<\/h[56]>/gi)]
      .map((match) => htmlToText(match[1]))
      .filter((text) => text && !/^explanation$/i.test(text));
    const prompt = [htmlToText(link[3]), ...secondaryPrompts].filter(Boolean).join(" / ");
    if (!prompt || choices.some((choice) => !choice) || correctIndex < 0) continue;

    const explanationHtml = block.match(/<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bquestion-explanation\b[^"']*\1)[^>]*>([\s\S]*?)<\/div>/i)?.[2] ?? "";
    const explanation = htmlToText(explanationHtml
      .replace(/<h6\b[^>]*>\s*Explanation\s*<\/h6>/i, "")
      .replace(/Last\s+(?:verified|updated|update)\s+[^<\n]*/gi, ""), true);
    const sourceUrl = new URL(decodeHtml(link[2]), TESTPOINT_ORIGIN);
    if (sourceUrl.hostname !== "testpointpk.com") continue;
    results.push({
      sourceId: sourceUrl.pathname.split("/").filter(Boolean)[1] ?? sourceUrl.pathname,
      sourceUrl: sourceUrl.toString(),
      prompt,
      choices,
      correctChoice: ["A", "B", "C", "D"][correctIndex] as ExternalMcq["correctChoice"],
      explanation,
    });
  }

  return results;
}
