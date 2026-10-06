import assert from "node:assert/strict";
import test from "node:test";

import { buildDebugReport } from "../src/side-panel/debug-report.ts";

test("buildDebugReport redacts identifiers and excludes conversation text", () => {
  const report = buildDebugReport({
    conversationTitle: "Biology Review",
    conversationId: "12345678-abcdef-secret-tail",
    mode: "side-panel",
    status: "9 turns mapped via conversation-api",
      userAgent: "UnitTest/1.0",
      extensionVersion: "0.1.0-test",
      generatedAt: "2026-05-13T00:00:00.000Z",
      lastMessage: {
        type: "TURNMAP_TURNS_UPDATED",
        site: {
          id: "chatgpt",
          displayName: "ChatGPT"
        },
        conversationId: "12345678-abcdef-secret-tail",
      conversationTitle: "Biology Review",
      turns: [
        {
          id: "turn-1",
          turnIndex: 0,
          userText: "private user text",
          assistantText: "private assistant text",
          extractedAt: 0,
          sourceAnchor: {
            turnIndex: 0,
            userHash: "u",
            assistantHash: "a",
            userPreview: "private user text",
            assistantPreview: "private assistant text"
          }
        }
      ],
      harvestMeta: {
        attempted: true,
        source: "conversation-api",
        scrollContainer: "document",
        scrollHeight: 5000,
        clientHeight: 900,
        scannedSteps: 0,
        diagnostics: {
          selectorBlocks: 2,
          selectorTurns: 1,
          fallbackSelectorCandidates: 0,
          fallbackTextCandidates: 0,
          fallbackBlocks: 0,
          fallbackTurns: 0
        }
      }
    }
  });

  assert.match(report, /ID: 1234\.\.\.t-tail/);
  assert.match(report, /Site: ChatGPT/);
  assert.match(report, /Turns: 1/);
  assert.match(report, /Source: conversation-api/);
  assert.match(report, /Selector blocks: 2/);
  assert.match(report, /Selector turns: 1/);
  assert.doesNotMatch(report, /Deep scan|Reading and Jumping|Scroll speed multiplier/);
  assert.doesNotMatch(report, /private user text/);
  assert.doesNotMatch(report, /private assistant text/);
});

test("buildDebugReport includes sanitized provider failure category only", () => {
  const report = buildDebugReport({
    conversationTitle: "Provider Debug",
    conversationId: "provider-debug-id",
    mode: "side-panel",
    status: "Connection failed",
    userAgent: "UnitTest/1.0",
    extensionVersion: "0.5.0-test",
    generatedAt: "2026-05-20T00:00:00.000Z",
    lastMessage: null,
    taskLog: [
      {
        id: "test-connection-openai",
        kind: "test-connection",
        status: "error",
        progress: 100,
        message: "invalid-api-key provider=openai host=api.openai.com model=gpt-5.4-nano",
        createdAt: "2026-05-20T00:00:00.000Z",
        updatedAt: "2026-05-20T00:00:01.000Z"
      }
    ]
  });

  assert.match(report, /invalid-api-key/);
  assert.match(report, /host=api\.openai\.com/);
  assert.doesNotMatch(report, /sk-/);
  assert.doesNotMatch(report, /chat\/completions/);
});
