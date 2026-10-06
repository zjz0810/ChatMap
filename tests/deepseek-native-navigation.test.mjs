import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function loadModule() {
  try {
    return await import("../src/content/deepseek-native-navigation.ts");
  } catch (error) {
    assert.fail(`missing DeepSeek native navigation module: ${error.message}`);
  }
}

function message({
  id,
  parentId = null,
  role,
  request,
  response,
  think,
  status = "FINISHED"
}) {
  const fragments = [];
  if (request != null) fragments.push({ id: 1, type: "REQUEST", content: request });
  if (think != null) fragments.push({ id: 2, type: "THINK", content: think });
  if (response != null) fragments.push({ id: 3, type: "RESPONSE", content: response });
  return {
    message_id: id,
    parent_id: parentId,
    role,
    status,
    fragments
  };
}

function historyBody({
  conversationId = "session-a",
  currentMessageId,
  messages,
  cacheControl = "REPLACE"
}) {
  return JSON.stringify({
    data: {
      biz_code: 0,
      biz_data: {
        cache_control: cacheControl,
        chat_session: {
          id: conversationId,
          current_message_id: currentMessageId
        },
        chat_messages: messages
      }
    }
  });
}

function fullRepeatedConversation() {
  return historyBody({
    currentMessageId: 202,
    messages: [
      message({ id: 101, role: "USER", request: "Repeat this exactly" }),
      message({
        id: 102,
        parentId: 101,
        role: "ASSISTANT",
        think: "Private chain of thought",
        response: "First final answer"
      }),
      message({ id: 201, parentId: 102, role: "USER", request: "Repeat this exactly" }),
      message({ id: 202, parentId: 201, role: "ASSISTANT", response: "Second final answer" })
    ]
  });
}

