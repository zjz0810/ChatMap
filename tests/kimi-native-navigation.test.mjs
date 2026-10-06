import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function textBlock(id, content) {
  return { id, text: { content } };
}

function fileBlock(id, name) {
  return { id, file: { id: `file-${id}`, name, meta: { name } } };
}

function message({
  id,
  parentId = "",
  childrenMessageIds = [],
  role,
  blocks = [],
  references = []
}) {
  return {
    id,
    parent_id: parentId,
    children_message_ids: childrenMessageIds,
    role,
    blocks,
    references
  };
}

function page(messages, nextPageToken = "") {
  return JSON.stringify({ messages, next_page_token: nextPageToken });
}

function repeatedSegmentHistory(secondAnswer = "second answer") {
  return [
    message({ id: "a2-tail", parentId: "a2", role: "assistant", blocks: [textBlock("b6", "citation tail")] }),
    message({ id: "a2", parentId: "u2", childrenMessageIds: ["a2-tail"], role: "assistant", blocks: [textBlock("b5", secondAnswer)] }),
    message({ id: "u2", parentId: "a1", childrenMessageIds: ["a2"], role: "user", blocks: [textBlock("b4", "same prompt")] }),
    message({ id: "a1", parentId: "u1", childrenMessageIds: ["u2"], role: "assistant", blocks: [textBlock("b2", "first answer")] }),
    message({ id: "u1", childrenMessageIds: ["a1"], role: "user", blocks: [textBlock("b1", "same prompt")] })
  ];
}

test("Kimi paged history keeps repeated prompts separate and merges assistant segments into one turn", async () => {
  const { parseKimiMessagesResponse } = await import("../src/content/kimi-native-navigation.ts");
  const snapshot = parseKimiMessagesResponse(page(repeatedSegmentHistory()), "chat-1");

  assert.equal(snapshot?.conversationId, "chat-1");
  assert.equal(snapshot?.complete, true);
  assert.deepEqual(snapshot?.turns.map((turn) => turn.userText), ["same prompt", "same prompt"]);
  assert.deepEqual(snapshot?.turns.map((turn) => turn.navigation?.messageId), ["u1", "u2"]);
  assert.deepEqual(snapshot?.turns.map((turn) => turn.navigation?.navigationId), [
    "kimi-turn:chat-1:u1",
    "kimi-turn:chat-1:u2"
  ]);
  assert.equal(snapshot?.turns[1].assistantText, "second answer\ncitation tail");
});

test("Kimi block aggregation keeps attachment and reference enrichment without duplicate body text", async () => {
  const { parseKimiMessagesResponse } = await import("../src/content/kimi-native-navigation.ts");
  const messages = [
    message({
      id: "a1",
      parentId: "u1",
      role: "assistant",
      blocks: [
        textBlock("body-1", "answer body"),
        textBlock("body-2", "answer body"),
        fileBlock("attachment-1", "report.pdf"),
        fileBlock("attachment-2", "report.pdf")
      ],
      references: [
        { title: "Source A", url: "https://example.com/a" },
        { title: "Source A", url: "https://example.com/a" }
      ]
    }),
    message({ id: "u1", childrenMessageIds: ["a1"], role: "user", blocks: [textBlock("prompt", "question")] })
  ];

  const turn = parseKimiMessagesResponse(page(messages), "chat-1")?.turns[0];
  assert.ok(turn);
  assert.equal(turn.assistantText.match(/answer body/g)?.length, 1);
  assert.equal(turn.assistantText.match(/report\.pdf/g)?.length, 1);
  assert.equal(turn.assistantText.match(/Source A/g)?.length, 1);
});

test("Kimi parser accepts protobuf JSON enum role names", async () => {
  const { parseKimiMessagesResponse } = await import("../src/content/kimi-native-navigation.ts");
  const messages = [
    message({ id: "a1", parentId: "u1", role: "CHAT_MESSAGE_ROLE_ASSISTANT", blocks: [textBlock("a", "answer")] }),
    message({ id: "u1", childrenMessageIds: ["a1"], role: "CHAT_MESSAGE_ROLE_USER", blocks: [textBlock("u", "question")] })
  ];

  assert.deepEqual(parseKimiMessagesResponse(page(messages), "chat-1")?.turns.map((turn) => turn.userText), ["question"]);
});

