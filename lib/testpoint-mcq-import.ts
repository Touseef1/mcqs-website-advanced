export type ExternalMcq = {
  sourceId: string;
  sourceUrl: string;
  prompt: string;
  choices: [string, string, string, string];
  correctChoice: "A" | "B" | "C" | "D";
  explanation: string;
};

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
  return Math.max(1, Math.min(80, ...[Math.max(1, ...pageNumbers)]));
}

export function parseTestPointQuestions(html: string): ExternalMcq[] {
  const headings = [...html.matchAll(/<h5\b[^>]*>[\s\S]*?<\/h5>/gi)];
  const results: ExternalMcq[] = [];

  for (const [index, headingMatch] of headings.entries()) {
    const heading = headingMatch[0];
    const link = heading.match(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
    if (!link || !/\/mcqs\/\d+\//.test(link[2])) continue;

    const blockStart = (headingMatch.index ?? 0) + heading.length;
    const blockEnd = headings[index + 1]?.index ?? html.length;
    const block = html.slice(blockStart, blockEnd);
    const optionsList = block.match(/<ol\b[^>]*>([\s\S]*?)<\/ol>/i)?.[1];
    if (!optionsList) continue;

    const optionMatches = [...optionsList.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)];
    if (optionMatches.length !== 4) continue;
    const choices = optionMatches.map((option) => htmlToText(option[2])) as [string, string, string, string];
    const correctIndex = optionMatches.findIndex((option) => /(?:^|\s)correct(?:\s|$)/i.test(option[1]));
    const prompt = htmlToText(link[3]);
    if (!prompt || choices.some((choice) => !choice) || correctIndex < 0) continue;

    const explanationHtml = block.match(/<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bquestion-explanation\b[^"']*\1)[^>]*>([\s\S]*?)<\/div>/i)?.[2] ?? "";
    const explanation = htmlToText(explanationHtml.replace(/<h6\b[^>]*>\s*Explanation\s*<\/h6>/i, "").replace(/Last verified on[^<\n]*/gi, ""), true);
    const sourceUrl = new URL(link[2], "https://testpointpk.com");
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
