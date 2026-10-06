import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonObject, tryExtractJsonObject } from "../src/side-panel/ai/json-output.ts";

test("extractJsonObject parses fenced JSON", () => {
  assert.deepEqual(extractJsonObject('```json\n{"title":"T","summary":"S"}\n```'), {
    title: "T",
    summary: "S"
  });
});

test("extractJsonObject can recover labeled English summary text", () => {
  assert.deepEqual(
    extractJsonObject("Title: Cell respiration overview\nSummary: Explains glycolysis and ATP yield.", {
      looseStringFields: ["title", "summary"]
    }),
    {
      title: "Cell respiration overview",
      summary: "Explains glycolysis and ATP yield."
    }
  );
});

test("extractJsonObject can recover labeled Chinese summary text", () => {
  assert.deepEqual(
    extractJsonObject("标题：细胞呼吸总览\n摘要：解释糖酵解和 ATP 产量。", {
      looseStringFields: ["title", "summary"]
    }),
    {
      title: "细胞呼吸总览",
      summary: "解释糖酵解和 ATP 产量。"
    }
  );
});

test("tryExtractJsonObject returns null for plain prose", () => {
  assert.equal(tryExtractJsonObject("I found no strong links worth adding."), null);
});
