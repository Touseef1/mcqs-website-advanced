const ALLOWED_RICH_TEXT_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li"]);

/** Keep only the small formatting vocabulary supported by the explanation editor. */
export function sanitizeRichText(value: string): string {
  const withoutActiveContent = value.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  return withoutActiveContent.replace(/<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, closing: string, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED_RICH_TEXT_TAGS.has(name)) return "";
    if (name === "br") return "<br>";
    return `<${closing ? "/" : ""}${name}>`;
  });
}

export function decodeRichTextEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&#x27;": "'", "&nbsp;": "\u00a0" };
    const lower = entity.toLowerCase();
    if (named[lower] !== undefined) return named[lower];
    const numeric = lower.match(/^&#(?:x([\da-f]+)|(\d+));$/);
    if (!numeric) return entity;
    const codePoint = Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10);
    return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
  });
}

export function richTextToPlainText(value: string): string {
  return decodeRichTextEntities(sanitizeRichText(value)
    .replace(/<br>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, ""))
    .replace(/\u00a0/g, " ")
    .trim();
}
