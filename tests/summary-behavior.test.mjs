import test from "node:test";
import assert from "node:assert/strict";

import {
  applyProtectedTurnSummary,
  canSummarizeAiNote,
  hasSummarizableTurnField,
  summaryFromTurn,
  titleFromTurn
} from "../src/side-panel/graph/summary-behavior.ts";

const TURN = {
  id: "turn-1",
  turnIndex: 0,
  userText: "Explain deployment options for a Python app running in production with HTTPS and logs.",
  assistantText:
    "Use a process manager, place the app behind a reverse proxy, and centralize logs so restarts and TLS stay manageable.",
  extractedAt: 1,
  sourceAnchor: {
    turnIndex: 0,
    userHash: "user-1",
    assistantHash: "assistant-1",
    userPreview: "Explain deployment options",
    assistantPreview: "Use a process manager"
  }
};

test("applyProtectedTurnSummary only fills fields that are still default", () => {
  const result = applyProtectedTurnSummary(
    {
      title: "Custom deployment title",
      summary: summaryFromTurn(TURN),
      turn: TURN
    },
    {
      title: "Deployment strategy",
      summary: "Keep the app behind a proxy and use managed restarts."
    }
  );

  assert.deepEqual(result.updates, {
    summary: "Keep the app behind a proxy and use managed restarts."
  });
  assert.equal(result.blocked, false);
});

test("applyProtectedTurnSummary blocks manual overwrite when both fields were user-edited", () => {
  const result = applyProtectedTurnSummary(
    {
      title: "Edited title",
      summary: "Edited summary",
      turn: TURN
    },
    {
      title: "Deployment strategy",
      summary: "Keep the app behind a proxy and use managed restarts."
    }
  );

  assert.deepEqual(result.updates, {});
  assert.equal(result.blocked, true);
  assert.equal(hasSummarizableTurnField({ title: "Edited title", summary: "Edited summary", turn: TURN }), false);
});

test("canSummarizeAiNote requires #AI semantics and at least one source anchor", () => {
  assert.equal(
    canSummarizeAiNote({
      isCustomNode: true,
      tags: ["#AI"],
      sourceAnchors: [TURN.sourceAnchor]
    }),
    true
  );
  assert.equal(
    canSummarizeAiNote({
      isCustomNode: true,
      tags: ["note"],
      sourceAnchors: [TURN.sourceAnchor]
    }),
    false
  );
  assert.equal(
    canSummarizeAiNote({
      isCustomNode: true,
      tags: ["AI"],
      sourceAnchors: []
    }),
    false
  );
});

test("titleFromTurn still produces the default title baseline for overwrite checks", () => {
  assert.match(titleFromTurn(TURN), /^Explain deployment options/);
});
