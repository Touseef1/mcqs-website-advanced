import test from "node:test";
import assert from "node:assert/strict";
import { containsUrduScript, detectQuestionLanguage } from "../lib/language.ts";

test("detects Urdu text without a manually selected question language", () => {
  assert.equal(containsUrduScript("What is the answer?"), false);
  assert.equal(containsUrduScript("درست جواب کیا ہے؟"), true);
  assert.equal(detectQuestionLanguage(["What is the answer?", "A", "B"]), "en");
  assert.equal(detectQuestionLanguage(["What is the answer?", "درست جواب", "B"]), "ur");
});
