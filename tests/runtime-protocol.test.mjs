import assert from "node:assert/strict";
import test from "node:test";

import { isTurnMapMessage } from "../src/shared/messaging.ts";

test("runtime protocol rejects unknown TURNMAP-prefixed messages", () => {
  assert.equal(isTurnMapMessage({ type: "TURNMAP_DELETE_EVERYTHING" }), false);
});

test("runtime protocol rejects known messages with missing required payload", () => {
  assert.equal(isTurnMapMessage({ type: "TURNMAP_SET_FLOATING_PANEL" }), false);
  assert.equal(isTurnMapMessage({ type: "TURNMAP_FETCH_CONVERSATION_API" }), false);
  assert.equal(isTurnMapMessage({ type: "TURNMAP_VALIDATE_CUSTOM_SITE" }), false);
});

test("runtime protocol accepts payload-free commands", () => {
  assert.equal(isTurnMapMessage({ type: "TURNMAP_SYNC_LAUNCHER" }), true);
  assert.equal(isTurnMapMessage({ type: "TURNMAP_OPEN_SIDE_PANEL" }), true);
  assert.equal(isTurnMapMessage({ type: "TURNMAP_OPEN_SETTINGS" }), true);
});

test("runtime protocol accepts commands with valid top-level payload", () => {
  assert.equal(isTurnMapMessage({ type: "TURNMAP_SET_FLOATING_PANEL", enabled: false }), true);
  assert.equal(
    isTurnMapMessage({ type: "TURNMAP_FETCH_CONVERSATION_API", conversationId: "conversation-1" }),
    true
  );
  assert.equal(isTurnMapMessage({ type: "TURNMAP_REQUEST_TURNS", harvest: true }), true);
});
