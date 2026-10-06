import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mergeTurnUpdates, reconcileChatGptIndexOrder } from "../src/side-panel/turn-merge.ts";

function turn(id, index, assistantText = `assistant ${index}`) {
  return {
    id,
    turnIndex: index,
    userText: `user ${index}`,
    assistantText,
    extractedAt: 1,
    sourceAnchor: {
      turnIndex: index,
      userHash: `u${index}`,
      assistantHash: `a${index}`,
      userPreview: `user ${index}`,
      assistantPreview: assistantText
    }
  };
}

test("refresh appends only tail turns and preserves existing turn objects", () => {
  const first = turn("turn-1", 0, "old text");
  const second = turn("turn-2", 1);
  const changedFirst = turn("turn-1", 0, "new scan should not overwrite");
  const third = turn("turn-3", 2);

  const result = mergeTurnUpdates([first, second], [changedFirst, second, third], "refresh");

  assert.equal(result.added, 1);
  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3"]);
  assert.equal(result.turns[0], first);
  assert.equal(result.turns[0].assistantText, "old text");
});

test("refresh enriches a streamed placeholder when the same identity later has an answer", () => {
  const pending = turn("turn-2", 1, "No text response");
  const completed = turn("turn-2", 1, "TurnMap QA 1");

  const result = mergeTurnUpdates([pending], [completed], "refresh");

  assert.equal(result.added, 0);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].assistantText, "TurnMap QA 1");
  assert.equal(result.turns[0], completed);
});

test("refresh restores jump identity from the live scan onto a cached turn", () => {
  const cached = turn("chatgpt-turn-1", 0, "Captured answer");
  const live = turn("chatgpt-turn-1", 0, "Captured answer");
  live.navigation = {
    kind: "ophel_notSourceAnchor",
    site: "chatgpt",
    navigationId: "chatgpt-native-user-query:0:question",
    messageId: "message-user-1"
  };
  live.sourceAnchor.userMessageId = "message-user-1";

  const result = mergeTurnUpdates([cached], [live], "refresh-index");

  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].id, cached.id);
  assert.equal(result.turns[0].navigation.messageId, "message-user-1");
  assert.equal(result.turns[0].sourceAnchor.userMessageId, "message-user-1");
});

test("ChatGPT streaming updates preserve the existing node id by navigation identity", () => {
  const pending = turn("chatgpt-node-1", 0, "无文字回复");
  pending.navigation = {
    kind: "ophel_notSourceAnchor",
    site: "chatgpt",
    navigationId: "chatgpt-native-user-query:0:question"
  };
  const streamed = turn("chatgpt-node-rehashed", 0, "OK");
  streamed.navigation = { ...pending.navigation };

  const result = mergeTurnUpdates([pending], [streamed], "refresh-index");

  assert.equal(result.added, 0);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].id, "chatgpt-node-1");
  assert.equal(result.turns[0].assistantText, "OK");
});

test("refresh matches a remounted web turn by stable navigation identity", () => {
  const mounted = turn("turn-uid-user-0-old", 0, "No text response");
  mounted.sourceAnchor.userMessageId = "user-0-old";
  mounted.navigation = {
    kind: "ophel_notSourceAnchor",
    site: "deepseek",
    navigationId: "deepseek-mounted-user:question-hash:0",
    identitySource: "mounted-dom-id",
    messageId: "user-0-old",
    textHash: "question-hash"
  };
  const remounted = turn("turn-uid-user-12-new", 8, "Completed DeepSeek answer");
  remounted.sourceAnchor.userMessageId = "user-12-new";
  remounted.sourceAnchor.assistantHash = "completed-answer-hash";
  remounted.navigation = {
    ...mounted.navigation,
    messageId: "user-12-new",
    turnIndex: 8
  };

  const result = mergeTurnUpdates([mounted], [remounted], "refresh");

  assert.equal(result.added, 0);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0], remounted);
});

test("refresh index enriches a streamed placeholder without replacing completed neighbors", () => {
  const first = turn("turn-1", 0, "keep this answer");
  const pending = turn("turn-2", 1, "No text response");
  const changedFirst = turn("turn-1", 0, "do not overwrite");
  const completed = turn("turn-2", 1, "TurnMap QA 1");

  const result = mergeTurnUpdates([first, pending], [changedFirst, completed], "refresh-index");

  assert.equal(result.added, 0);
  assert.equal(result.turns[0], first);
  assert.equal(result.turns[1], completed);
});

