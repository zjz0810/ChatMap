import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function message({
  conversationId = "conversation-a",
  messageId,
  index,
  userType,
  text,
  replyId
}) {
  return {
    conversation_id: conversationId,
    message_id: messageId,
    index,
    user_type: userType,
    content: JSON.stringify({ text }),
    ...(replyId ? { reply_id: replyId } : {})
  };
}

function responseBody(messages) {
  return JSON.stringify({ code: 0, data: { message_list: messages, has_more: false } });
}

test("Doubao history responses create ghost turns with stable message identities without scrolling", async () => {
  const { parseDoubaoConversationResponse } = await import("../src/content/doubao-native-navigation.ts");
  const snapshots = parseDoubaoConversationResponse(
    responseBody([
      message({ messageId: "user-1", index: 10, userType: 1, text: "Repeat" }),
      message({ messageId: "assistant-1", index: 11, userType: 2, replyId: "user-1", text: "First" }),
      message({ messageId: "user-2", index: 20, userType: 1, text: "Repeat" }),
      message({ messageId: "assistant-2", index: 21, userType: 2, replyId: "user-2", text: "Second" })
    ])
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].conversationId, "conversation-a");
  assert.deepEqual(snapshots[0].turns.map((turn) => turn.userText), ["Repeat", "Repeat"]);
  assert.deepEqual(snapshots[0].turns.map((turn) => turn.assistantText), ["First", "Second"]);
  assert.deepEqual(snapshots[0].turns.map((turn) => turn.navigation.messageId), ["user-1", "user-2"]);
  assert.deepEqual(snapshots[0].turns.map((turn) => turn.navigation.nativeTocIndex), [10, 20]);
  assert.equal(new Set(snapshots[0].turns.map((turn) => turn.navigation.navigationId)).size, 2);

  const source = readFileSync(new URL("../src/content/doubao-native-navigation.ts", import.meta.url), "utf8");
  const passiveSection = source.slice(0, source.indexOf("export async function navigateDoubaoTarget"));
  assert.doesNotMatch(passiveSection, /scrollTo\(|scrollBy\(|scrollTop\s*=|scrollIntoView\(/);
});

test("Doubao native index retains ghost turns through a transient empty virtual-list refresh", async () => {
  const { DoubaoNativeIndex } = await import("../src/content/doubao-native-navigation.ts");
  const index = new DoubaoNativeIndex();
  index.activate("conversation-a");
  index.ingest(
    responseBody([
      message({ messageId: "user-1", index: 1, userType: 1, text: "First" }),
      message({ messageId: "assistant-1", index: 2, userType: 2, replyId: "user-1", text: "Answer" })
    ])
  );

  index.ingest(responseBody([]));

  assert.equal(index.getActiveTurns().length, 1);
  assert.equal(index.getActiveTurns()[0].navigation.messageId, "user-1");
});

test("Doubao native index enriches streaming replies and clears identities on conversation switch", async () => {
  const { DoubaoNativeIndex } = await import("../src/content/doubao-native-navigation.ts");
  const index = new DoubaoNativeIndex();
  index.activate("conversation-a");
  index.ingest(
    responseBody([
      message({ messageId: "user-1", index: 1, userType: 1, text: "Stream" }),
      message({ messageId: "assistant-1", index: 2, userType: 2, replyId: "user-1", text: "Partial" })
    ])
  );
  index.ingest(
    responseBody([
      message({ messageId: "user-1", index: 1, userType: 1, text: "Stream" }),
      message({
        messageId: "assistant-1",
        index: 2,
        userType: 2,
        replyId: "user-1",
        text: "Completed streaming answer"
      })
    ])
  );

  assert.equal(index.getActiveTurns()[0].assistantText, "Completed streaming answer");

  index.activate("conversation-b");
  assert.deepEqual(index.getActiveTurns(), []);
  index.ingest(
    responseBody([
      message({ conversationId: "conversation-b", messageId: "user-b", index: 1, userType: 1, text: "Other" })
    ])
  );
  assert.deepEqual(index.getActiveTurns().map((turn) => turn.navigation.messageId), ["user-b"]);
});

test("Doubao deterministic ghost navigation requests the native virtual key and revalidates the mounted ID", async () => {
  const { navigateDoubaoTarget } = await import("../src/content/doubao-native-navigation.ts");
  const calls = [];
  const mounted = { getAttribute: (name) => (name === "data-message-id" ? "user-2" : null) };
  const target = {
    kind: "ophel_notSourceAnchor",
    site: "doubao",
    navigationId: "doubao-turn:conversation-a:user-2",
    identitySource: "native-message-id",
    messageId: "user-2",
    nativeTocIndex: 20,
    turnIndex: 1
  };

  const result = await navigateDoubaoTarget(target, {
    findMounted: () => null,
    requestVirtualTarget: async (request) => {
      calls.push(request);
      return true;
    },
    waitForMounted: async () => mounted,
    reveal: (element) => calls.push({ revealed: element })
  });

  assert.deepEqual(calls[0], {
    messageId: "user-2",
    nativeIndex: 20,
    virtualKeys: ["block_user-2", "user-2"]
  });
  assert.equal(calls[1].revealed, mounted);
  assert.deepEqual(result, { ok: true });
});

test("Doubao ghost navigation fails safely on a missing, timed-out, or wrong remount", async () => {
  const { navigateDoubaoTarget } = await import("../src/content/doubao-native-navigation.ts");
  const target = {
    kind: "ophel_notSourceAnchor",
    site: "doubao",
    navigationId: "doubao-turn:conversation-a:user-2",
    identitySource: "native-message-id",
    messageId: "user-2",
    nativeTocIndex: 20,
    turnIndex: 1
  };
  const base = {
    findMounted: () => null,
    reveal: () => assert.fail("safe failures must not reveal an unverified target")
  };

  assert.equal(
    (await navigateDoubaoTarget(target, {
      ...base,
      requestVirtualTarget: async () => false,
      waitForMounted: async () => null
    })).ok,
    false
  );
  assert.equal(
    (await navigateDoubaoTarget(target, {
      ...base,
      requestVirtualTarget: async () => true,
      waitForMounted: async () => null
    })).ok,
    false
  );
  assert.equal(
    (await navigateDoubaoTarget(target, {
      ...base,
      requestVirtualTarget: async () => true,
      waitForMounted: async () => ({ getAttribute: () => "neighbor-message" })
    })).ok,
    false
  );
});

test("Doubao observer is eager, passive during capture, and exposes only deterministic virtual navigation", () => {
  const manifestSource = readFileSync(new URL("../src/manifest.ts", import.meta.url), "utf8");
  const observerSource = readFileSync(
    new URL("../public/doubao-conversation-observer.js", import.meta.url),
    "utf8"
  );

  assert.match(manifestSource, /doubao-conversation-observer\.js/);
  assert.match(manifestSource, /run_at:\s*"document_start"/);
  assert.match(manifestSource, /world:\s*"MAIN"/);
  assert.match(observerSource, /\/alice\/message\/(?:list|index_list)/);
  assert.match(observerSource, /\/im\/chain\/single/);
  assert.match(observerSource, /scrollIntoItemsById|scrollToRow/);
  assert.match(observerSource, /block_/);
  assert.doesNotMatch(observerSource.slice(0, observerSource.indexOf("function navigateVirtualTarget")), /scrollTop\s*=|scrollTo\(/);
});

test("Doubao adapter routes native history and ghost jumps before mounted-DOM fallback", () => {
  const source = readFileSync(new URL("../src/content/conversation-adapters.ts", import.meta.url), "utf8");

  assert.match(source, /createDoubaoAdapter/);
  assert.match(source, /doubaoNativeIndex\.getActiveTurns\(\)/);
  assert.match(source, /navigateDoubaoTarget/);
  assert.match(source, /profile\.site\.id\s*===\s*"doubao"/);
});