test("DeepSeek history_messages yields a complete strong-identity index without harvest scrolling", async () => {
  const { parseDeepSeekHistoryResponse } = await loadModule();
  const [snapshot] = parseDeepSeekHistoryResponse(fullRepeatedConversation());

  assert.equal(snapshot.conversationId, "session-a");
  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.turns.map((turn) => turn.userText), [
    "Repeat this exactly",
    "Repeat this exactly"
  ]);
  assert.deepEqual(snapshot.turns.map((turn) => turn.assistantText), [
    "First final answer",
    "Second final answer"
  ]);
  assert.deepEqual(snapshot.turns.map((turn) => turn.navigation.messageId), ["101", "201"]);
  assert.equal(new Set(snapshot.turns.map((turn) => turn.navigation.navigationId)).size, 2);

  const source = readFileSync(new URL("../src/content/deepseek-native-navigation.ts", import.meta.url), "utf8");
  const passiveSection = source.slice(0, source.indexOf("export async function navigateDeepSeekTarget"));
  assert.doesNotMatch(passiveSection, /scrollTo\(|scrollBy\(|scrollTop\s*=|scrollIntoView\(/);
});

test("DeepSeek active-path parsing ignores sibling branches and thinking fragments", async () => {
  const { parseDeepSeekHistoryResponse } = await loadModule();
  const [snapshot] = parseDeepSeekHistoryResponse(historyBody({
    currentMessageId: 302,
    messages: [
      message({ id: 101, role: "USER", request: "Choose a branch" }),
      message({ id: 102, parentId: 101, role: "ASSISTANT", response: "Old branch" }),
      message({ id: 301, parentId: 101, role: "ASSISTANT", think: "Hidden reasoning", response: "Active branch" }),
      message({ id: 302, parentId: 301, role: "USER", request: "Continue active branch" })
    ]
  }));

  assert.deepEqual(snapshot.turns.map((turn) => turn.userText), ["Choose a branch", "Continue active branch"]);
  assert.equal(snapshot.turns[0].assistantText, "Active branch");
  assert.doesNotMatch(snapshot.turns[0].assistantText, /Hidden reasoning|Old branch/);
});

test("DeepSeek native index enriches streaming answers and clears the prior session", async () => {
  const { DeepSeekNativeIndex } = await loadModule();
  const index = new DeepSeekNativeIndex();
  index.activate("session-a");
  index.ingest(historyBody({
    currentMessageId: 102,
    messages: [
      message({ id: 101, role: "USER", request: "Stream this" }),
      message({ id: 102, parentId: 101, role: "ASSISTANT", think: "Do not expose", response: "Partial" })
    ]
  }));
  index.ingest(historyBody({
    currentMessageId: 102,
    cacheControl: "MERGE",
    messages: [
      message({ id: 102, parentId: 101, role: "ASSISTANT", think: "Still hidden", response: "Completed answer" })
    ]
  }));

  assert.equal(index.getActiveTurns()[0].assistantText, "Completed answer");
  assert.equal(index.hasCompleteActiveIndex(), true);

  index.activate("session-b");
  assert.deepEqual(index.getActiveTurns(), []);
  assert.equal(index.hasCompleteActiveIndex(), false);
});

test("DeepSeek mounted remounts enrich the same native identity by exact message ID", async () => {
  const { bindDeepSeekNativeTurns, parseDeepSeekHistoryResponse } = await loadModule();
  const nativeTurns = parseDeepSeekHistoryResponse(fullRepeatedConversation())[0].turns;
  const mounted = [{
    ...nativeTurns[1],
    id: "remounted-dom-turn",
    assistantText: "Second final answer with streamed completion",
    sourceAnchor: {
      ...nativeTurns[1].sourceAnchor,
      assistantHash: "mounted-answer-hash"
    },
    navigation: undefined
  }];

  const bound = bindDeepSeekNativeTurns(nativeTurns, mounted);

  assert.equal(bound.length, 2);
  assert.equal(bound[1].navigation.navigationId, nativeTurns[1].navigation.navigationId);
  assert.equal(bound[1].assistantText, "Second final answer with streamed completion");
});

test("DeepSeek off-screen navigation requests one exact native ID and revalidates the remount", async () => {
  const { navigateDeepSeekTarget } = await loadModule();
  const calls = [];
  const mounted = { getAttribute: (name) => name === "data-virtual-list-item-key" ? "201" : null };
  const target = {
    kind: "ophel_notSourceAnchor",
    site: "deepseek",
    navigationId: "deepseek-turn:session-a:201",
    identitySource: "native-message-id",
    messageId: "201",
    nativeTocIndex: 1,
    turnIndex: 1
  };

  const result = await navigateDeepSeekTarget(target, {
    findMounted: () => null,
    requestNativeTarget: async (messageId) => {
      calls.push({ requested: messageId });
      return true;
    },
    waitForMounted: async () => mounted,
    reveal: (element) => calls.push({ revealed: element })
  });

  assert.deepEqual(calls[0], { requested: "201" });
  assert.equal(calls[1].revealed, mounted);
  assert.deepEqual(result, { ok: true });
});

test("DeepSeek off-screen navigation fails closed on rejected, timed-out, or wrong remounts", async () => {
  const { navigateDeepSeekTarget } = await loadModule();
  const target = {
    kind: "ophel_notSourceAnchor",
    site: "deepseek",
    navigationId: "deepseek-turn:session-a:201",
    identitySource: "native-message-id",
    messageId: "201",
    turnIndex: 1
  };
  const base = {
    findMounted: () => null,
    reveal: () => assert.fail("safe failure must not reveal an unverified neighbor")
  };

  for (const environment of [
    { requestNativeTarget: async () => false, waitForMounted: async () => null },
    { requestNativeTarget: async () => true, waitForMounted: async () => null },
    {
      requestNativeTarget: async () => true,
      waitForMounted: async () => ({ getAttribute: () => "neighbor-message" })
    }
  ]) {
    assert.equal((await navigateDeepSeekTarget(target, { ...base, ...environment })).ok, false);
  }
});

test("DeepSeek observer captures full history and uses only exact virtual message keys for revive", () => {
  const manifestSource = readFileSync(new URL("../src/manifest.ts", import.meta.url), "utf8");
  let observerSource = "";
  try {
    observerSource = readFileSync(
      new URL("../public/deepseek-conversation-observer.js", import.meta.url),
      "utf8"
    );
  } catch (error) {
    assert.fail(`missing DeepSeek MAIN-world observer: ${error.message}`);
  }

  assert.match(manifestSource, /deepseek-conversation-observer\.js/);
  assert.match(manifestSource, /run_at:\s*"document_start"/);
  assert.match(manifestSource, /world:\s*"MAIN"/);
  assert.match(observerSource, /\/api\/v0\/chat\/history_messages/);
  assert.match(observerSource, /cache_version|cache_reset_at/);
  assert.match(observerSource, /data-virtual-list-item-key/);
  assert.match(observerSource, /__reactFiber\$|__reactInternalInstance\$/);
  assert.match(observerSource, /\.scrollTo\(\{\s*key:/);
  assert.doesNotMatch(observerSource, /localStorage|getStorageUserToken|authorization/i);
  const captureSection = observerSource.slice(0, observerSource.indexOf("async function activateNativeTarget"));
  assert.doesNotMatch(captureSection, /scrollTo\(|scrollTop\s*=|scrollIntoView\(/);
  assert.doesNotMatch(observerSource, /includes\([^)]*text|innerText\s*===|textContent\s*===/);
});

test("DeepSeek adapter routes native history and exact revive before mounted-DOM fallback", () => {
  const source = readFileSync(new URL("../src/content/conversation-adapters.ts", import.meta.url), "utf8");

  assert.match(source, /createDeepSeekAdapter/);
  assert.match(source, /deepSeekNativeIndex\.getActiveTurns\(\)/);
  assert.match(source, /bindDeepSeekNativeTurns/);
  assert.match(source, /navigateDeepSeekTarget/);
  assert.match(source, /profile\.site\.id\s*===\s*"deepseek"/);
});