test("refresh ignores missing middle turns", () => {
  const first = turn("turn-1", 0);
  const third = turn("turn-3", 2);
  const second = turn("turn-2", 1);

  const result = mergeTurnUpdates([first, third], [first, second, third], "refresh");

  assert.equal(result.added, 0);
  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-3"]);
});

test("refresh index inserts missing middle turns without replacing existing text", () => {
  const first = turn("turn-1", 0, "old text");
  const fourth = turn("turn-4", 3);
  const changedFirst = turn("turn-1", 0, "new scan should not overwrite");
  const second = turn("turn-2", 1);
  const third = turn("turn-3", 2);

  const result = mergeTurnUpdates([first, fourth], [changedFirst, second, third, fourth], "refresh-index");

  assert.equal(result.added, 2);
  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3", "turn-4"]);
  assert.equal(result.turns[0], first);
  assert.equal(result.turns[0].assistantText, "old text");
});

test("refresh index preserves old turns that are absent from the mounted refresh", () => {
  const first = turn("turn-1", 0);
  const second = turn("turn-2", 1);
  const third = turn("turn-3", 2);

  const result = mergeTurnUpdates([first, third], [first, second], "refresh-index");

  assert.equal(result.added, 1);
  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3"]);
});

test("ChatGPT refresh index never drops older turns missing from a partial virtualized snapshot", () => {
  const first = turn("turn-1", 0);
  const second = turn("turn-2", 1);
  const third = turn("turn-3", 2);
  for (const entry of [first, second, third]) {
    entry.navigation = { kind: "ophel_notSourceAnchor", site: "chatgpt", turnIndex: entry.turnIndex };
  }

  const partialSnapshot = [second, third];
  const result = mergeTurnUpdates([first, second, third], partialSnapshot, "refresh-index");

  assert.deepEqual(result.turns.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3"]);
});

test("a covering ChatGPT index scan repairs stored turn order without changing node ids", () => {
  const first = turn("turn-1", 0, "first answer");
  const second = turn("turn-2", 1, "second answer");
  const third = turn("turn-3", 2, "third answer");
  for (const entry of [first, second, third]) {
    entry.navigation = { kind: "ophel_notSourceAnchor", site: "chatgpt", turnIndex: entry.turnIndex };
  }
  const incoming = [
    { ...first, id: "scan-first", turnIndex: 0 },
    { ...second, id: "scan-second", turnIndex: 1, assistantText: "short" },
    { ...third, id: "scan-third", turnIndex: 2 }
  ];

  const reconciled = reconcileChatGptIndexOrder([first, third, second], incoming, true);

  assert.ok(reconciled);
  assert.deepEqual(reconciled.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3"]);
  assert.deepEqual(reconciled.map((entry) => entry.userText), ["user 0", "user 1", "user 2"]);
  assert.equal(reconciled[1].assistantText, "second answer");
});

test("a partial ChatGPT index scan cannot reorder or delete existing turns", () => {
  const first = turn("turn-1", 0);
  const second = turn("turn-2", 1);
  const third = turn("turn-3", 2);
  for (const entry of [first, second, third]) {
    entry.navigation = { kind: "ophel_notSourceAnchor", site: "chatgpt", turnIndex: entry.turnIndex };
  }

  assert.equal(reconcileChatGptIndexOrder([first, second, third], [first, second], false), null);
});

test("a completed near-full ChatGPT scan reorders matches and retains missed turns", () => {
  const existing = Array.from({ length: 10 }, (_unused, index) => turn(`turn-${index}`, index));
  for (const entry of existing) {
    entry.navigation = { kind: "ophel_notSourceAnchor", site: "chatgpt", turnIndex: entry.turnIndex };
  }
  const scrambled = [existing[1], existing[0], ...existing.slice(2)];
  const incoming = existing.filter((_entry, index) => index !== 4).map((entry, turnIndex) => ({
    ...entry,
    id: `scan-${entry.id}`,
    turnIndex
  }));

  const reconciled = reconcileChatGptIndexOrder(scrambled, incoming, true);

  assert.ok(reconciled);
  assert.equal(reconciled.length, 10);
  assert.deepEqual(reconciled.map((entry) => entry.userText), existing.map((entry) => entry.userText));
  assert.deepEqual(reconciled.map((entry) => entry.id), existing.map((entry) => entry.id));
});

test("an unstable scan can still repair order when it covers every saved turn", () => {
  const first = turn("turn-1", 0);
  const second = turn("turn-2", 1);
  const third = turn("turn-3", 2);
  for (const entry of [first, second, third]) {
    entry.navigation = { kind: "ophel_notSourceAnchor", site: "chatgpt", turnIndex: entry.turnIndex };
  }

  const reconciled = reconcileChatGptIndexOrder(
    [first, third, second],
    [first, second, third],
    false
  );

  assert.deepEqual(reconciled?.map((entry) => entry.id), ["turn-1", "turn-2", "turn-3"]);
});

test("a newly mounted older ChatGPT turn shifts every covered saved turn forward", () => {
  const asChatGpt = (entry) => ({ ...entry, navigation: { site: "chatgpt", turnIndex: entry.turnIndex } });
  const second = asChatGpt(turn("turn-2", 1));
  const third = asChatGpt(turn("turn-3", 2));
  const first = asChatGpt(turn("turn-1", 0));
  const reconciled = reconcileChatGptIndexOrder(
    [second, third],
    [first, second, third],
    false
  );

  assert.deepEqual(reconciled?.map((entry) => entry.userText), ["user 0", "user 1", "user 2"]);
  assert.deepEqual(reconciled?.map((entry) => entry.turnIndex), [0, 1, 2]);
  assert.equal(reconciled?.[1].id, second.id);
  assert.equal(reconciled?.[2].id, third.id);
});

test("Refresh Index uses coverage-checked reconciliation for ChatGPT snapshots", () => {
  const source = readFileSync(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");

  assert.match(source, /mode === "refresh-index" && message\.site\?\.id === "chatgpt"/);
  assert.match(source, /reconcileChatGptIndexOrder\(turnsRef\.current, message\.turns, message\.harvestMeta\?\.complete === true\)/);
  assert.match(source, /app\.status\.refreshIndexReordered/);
});

test("ChatGPT Refresh runs a full scan and requests a fresh graph rebuild", () => {
  const source = readFileSync(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const refreshHandler = source.slice(source.indexOf("const refreshTurns = useCallback"), source.indexOf("const rebuildMap = useCallback"));

  assert.match(refreshHandler, /ensureFull: isChatGpt/);
  assert.match(refreshHandler, /reconcileChatGptIndexOrder\(/);
  assert.match(refreshHandler, /applyTurnsMessage\(\{ \.\.\.message, turns: recomputedTurns \}, "replace"\)/);
  assert.match(refreshHandler, /setRebuildRequest\(\(request\) => request \+ 1\)/);
  assert.match(refreshHandler, /app\.status\.refreshRecomputed/);
});

test("Refresh Index clears the old ChatMap graph and replaces it with the fresh scan", () => {
  const source = readFileSync(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const refreshStart = source.indexOf("const refreshIndexTurns = useCallback");
  const refreshEnd = source.indexOf("const openFullPage = useCallback", refreshStart);
  const refreshBody = source.slice(refreshStart, refreshEnd);

  assert.match(refreshBody, /message\.turns\.length === 0/);
  assert.match(refreshBody, /app\.status\.refreshScanEmpty/);
  assert.match(refreshBody, /turnsRef\.current = \[\]/);
  assert.match(refreshBody, /setTurns\(\[\]\)/);
  assert.match(refreshBody, /setGraphResetRequest/);
  assert.match(refreshBody, /deleteTurnsFromIndexedDb\(oldConversationId\)/);
  assert.match(refreshBody, /applyTurnsMessage\(message, "replace"\)/);
  assert.doesNotMatch(refreshBody, /applyConversationRead\(/);
  assert.match(refreshBody, /setRebuildRequest\(\(request\) => request \+ 1\)/);
});

test("ChatGPT scroll updates reindex the covered conversation instead of freezing the old prefix", () => {
  const source = readFileSync(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const listenerStart = source.indexOf("const listener = (message: unknown)");
  const listenerEnd = source.indexOf("chrome.runtime.onMessage.addListener", listenerStart);
  const listenerBody = source.slice(listenerStart, listenerEnd);

  assert.match(listenerBody, /turnsMessage\.site\?\.id === "chatgpt" \? "refresh-index" : "refresh"/);
  assert.doesNotMatch(listenerBody, /applyTurnsMessage\(turnsMessage\);/);
});
