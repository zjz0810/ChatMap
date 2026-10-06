import test from "node:test";
import assert from "node:assert/strict";

import { summarizeTurns } from "../src/side-panel/ai/node-summary.ts";

function withChromeStorage() {
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === "turnmap.aiSettings" || (Array.isArray(keys) && keys.includes("turnmap.aiSettings"))) {
            return {
              "turnmap.aiSettings": {
                provider: "custom",
                baseUrl: "https://api.example.test/v1",
                model: "summary-fast",
                apiKey: "test-key",
                maxTokens: 6000,
                autoSummarize: false
              }
            };
          }
          return {};
        }
      }
    },
    permissions: {
      contains: async () => true,
      request: async () => true
    }
  };
}

test("summarizeTurns builds a multi-source summary prompt from source turns", async () => {
  withChromeStorage();
  let prompt = "";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    prompt = body.messages[1].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"title\":\"Release note\",\"summary\":\"Explain the deployment and release guidance.\"}" } }] }), {
      status: 200
    });
  };

  const result = await summarizeTurns([
    {
      id: "turn-1",
      turnIndex: 0,
      userText: "How should I phrase the release note?",
      assistantText: "Keep it short and specific.",
      extractedAt: 1,
      sourceAnchor: {
        turnIndex: 0,
        userHash: "u1",
        assistantHash: "a1",
        userPreview: "How should I phrase",
        assistantPreview: "Keep it short"
      }
    },
    {
      id: "turn-2",
      turnIndex: 1,
      userText: "What deployment warning should we keep?",
      assistantText: "Mention HTTPS, rollback, and log visibility.",
      extractedAt: 2,
      sourceAnchor: {
        turnIndex: 1,
        userHash: "u2",
        assistantHash: "a2",
        userPreview: "What deployment warning",
        assistantPreview: "Mention HTTPS"
      }
    }
  ]);

  assert.match(prompt, /Source turn 1/i);
  assert.match(prompt, /Source turn 2/i);
  assert.match(prompt, /How should I phrase the release note\?/);
  assert.match(prompt, /Mention HTTPS, rollback, and log visibility\./);
  assert.equal(result.title, "Release note");
});

test("summarizeTurns keeps enough assistant text and output budget for long answers", async () => {
  withChromeStorage();
  let prompt = "";
  let maxTokens = 0;
  const longAnswer = `${"A".repeat(11950)}LONG_ANSWER_TAIL${"B".repeat(300)}`;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    prompt = body.messages[1].content;
    maxTokens = body.max_tokens;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"title\":\"Long answer\",\"summary\":\"Summarizes the long answer.\"}" } }] }), {
      status: 200
    });
  };

  await summarizeTurns([
    {
      id: "turn-long",
      turnIndex: 0,
      userText: "Summarize this long answer.",
      assistantText: longAnswer,
      extractedAt: 1,
      sourceAnchor: {
        turnIndex: 0,
        userHash: "u-long",
        assistantHash: "a-long",
        userPreview: "Summarize this",
        assistantPreview: "AAAA"
      }
    }
  ]);

  assert.match(prompt, /LONG_ANSWER_TAIL/);
  assert.equal(maxTokens, 6000);
});
