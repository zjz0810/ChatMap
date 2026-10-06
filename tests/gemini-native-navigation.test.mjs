import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hashText } from "../src/shared/hash.ts";

function historyTurn({
  conversationId = "c_conversation-a",
  requestId,
  responseId,
  userText,
  assistantText,
  timestamp = 1_750_000_000
}) {
  return [
    [conversationId, requestId],
    [conversationId, requestId, responseId],
    [[userText], 2, null, 1],
    [[[responseId, [assistantText]]]],
    [timestamp, 0]
  ];
}

function batchExecuteBody(turns) {
  const payload = [null, turns];
  const frame = [["wrb.fr", "hNvQHb", JSON.stringify(payload), null, null, null, "generic"]];
  const encoded = JSON.stringify(frame);
  return `)]}'\n${encoded.length}\n${encoded}\n`;
}

function mountedTurn(index, userText, assistantText = "No text response") {
  return {
    id: `mounted-${index}`,
    turnIndex: index,
    userText,
    assistantText,
    extractedAt: 1,
    sourceAnchor: {
      turnIndex: index,
      userMessageId: `user-${index}-${hashText(userText)}`,
      assistantMessageId: `assistant-${index}-${hashText(assistantText)}`,
      userHash: hashText(userText),
      assistantHash: hashText(assistantText),
      userPreview: userText,
      assistantPreview: assistantText
    }
  };
}

