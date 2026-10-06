import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function loadModule() {
  try {
    return await import("../src/content/grok-native-navigation.ts");
  } catch (error) {
    assert.fail(`missing Grok native navigation module: ${error.message}`);
  }
}

function readRequired(url, label) {
  try {
    return readFileSync(url, "utf8");
  } catch (error) {
    assert.fail(`missing ${label}: ${error.message}`);
  }
}

function response({
  responseId,
  sender,
  message,
  parentResponseId = "",
  query,
  createTime = "2026-07-13T00:00:00Z"
}) {
  return {
    responseId,
    sender,
    message,
    parentResponseId,
    createTime,
    ...(query ? { query } : {})
  };
}

function responseUrl(origin = "https://grok.com", conversationId = "conversation-a") {
  return `${origin}/rest/app-chat/conversations/${conversationId}/responses`;
}

test("Grok response graph ignores assistant prompt echo and deduplicates nested response selectors", async () => {
  const { parseGrokConversationResponse } = await loadModule();
  const user = response({ responseId: "user-1", sender: "human", message: "Repeat" });
  const assistant = response({
    responseId: "assistant-1",
    sender: "assistant",
    parentResponseId: "user-1",
    query: "Repeat",
    message: "First answer"
  });
  const snapshots = parseGrokConversationResponse(
    responseUrl(),
    JSON.stringify({
      conversationId: "conversation-a",
      responses: [user, assistant, assistant],
      result: { response: assistant }
    })
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].turns.length, 1);
  assert.equal(snapshots[0].turns[0].userText, "Repeat");
  assert.equal(snapshots[0].turns[0].assistantText, "First answer");
  assert.equal(snapshots[0].turns[0].sourceAnchor.userMessageId, "user-1");
  assert.equal(snapshots[0].turns[0].sourceAnchor.assistantMessageId, "assistant-1");
});

test("identical Grok prompts keep independent backend response identities", async () => {
  const { parseGrokConversationResponse } = await loadModule();
  const snapshots = parseGrokConversationResponse(
    responseUrl(),
    JSON.stringify({
      responses: [
        response({ responseId: "user-1", sender: "human", message: "Repeat" }),
        response({ responseId: "assistant-1", sender: "assistant", parentResponseId: "user-1", message: "A" }),
        response({ responseId: "user-2", sender: "human", parentResponseId: "assistant-1", message: "Repeat" }),
        response({ responseId: "assistant-2", sender: "assistant", parentResponseId: "user-2", message: "B" })
      ]
    })
  );
  const turns = snapshots[0].turns;

  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((turn) => turn.userText), ["Repeat", "Repeat"]);
  assert.deepEqual(turns.map((turn) => turn.navigation.messageId), ["user-1", "user-2"]);
  assert.deepEqual(turns.map((turn) => turn.navigation.turnId), ["assistant-1", "assistant-2"]);
  assert.equal(new Set(turns.map((turn) => turn.navigation.navigationId)).size, 2);
});

