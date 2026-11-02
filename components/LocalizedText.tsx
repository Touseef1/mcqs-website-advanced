import type { ReactNode } from "react";
import { containsUrduScript } from "@/lib/language";

const URDU_RUN_RE = /([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)/g;
const URDU_RUN_TEST_RE = /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+$/;

/** Keeps Latin text in the site's normal font and marks only Urdu-script runs as Nastaliq. */
export function LocalizedText({ children, className }: { children: ReactNode; className?: string }) {
  if (typeof children !== "string") return <>{children}</>;

  const parts = children.split(URDU_RUN_RE);
  const hasUrdu = containsUrduScript(children);
  const classes = ["localized-text", hasUrdu && "localized-text-with-urdu", className].filter(Boolean).join(" ");

  return (
    <span className={classes} dir={hasUrdu ? "rtl" : "ltr"}>
      {parts.map((part, index) => URDU_RUN_TEST_RE.test(part)
        ? <span className="urdu-text" lang="ur" dir="rtl" key={index}>{part}</span>
        : part)}
    </span>
  );
}
