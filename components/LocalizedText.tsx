import type { ReactNode } from "react";
import { containsUrduScript } from "@/lib/language";

const URDU_RUN_RE = /([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)/g;
const URDU_RUN_TEST_RE = /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+$/;

function renderLocalizedRuns(value: string) {
  return value.split(URDU_RUN_RE).map((part, index) => URDU_RUN_TEST_RE.test(part)
    ? <span className="urdu-text" lang="ur" dir="rtl" key={index}>{part}</span>
    : part);
}

function splitBilingualStatement(value: string): Array<{ text: string; language: "en" | "ur" }> | null {
  const separator = /\s+\/\s+/g;
  for (const match of value.matchAll(separator)) {
    const index = match.index ?? 0;
    const left = value.slice(0, index).trim();
    const right = value.slice(index + match[0].length).trim();
    const leftIsEnglish = /[A-Za-z]/.test(left) && !containsUrduScript(left);
    const rightIsEnglish = /[A-Za-z]/.test(right) && !containsUrduScript(right);
    const leftIsUrdu = containsUrduScript(left);
    const rightIsUrdu = containsUrduScript(right);

    if (leftIsEnglish && rightIsUrdu) return [{ text: left, language: "en" }, { text: right, language: "ur" }];
    if (leftIsUrdu && rightIsEnglish) return [{ text: left, language: "ur" }, { text: right, language: "en" }];
  }
  return null;
}

/** Keeps Latin text in the site's normal font and marks only Urdu-script runs as Nastaliq. */
export function LocalizedText({ children, className }: { children: ReactNode; className?: string }) {
  if (typeof children !== "string") return <>{children}</>;

  const bilingualParts = splitBilingualStatement(children);
  if (bilingualParts) {
    return (
      <span className={["localized-text", "localized-text-bilingual", className].filter(Boolean).join(" ")}>
        {bilingualParts.map((part, index) => (
          <span className={`localized-text-segment localized-text-segment-${part.language}`} lang={part.language} dir={part.language === "ur" ? "rtl" : "ltr"} key={index}>
            {renderLocalizedRuns(part.text)}
          </span>
        ))}
      </span>
    );
  }

  const hasUrdu = containsUrduScript(children);
  const classes = ["localized-text", hasUrdu && "localized-text-with-urdu", className].filter(Boolean).join(" ");
  return (
    <span className={classes} dir={hasUrdu ? "rtl" : "ltr"}>
      {renderLocalizedRuns(children)}
    </span>
  );
}