test("Grok native index enriches streaming replies without changing identity or scrolling", async () => {
  const { GrokNativeIndex } = await loadModule();
  const index = new GrokNativeIndex();
  index.activate("https://grok.com", "conversation-a");
  index.ingest(
    responseUrl(),
    JSON.stringify({
      responses: [
        response({ responseId: "user-1", sender: "human", message: "Stream" }),
        response({ responseId: "assistant-1", sender: "assistant", parentResponseId: "user-1", message: "Part" })
      ]
    })
  );
  const identity = index.getActiveTurns()[0].navigation.navigationId;

  index.ingest(
    responseUrl(),
    `${JSON.stringify({ result: { response: response({
      responseId: "assistant-1",
      sender: "assistant",
      parentResponseId: "user-1",
      message: "Completed streaming answer"
    }) } })}\n`
  );

  assert.equal(index.getActiveTurns().length, 1);
  assert.equal(index.getActiveTurns()[0].assistantText, "Completed streaming answer");
  assert.equal(index.getActiveTurns()[0].navigation.navigationId, identity);

  const source = readRequired(new URL("../src/content/grok-native-navigation.ts", import.meta.url), "Grok native source");
  const passiveSection = source.slice(0, source.indexOf("export async function navigateGrokTarget"));
  assert.doesNotMatch(passiveSection, /scrollTo\(|scrollBy\(|scrollTop\s*=|scrollIntoView\(/);
});

test("a streamed Grok request without an echoed human record appends after existing history", async () => {
  const { GrokNativeIndex } = await loadModule();
  const index = new GrokNativeIndex();
  index.activate("https://grok.com", "conversation-a");
  index.ingest(
    responseUrl(),
    JSON.stringify({
      responses: [
        response({ responseId: "user-1", sender: "human", message: "Earlier", createTime: "2026-07-13T00:00:00Z" }),
        response({ responseId: "assistant-1", sender: "assistant", parentResponseId: "user-1", message: "Earlier answer", createTime: "2026-07-13T00:00:01Z" })
      ]
    })
  );
  index.ingest(
    "https://grok.com/rest/app-chat/conversations/new",
    JSON.stringify({
      turnmapRequestBody: JSON.stringify({ message: "Later", parentResponseId: "assistant-1" }),
      turnmapResponseBody: JSON.stringify({
        result: {
          conversation: { conversationId: "conversation-a" },
          response: response({
            responseId: "assistant-2",
            sender: "assistant",
            parentResponseId: "user-2",
            message: "Later answer",
            createTime: "2026-07-13T00:00:03Z"
          })
        }
      })
    })
  );

  assert.deepEqual(index.getActiveTurns().map((turn) => turn.userText), ["Earlier", "Later"]);
  assert.deepEqual(index.getActiveTurns().map((turn) => turn.navigation.messageId), ["user-1", "user-2"]);
});

test("grok.com and x.com conversation caches remain strictly isolated", async () => {
  const { GrokNativeIndex } = await loadModule();
  const index = new GrokNativeIndex();
  index.activate("https://grok.com", "shared-id");
  index.ingest(
    responseUrl("https://grok.com", "shared-id"),
    JSON.stringify({ responses: [response({ responseId: "grok-user", sender: "human", message: "Grok" })] })
  );
  assert.deepEqual(index.getActiveTurns().map((turn) => turn.userText), ["Grok"]);

  index.activate("https://x.com", "shared-id");
  assert.deepEqual(index.getActiveTurns(), []);
  index.ingest(
    responseUrl("https://x.com", "shared-id"),
    JSON.stringify({ responses: [response({ responseId: "x-user", sender: "human", message: "X" })] })
  );
  assert.deepEqual(index.getActiveTurns().map((turn) => turn.userText), ["X"]);
});

test("Grok target navigation reveals only an exact mounted response and never a neighbor", async () => {
  const { navigateGrokTarget } = await loadModule();
  const target = {
    kind: "ophel_notSourceAnchor",
    site: "grok",
    navigationId: "grok-turn:https%3A%2F%2Fgrok.com:conversation-a:user-2",
    identitySource: "native-message-id",
    messageId: "user-2",
    turnId: "assistant-2",
    turnIndex: 1
  };
  let revealed = false;
  const wrong = {
    id: "response-assistant-1",
    getAttribute: (name) => (name === "data-response-id" ? "assistant-1" : null)
  };

  const missing = await navigateGrokTarget(target, {
    findMounted: () => null,
    reveal: () => assert.fail("missing target must not reveal a neighbor")
  });
  const neighboring = await navigateGrokTarget(target, {
    findMounted: () => wrong,
    reveal: () => assert.fail("wrong response ID must not be revealed")
  });
  const exact = {
    id: "response-assistant-2",
    getAttribute: (name) => (name === "data-response-id" ? "assistant-2" : null)
  };
  const found = await navigateGrokTarget(target, {
    findMounted: () => exact,
    reveal: () => {
      revealed = true;
    }
  });

  assert.equal(missing.ok, false);
  assert.equal(neighboring.ok, false);
  assert.deepEqual(found, { ok: true });
  assert.equal(revealed, true);
});

test("Grok observer and adapter are routed before mounted-DOM fallback", () => {
  const adapterSource = readRequired(new URL("../src/content/conversation-adapters.ts", import.meta.url), "adapter source");
  const manifestSource = readRequired(new URL("../src/manifest.ts", import.meta.url), "manifest source");
  const observerSource = readRequired(new URL("../public/grok-conversation-observer.js", import.meta.url), "Grok observer");

  assert.match(adapterSource, /createGrokAdapter/);
  assert.match(adapterSource, /grokNativeIndex\.getActiveTurns\(\)/);
  assert.match(adapterSource, /navigateGrokTarget/);
  assert.match(adapterSource, /profile\.site\.id\s*===\s*"grok"/);
  assert.match(manifestSource, /grok-conversation-observer\.js/);
  assert.match(manifestSource, /matches:\s*\["https:\/\/grok\.com\/\*",\s*"https:\/\/\*\.grok\.com\/\*",\s*"https:\/\/x\.com\/\*"\]/);
  assert.match(manifestSource, /run_at:\s*"document_start"/);
  assert.match(manifestSource, /world:\s*"MAIN"/);
  assert.match(observerSource, /conversations\\\/\[\^\/\]\+\\\/responses/);
  assert.match(observerSource, /response\.clone\(\)/);
  assert.doesNotMatch(observerSource, /scrollTo\(|scrollBy\(|scrollTop\s*=|scrollIntoView\(/);
});
