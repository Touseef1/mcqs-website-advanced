const URDU_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function containsUrduScript(value: string): boolean {
  return URDU_SCRIPT_RE.test(value);
}

export function detectQuestionLanguage(values: readonly string[]): "en" | "ur" {
  return values.some(containsUrduScript) ? "ur" : "en";
}