test("Gemini hNvQHb parsing yields a complete strong-identity user index without scrolling", async () => {
  const { parseGeminiBatchExecute } = await import("../src/content/gemini-native-navigation.ts");
  const body = batchExecuteBody([
    historyTurn({ requestId: "r_1", responseId: "rc_1", userText: "Repeat", assistantText: "First" }),
    historyTurn({ requestId: "r_2", responseId: "rc_2", userText: "Repeat", assistantText: "Second" }),
    historyTurn({ requestId: "r_3", responseId: "rc_3", userText: "Edited", assistantText: "Third" })
  ]);

  const snapshots = parseGeminiBatchExecute(body);
  const [snapshot] = snapshots;

  assert.equal(snapshot.conversationId, "c_conversation-a");
  assert.equal(snapshot.turns.length, 3);
  assert.deepEqual(snapshot.turns.map((turn) => turn.userText), ["Repeat", "Repeat", "Edited"]);
  assert.equal(new Set(snapshot.turns.map((turn) => turn.navigation.navigationId)).size, 3);
  assert.deepEqual(snapshot.turns.map((turn) => turn.navigation.identitySource), [
    "native-message-id",
    "native-message-id",
    "native-message-id"
  ]);

  const source = readFileSync(new URL("../src/content/gemini-native-navigation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /scrollTo\(|scrollBy\(|scrollTop\s*=|scrollIntoView\(/);
});

test("Gemini response branches remain distinct even when request and prompt are shared", async () => {
  const { parseGeminiBatchExecute } = await import("../src/content/gemini-native-navigation.ts");
  const body = batchExecuteBody([
    historyTurn({ requestId: "r_shared", responseId: "rc_original", userText: "Regenerate", assistantText: "A" }),
    historyTurn({ requestId: "r_shared", responseId: "rc_regenerated", userText: "Regenerate", assistantText: "B" })
  ]);

  const turns = parseGeminiBatchExecute(body)[0].turns;

  assert.equal(turns.length, 2);
  assert.notEqual(turns[0].navigation.navigationId, turns[1].navigation.navigationId);
});

test("Gemini native index enriches streaming answers and isolates SPA conversations", async () => {
  const { GeminiNativeIndex } = await import("../src/content/gemini-native-navigation.ts");
  const index = new GeminiNativeIndex();
  index.activate("c_conversation-a");
  index.ingest(
    batchExecuteBody([
      historyTurn({ requestId: "r_1", responseId: "rc_1", userText: "Stream", assistantText: "No text response" })
    ])
  );
  index.ingest(
    batchExecuteBody([
      historyTurn({ requestId: "r_1", responseId: "rc_1", userText: "Stream", assistantText: "Completed answer" })
    ])
  );

  assert.equal(index.getActiveTurns().length, 1);
  assert.equal(index.getActiveTurns()[0].assistantText, "Completed answer");

  index.activate("c_conversation-b");
  assert.deepEqual(index.getActiveTurns(), []);
  index.ingest(
    batchExecuteBody([
      historyTurn({
        conversationId: "c_conversation-b",
        requestId: "r_b",
        responseId: "rc_b",
        userText: "Other chat",
        assistantText: "Other answer"
      })
    ])
  );
  assert.deepEqual(index.getActiveTurns().map((turn) => turn.userText), ["Other chat"]);
});

test("full ordered DOM binding survives Gemini custom-element remounts and repeated prompts", async () => {
  const { bindGeminiNativeTurns } = await import("../src/content/gemini-native-navigation.ts");
  const nativeTurns = (await import("../src/content/gemini-native-navigation.ts")).parseGeminiBatchExecute(
    batchExecuteBody([
      historyTurn({ requestId: "r_1", responseId: "rc_1", userText: "Repeat", assistantText: "First" }),
      historyTurn({ requestId: "r_2", responseId: "rc_2", userText: "Repeat", assistantText: "Second" })
    ])
  )[0].turns;

  const firstMount = bindGeminiNativeTurns(nativeTurns, [mountedTurn(0, "Repeat"), mountedTurn(1, "Repeat")]);
  const remount = bindGeminiNativeTurns(nativeTurns, [mountedTurn(8, "Repeat"), mountedTurn(9, "Repeat")]);

  assert.equal(firstMount.complete, true);
  assert.equal(remount.complete, true);
  assert.deepEqual(
    firstMount.turns.map((turn) => turn.navigation.navigationId),
    remount.turns.map((turn) => turn.navigation.navigationId)
  );
  assert.notEqual(firstMount.turns[0].navigation.navigationId, firstMount.turns[1].navigation.navigationId);
});

test("partial mounted DOM without a deterministic native position is not guessed", async () => {
  const { bindGeminiNativeTurns, parseGeminiBatchExecute } = await import(
    "../src/content/gemini-native-navigation.ts"
  );
  const nativeTurns = parseGeminiBatchExecute(
    batchExecuteBody([
      historyTurn({ requestId: "r_1", responseId: "rc_1", userText: "Repeat", assistantText: "First" }),
      historyTurn({ requestId: "r_2", responseId: "rc_2", userText: "Repeat", assistantText: "Second" })
    ])
  )[0].turns;

  const binding = bindGeminiNativeTurns(nativeTurns, [mountedTurn(0, "Repeat")]);

  assert.equal(binding.complete, false);
  assert.equal(binding.turns[0].navigation, undefined);
});

test("a newly streamed Gemini turn appends after a fully matched native prefix", async () => {
  const { bindGeminiNativeTurns, parseGeminiBatchExecute } = await import(
    "../src/content/gemini-native-navigation.ts"
  );
  const nativeTurns = parseGeminiBatchExecute(
    batchExecuteBody([
      historyTurn({ requestId: "r_1", responseId: "rc_1", userText: "First", assistantText: "Loaded" })
    ])
  )[0].turns;
  const binding = bindGeminiNativeTurns(nativeTurns, [
    mountedTurn(0, "First", "Loaded"),
    mountedTurn(1, "Streaming", "Partial answer")
  ]);

  assert.equal(binding.complete, false);
  assert.equal(binding.turns.length, 2);
  assert.equal(binding.turns[0].navigation.navigationId, nativeTurns[0].navigation.navigationId);
  assert.equal(binding.turns[1].navigation, undefined);
  assert.equal(binding.turns[1].assistantText, "Partial answer");
});

test("Gemini mounted target lookup uses only a complete ordered strong-identity binding", async () => {
  const { findGeminiMountedTurnIndex, parseGeminiBatchExecute } = await import(
    "../src/content/gemini-native-navigation.ts"
  );
  const nativeTurns = parseGeminiBatchExecute(
    batchExecuteBody([
      historyTurn({ requestId: "r_1", responseId: "rc_1", userText: "Repeat", assistantText: "First" }),
      historyTurn({ requestId: "r_2", responseId: "rc_2", userText: "Repeat", assistantText: "Second" })
    ])
  )[0].turns;
  const target = nativeTurns[1].navigation;

  assert.equal(
    findGeminiMountedTurnIndex(target, nativeTurns, [mountedTurn(0, "Repeat"), mountedTurn(1, "Repeat")]),
    1
  );
  assert.equal(findGeminiMountedTurnIndex(target, nativeTurns, [mountedTurn(0, "Repeat")]), null);
});

test("Gemini adapter is routed through the native RPC index before mounted-DOM fallback", () => {
  const source = readFileSync(new URL("../src/content/conversation-adapters.ts", import.meta.url), "utf8");

  assert.match(source, /createGeminiAdapter/);
  assert.match(source, /geminiNativeIndex\.getActiveTurns\(\)/);
  assert.match(source, /bindGeminiNativeTurns/);
  assert.match(source, /findGeminiMountedTurnIndex/);
  assert.match(source, /profile\.site\.id\s*===\s*"gemini"/);
});

test("Gemini observer is installed in MAIN world at document_start and buffers the eager RPC", () => {
  const manifestSource = readFileSync(new URL("../src/manifest.ts", import.meta.url), "utf8");
  const observerSource = readFileSync(
    new URL("../public/gemini-conversation-observer.js", import.meta.url),
    "utf8"
  );

  assert.match(manifestSource, /gemini-conversation-observer\.js/);
  assert.match(manifestSource, /run_at:\s*"document_start"/);
  assert.match(manifestSource, /world:\s*"MAIN"/);
  assert.match(observerSource, /hNvQHb/);
  assert.match(observerSource, /turnmap-gemini-observer/);
  assert.match(observerSource, /type\s*===\s*"flush"/);
  assert.doesNotMatch(observerSource, /async\s+function\s*\([^)]*\)\s*\{[^}]*originalFetch/s);
  assert.match(observerSource, /window\.XMLHttpRequest\.prototype\s*=\s*OriginalXMLHttpRequest\.prototype/);
  assert.match(observerSource, /Object\.setPrototypeOf\(window\.XMLHttpRequest,\s*OriginalXMLHttpRequest\)/);
});