test("Kimi native index joins silent pagination, enriches streaming text, and clears on conversation switch", async () => {
  const { KimiNativeIndex } = await import("../src/content/kimi-native-navigation.ts");
  const index = new KimiNativeIndex();
  index.activate("chat-1");
  index.ingest({
    conversationId: "chat-1",
    pageToken: "",
    body: page(repeatedSegmentHistory("partial" ).slice(0, 3), "older-page")
  });

  assert.equal(index.hasCompleteActiveIndex(), false);
  assert.equal(index.getActiveTurns().length, 1);

  index.ingest({
    conversationId: "chat-1",
    pageToken: "older-page",
    body: page(repeatedSegmentHistory("partial").slice(3))
  });
  const complete = index.getActiveTurns();
  assert.equal(index.hasCompleteActiveIndex(), true);
  assert.equal(complete.length, 2);
  assert.equal(complete[0].navigation?.messageId, "u1");

  index.ingest({
    conversationId: "chat-1",
    pageToken: "",
    body: page(repeatedSegmentHistory("completed streamed answer").slice(0, 3), "older-page")
  });
  const enriched = index.getActiveTurns();
  assert.equal(enriched[1].assistantText, "completed streamed answer\ncitation tail");
  assert.equal(enriched[1].navigation?.navigationId, complete[1].navigation?.navigationId);

  index.activate("chat-2");
  assert.deepEqual(index.getActiveTurns(), []);
  index.ingest({ conversationId: "chat-1", pageToken: "", body: page(repeatedSegmentHistory()) });
  assert.deepEqual(index.getActiveTurns(), []);
});

test("Kimi exact DOM binding survives segment remounts and never matches repeated text by position", async () => {
  const { bindKimiNativeTurns, parseKimiMessagesResponse } = await import("../src/content/kimi-native-navigation.ts");
  const nativeTurns = parseKimiMessagesResponse(page(repeatedSegmentHistory()), "chat-1")?.turns ?? [];
  const mounted = [{
    ...nativeTurns[1],
    assistantText: "a much longer mounted rendered answer",
    sourceAnchor: { ...nativeTurns[1].sourceAnchor, userMessageId: "u2" }
  }];

  const first = bindKimiNativeTurns(nativeTurns, mounted);
  const remounted = bindKimiNativeTurns(nativeTurns, [{ ...mounted[0] }]);

  assert.equal(first.length, 2);
  assert.equal(first[0].assistantText, "first answer");
  assert.equal(first[1].assistantText, "a much longer mounted rendered answer");
  assert.equal(remounted[1].navigation?.navigationId, first[1].navigation?.navigationId);
});

test("Kimi navigation reveals only an exact message ID and fails closed when native revive cannot remount it", async () => {
  const { navigateKimiTarget, parseKimiMessagesResponse } = await import("../src/content/kimi-native-navigation.ts");
  const target = parseKimiMessagesResponse(page(repeatedSegmentHistory()), "chat-1")?.turns[0].navigation;
  assert.ok(target);
  const exact = { getAttribute: (name) => name === "data-turnmap-kimi-message-id" ? "u1" : null };
  const revealed = [];

  assert.deepEqual(await navigateKimiTarget(target, {
    findMounted: () => exact,
    requestNativeTarget: async () => assert.fail("mounted targets do not request revival"),
    waitForMounted: async () => null,
    reveal: (element) => revealed.push(element)
  }), { ok: true });
  assert.deepEqual(revealed, [exact]);

  const missing = { ...target, messageId: "missing", navigationId: "kimi-turn:chat-1:missing" };
  const result = await navigateKimiTarget(missing, {
    findMounted: () => null,
    requestNativeTarget: async (messageId) => messageId === "missing",
    waitForMounted: async () => ({ getAttribute: () => "neighbor" }),
    reveal: () => assert.fail("a neighboring segment must never be revealed")
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /exact message ID|remount/i);
});

test("Kimi observer captures paged ListMessages data and exposes deterministic Vue-state revival without scrolling", async () => {
  const observerSource = await readFile(new URL("../public/kimi-conversation-observer.js", import.meta.url), "utf8");
  const adapterSource = await readFile(new URL("../src/content/conversation-adapters.ts", import.meta.url), "utf8");
  const manifestSource = await readFile(new URL("../src/manifest.ts", import.meta.url), "utf8");

  assert.match(observerSource, /ChatService\/ListMessages/);
  assert.match(observerSource, /next_page_token|nextPageToken/);
  assert.match(observerSource, /page_token|pageToken/);
  assert.match(observerSource, /__vueParentComponent/);
  assert.match(observerSource, /fetchPrevSegments/);
  assert.match(observerSource, /data-turnmap-kimi-message-id/);
  assert.doesNotMatch(observerSource, /scrollIntoView|scrollTop\s*=|\.scrollTo\(/);
  assert.match(adapterSource, /createKimiAdapter/);
  assert.match(adapterSource, /kimiNativeIndex\.getActiveTurns\(\)/);
  assert.match(adapterSource, /profile\.site\.id === "kimi"/);
  assert.match(manifestSource, /kimi-conversation-observer\.js/);
  assert.match(manifestSource, /run_at:\s*"document_start"/);
  assert.match(manifestSource, /world:\s*"MAIN"/);
});

test("Kimi conversation IDs accept only current chat routes", async () => {
  const { kimiConversationIdFromUrl } = await import("../src/content/kimi-native-navigation.ts");

  assert.equal(kimiConversationIdFromUrl("https://www.kimi.com/chat/abc-123"), "abc-123");
  assert.equal(kimiConversationIdFromUrl("https://kimi.com/chat/abc-123?foo=bar"), "abc-123");
  assert.equal(kimiConversationIdFromUrl("https://www.kimi.com/"), "");
});
