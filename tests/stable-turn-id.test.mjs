import assert from "node:assert/strict";
import test from "node:test";

import { stableTurnId, stableTurnIdAssigner } from "../src/shared/turn-id.ts";

const BASE_ANCHOR = {
  turnIndex: 7,
  userHash: "user-hash",
  assistantHash: "assistant-hash",
  userPreview: "User",
  assistantPreview: "Assistant"
};

test("stableTurnId prefers assistant message id and ignores turn index", () => {
  const first = stableTurnId({ ...BASE_ANCHOR, turnIndex: 1, assistantMessageId: "assistant-123" });
  const second = stableTurnId({ ...BASE_ANCHOR, turnIndex: 9, assistantMessageId: "assistant-123" });

  assert.equal(first, "turn-aid-assistant-123");
  assert.equal(second, first);
  assert.doesNotMatch(first, /turn-1-|turn-9-/);
});

test("stableTurnId falls back to user id plus assistant hash", () => {
  const id = stableTurnId({ ...BASE_ANCHOR, userMessageId: "user-abc", assistantHash: "reply-hash" });

  assert.equal(id, "turn-uid-user-abc-reply-hash");
  assert.doesNotMatch(id, /turn-7-/);
});

test("stableTurnId falls back to content hashes without turn index", () => {
  const id = stableTurnId(BASE_ANCHOR);

  assert.equal(id, "turn-hash-user-hash-assistant-hash");
  assert.doesNotMatch(id, /turn-7-/);
});

test("stableTurnIdAssigner adds deterministic suffixes for same-pass collisions", () => {
  const assign = stableTurnIdAssigner();

  assert.equal(assign(BASE_ANCHOR), "turn-hash-user-hash-assistant-hash");
  assert.equal(assign({ ...BASE_ANCHOR, turnIndex: 8 }), "turn-hash-user-hash-assistant-hash-2");
  assert.equal(assign({ ...BASE_ANCHOR, turnIndex: 9 }), "turn-hash-user-hash-assistant-hash-3");
});
