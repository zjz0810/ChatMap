import test from "node:test";
import assert from "node:assert/strict";

import {
  hasAiTag,
  mergeSourceAnchors,
  resolveSourceTurnsForAnchors
} from "../src/side-panel/graph/source-anchors.ts";

const HASH_ONLY_ANCHOR = {
  turnIndex: 9,
  userHash: "user-hash",
  assistantHash: "assistant-hash",
  userPreview: "How do I deploy this?",
  assistantPreview: "Use a process manager and reverse proxy.",
  userAttachmentNames: ["Deploy.md"]
};

const RICH_ANCHOR = {
  ...HASH_ONLY_ANCHOR,
  turnIndex: 2,
  userMessageId: "u-2",
  assistantMessageId: "a-2"
};

test("mergeSourceAnchors deduplicates the same source and keeps the richer anchor", () => {
  const merged = mergeSourceAnchors([HASH_ONLY_ANCHOR], [RICH_ANCHOR]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].turnIndex, 2);
  assert.equal(merged[0].userMessageId, "u-2");
  assert.equal(merged[0].assistantMessageId, "a-2");
});

test("resolveSourceTurnsForAnchors matches turns even when stored turnIndex is stale", () => {
  const turns = [
    {
      id: "turn-2",
      turnIndex: 1,
      userText: "How do I deploy this?",
      assistantText: "Use a process manager and reverse proxy.",
      extractedAt: 1,
      sourceAnchor: RICH_ANCHOR
    }
  ];

  const resolved = resolveSourceTurnsForAnchors(turns, [{ ...RICH_ANCHOR, turnIndex: 77 }]);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, "turn-2");
});

test("hasAiTag accepts AI and #AI variants without false positives", () => {
  assert.equal(hasAiTag(["note", "AI"]), true);
  assert.equal(hasAiTag(["note", "#AI"]), true);
  assert.equal(hasAiTag(["note", " ai "]), true);
  assert.equal(hasAiTag(["aid", "topic"]), false);
});
