import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  QwenNativeIndex,
  mergeQwenNativeTurns,
  navigateQwenTarget,
  parseQwenChatResponse,
  qwenConversationIdFromUrl
} from "../src/content/qwen-native-navigation.ts";

function chatPayload({ chatId = "chat-1", currentId = "a2", messages }) {
  return JSON.stringify({
    success: true,
    data: {
      id: chatId,
      chat: {
        id: chatId,
        history: {
          currentId,
          currentResponseIds: [currentId],
          messages
        }
      }
    }
  });
}

function repeatedPromptPayload(secondAnswer = "second answer") {
  return chatPayload({
    messages: {
      u1: { id: "u1", role: "user", content: "same prompt", parentId: null, childrenIds: ["a1"] },
      a1: { id: "a1", role: "assistant", content: "first answer", parentId: "u1", childrenIds: ["u2"] },
      u2: { id: "u2", role: "user", content: "same prompt", parentId: "a1", childrenIds: ["a2"] },
      a2: { id: "a2", role: "assistant", content: secondAnswer, parentId: "u2", childrenIds: [] }
    }
  });
}

test("Qwen history keeps identical prompts separate by stable message identity", () => {
  const snapshot = parseQwenChatResponse(repeatedPromptPayload());

  assert.equal(snapshot?.conversationId, "chat-1");
  assert.equal(snapshot?.turns.length, 2);
  assert.deepEqual(snapshot?.turns.map((turn) => turn.userText), ["same prompt", "same prompt"]);
  assert.deepEqual(snapshot?.turns.map((turn) => turn.navigation?.messageId), ["u1", "u2"]);
  assert.deepEqual(snapshot?.turns.map((turn) => turn.navigation?.navigationId), [
    "qwen-turn:chat-1:u1",
    "qwen-turn:chat-1:u2"
  ]);
});

test("Qwen streaming enrichment updates one turn without changing navigation identity", () => {
  const index = new QwenNativeIndex();
  index.activate("chat-1");
  index.ingest(repeatedPromptPayload(""));
  const before = index.getActiveTurns();
  index.ingest(repeatedPromptPayload("completed streamed answer"));
  const after = index.getActiveTurns();

  assert.equal(before.length, 2);
  assert.equal(after.length, 2);
  assert.equal(before[1].navigation?.navigationId, after[1].navigation?.navigationId);
  assert.equal(after[1].assistantText, "completed streamed answer");
});

test("Qwen native history retains an early unmounted round and only enriches exact data-chat identities", () => {
  const nativeTurns = parseQwenChatResponse(repeatedPromptPayload())?.turns ?? [];
  const mountedTail = [{
    ...nativeTurns[1],
    assistantText: "a longer mounted streamed answer",
    sourceAnchor: {
      ...nativeTurns[1].sourceAnchor,
      userMessageId: "u2"
    }
  }];

  const merged = mergeQwenNativeTurns(nativeTurns, mountedTail);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].navigation?.messageId, "u1");
  assert.equal(merged[1].assistantText, "a longer mounted streamed answer");
  assert.equal(merged[1].navigation?.navigationId, "qwen-turn:chat-1:u2");
});

test("Qwen follows only the active regenerated branch", () => {
  const snapshot = parseQwenChatResponse(chatPayload({
    currentId: "a-new",
    messages: {
      u1: { id: "u1", role: "user", content: "branch prompt", parentId: null, childrenIds: ["a-old", "a-new"] },
      "a-old": { id: "a-old", role: "assistant", content: "old branch", parentId: "u1", childrenIds: [] },
      "a-new": { id: "a-new", role: "assistant", content: "active branch", parentId: "u1", childrenIds: [] }
    }
  }));

  assert.equal(snapshot?.turns.length, 1);
  assert.equal(snapshot?.turns[0].assistantText, "active branch");
  assert.equal(snapshot?.turns[0].navigation?.turnId, "a-new");
});

test("Qwen native index clears identities across SPA conversation switches", () => {
  const index = new QwenNativeIndex();
  index.activate("chat-1");
  index.ingest(repeatedPromptPayload());
  assert.equal(index.getActiveTurns().length, 2);

  index.activate("chat-2");
  assert.deepEqual(index.getActiveTurns(), []);
  index.ingest(repeatedPromptPayload());
  assert.deepEqual(index.getActiveTurns(), []);

  index.ingest(chatPayload({
    chatId: "chat-2",
    currentId: "b1",
    messages: {
      v1: { id: "v1", role: "user", content: "other chat", parentId: null, childrenIds: ["b1"] },
      b1: { id: "b1", role: "assistant", content: "other answer", parentId: "v1", childrenIds: [] }
    }
  }));
  assert.equal(index.getActiveTurns()[0].navigation?.navigationId, "qwen-turn:chat-2:v1");
});

test("Qwen navigation reveals only an exact mounted data-chat target and safely fails otherwise", async () => {
  const target = parseQwenChatResponse(repeatedPromptPayload())?.turns[0].navigation;
  assert.ok(target);
  const revealed = [];
  const exactElement = { getAttribute: (name) => name === "data-chat" ? "u1" : null };

  assert.deepEqual(await navigateQwenTarget(target, {
    findMounted: (messageId) => messageId === "u1" ? exactElement : null,
    reveal: (element) => revealed.push(element)
  }), { ok: true });
  assert.deepEqual(revealed, [exactElement]);

  const missing = await navigateQwenTarget({ ...target, messageId: "missing", navigationId: "qwen-turn:chat-1:missing" }, {
    findMounted: () => null,
    reveal: () => assert.fail("must not reveal a neighboring Qwen round")
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason ?? "", /not mounted|did not use text matching|scroll search/i);
});

test("Qwen conversation ids support both current site route families", () => {
  assert.equal(qwenConversationIdFromUrl("https://chat.qwen.ai/c/abc-123"), "abc-123");
  assert.equal(qwenConversationIdFromUrl("https://www.qianwen.com/chat/6815e278319349a1addcb9f30b4b1afa"), "6815e278319349a1addcb9f30b4b1afa");
  assert.equal(qwenConversationIdFromUrl("https://chat.qwen.ai/"), "");
});

test("Qwen observer and adapter use passive capture without extraction scrolling", async () => {
  const observerSource = await readFile(new URL("../public/qwen-conversation-observer.js", import.meta.url), "utf8");
  const adapterSource = await readFile(new URL("../src/content/conversation-adapters.ts", import.meta.url), "utf8");
  const manifestSource = await readFile(new URL("../src/manifest.ts", import.meta.url), "utf8");

  assert.match(observerSource, /isConversationDetailRequest/);
  assert.match(observerSource, /chats\\\//);
  assert.match(observerSource, /response\.clone\(\)\.text\(\)/);
  assert.doesNotMatch(observerSource, /scrollTo|scrollIntoView|scrollTop\s*=/);
  assert.match(adapterSource, /createQwenAdapter/);
  assert.match(adapterSource, /profile\.site\.id === "qwen"/);
  assert.match(adapterSource, /messageIdAttributes:\s*\[[^\]]*"data-chat"/s);
  assert.match(
    adapterSource,
    /latestTurns\s*=\s*qwenNativeIndex\.getActiveTurns\(\)\.length\s*>\s*0\s*\?\s*currentTurns\s*:\s*mergeNativeWebTurns/s
  );
  assert.match(manifestSource, /qwen-conversation-observer\.js/);
});
