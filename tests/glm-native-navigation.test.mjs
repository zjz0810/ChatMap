import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GlmNativeIndex,
  glmConversationIdFromUrl,
  glmVariantFromUrl,
  mergeGlmNativeTurns,
  navigateGlmTarget,
  parseGlmConversationResponse
} from "../src/content/glm-native-navigation.ts";

function zAiPayload({
  conversationId = "conversation-a",
  currentId = "assistant-2",
  secondAnswer = "second final answer"
} = {}) {
  return JSON.stringify({
    id: conversationId,
    chat: {
      id: conversationId,
      title: "Repeated prompt fixture",
      history: {
        currentId,
        messages: {
          "user-1": {
            id: "user-1",
            parentId: null,
            childrenIds: ["assistant-1"],
            role: "user",
            content: "same prompt"
          },
          "assistant-1": {
            id: "assistant-1",
            parentId: "user-1",
            childrenIds: ["user-2"],
            role: "assistant",
            content: "first final answer",
            reasoning_content: "hidden operation planning"
          },
          "user-2": {
            id: "user-2",
            parentId: "assistant-1",
            childrenIds: ["assistant-old", "assistant-2"],
            role: "user",
            content: "same prompt"
          },
          "assistant-old": {
            id: "assistant-old",
            parentId: "user-2",
            childrenIds: [],
            role: "assistant",
            content: "inactive regenerated answer"
          },
          "assistant-2": {
            id: "assistant-2",
            parentId: "user-2",
            childrenIds: [],
            role: "assistant",
            content: secondAnswer,
            thinking: "理解用户请求\n调用工具\n整理答案"
          }
        }
      }
    }
  });
}

const ZAI_DETAIL_URL = "https://chat.z.ai/api/v1/chats/conversation-a";

test("GLM host routing keeps ChatGLM and Z.ai as distinct variants", () => {
  assert.equal(glmVariantFromUrl("https://chatglm.cn/main/alltoolsdetail"), "chatglm");
  assert.equal(glmVariantFromUrl("https://www.chatglm.cn/main/alltoolsdetail"), "chatglm");
  assert.equal(glmVariantFromUrl("https://chat.z.ai/c/abc"), "z-ai");
  assert.equal(glmVariantFromUrl("https://z.ai/c/abc"), "z-ai");
  assert.equal(glmVariantFromUrl("https://example.com/c/abc"), null);
});

test("Z.ai history keeps repeated prompts distinct and follows only the active branch", () => {
  const snapshots = parseGlmConversationResponse(zAiPayload(), ZAI_DETAIL_URL);

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].variant, "z-ai");
  assert.equal(snapshots[0].host, "chat.z.ai");
  assert.equal(snapshots[0].conversationId, "conversation-a");
  assert.deepEqual(snapshots[0].turns.map((turn) => turn.userText), ["same prompt", "same prompt"]);
  assert.deepEqual(snapshots[0].turns.map((turn) => turn.navigation?.messageId), ["user-1", "user-2"]);
  assert.deepEqual(snapshots[0].turns.map((turn) => turn.navigation?.navigationId), [
    "glm-turn:z-ai:chat.z.ai:conversation-a:user-1",
    "glm-turn:z-ai:chat.z.ai:conversation-a:user-2"
  ]);
  assert.equal(snapshots[0].turns[1].assistantText, "second final answer");
  assert.doesNotMatch(snapshots[0].turns[1].assistantText, /理解用户请求|调用工具|hidden operation planning/);
});

test("GLM native parsing rejects ChatGLM payload reuse and unrelated endpoints", () => {
  assert.deepEqual(
    parseGlmConversationResponse(zAiPayload(), "https://chatglm.cn/api/v1/chats/conversation-a"),
    []
  );
  assert.deepEqual(
    parseGlmConversationResponse(zAiPayload(), "https://chat.z.ai/api/models"),
    []
  );
});

test("Z.ai chat creation binds response conversation id to the captured request history", () => {
  const requestBody = zAiPayload({ conversationId: "" });
  const snapshots = parseGlmConversationResponse(
    JSON.stringify({ id: "conversation-created" }),
    "https://chat.z.ai/api/v1/chats/new",
    requestBody
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].conversationId, "conversation-created");
  assert.deepEqual(snapshots[0].turns.map((turn) => turn.navigation?.messageId), ["user-1", "user-2"]);
});

test("Z.ai structured assistant content excludes reasoning planning and tool segments", () => {
  const snapshots = parseGlmConversationResponse(zAiPayload({
    secondAnswer: [
      { type: "reasoning", content: "hidden chain of thought" },
      { type: "tool_call", content: "hidden tool operation" },
      { type: "text", content: "visible final answer" }
    ]
  }), ZAI_DETAIL_URL);

  assert.equal(snapshots[0].turns[1].assistantText, "visible final answer");
});

test("Z.ai native index enriches streaming replies without changing identity", () => {
  const index = new GlmNativeIndex();
  index.activate({ variant: "z-ai", host: "chat.z.ai", conversationId: "conversation-a" });
  index.ingest(zAiPayload({ secondAnswer: "" }), ZAI_DETAIL_URL);
  const before = index.getActiveTurns();
  index.ingest(zAiPayload({ secondAnswer: "completed streamed answer" }), ZAI_DETAIL_URL);
  const after = index.getActiveTurns();

  assert.equal(before.length, 2);
  assert.equal(after.length, 2);
  assert.equal(before[1].navigation?.navigationId, after[1].navigation?.navigationId);
  assert.equal(after[1].assistantText, "completed streamed answer");
});

test("Z.ai native index retains a captured new chat until the SPA route activates it", () => {
  const index = new GlmNativeIndex();
  index.activate({ variant: "z-ai", host: "chat.z.ai", conversationId: "" });

  const updated = index.ingest(
    JSON.stringify({ id: "conversation-created" }),
    "https://chat.z.ai/api/v1/chats/new",
    zAiPayload({ conversationId: "" })
  );

  assert.deepEqual(updated, ["conversation-created"]);
  assert.deepEqual(index.getActiveTurns(), []);
  index.activate({ variant: "z-ai", host: "chat.z.ai", conversationId: "conversation-created" });
  assert.equal(index.getActiveTurns().length, 2);
});

test("Z.ai native index retains a new chat captured before the old SPA route changes", () => {
  const index = new GlmNativeIndex();
  index.activate({ variant: "z-ai", host: "chat.z.ai", conversationId: "conversation-old" });
  index.ingest(
    zAiPayload({ conversationId: "conversation-old" }),
    "https://chat.z.ai/api/v1/chats/conversation-old"
  );
  assert.match(index.getActiveTurns()[0].navigation?.navigationId ?? "", /conversation-old/);

  const updated = index.ingest(
    JSON.stringify({ id: "conversation-created" }),
    "https://chat.z.ai/api/v1/chats/new",
    zAiPayload({ conversationId: "" })
  );

  assert.deepEqual(updated, ["conversation-created"]);
  assert.match(index.getActiveTurns()[0].navigation?.navigationId ?? "", /conversation-old/);
  index.activate({ variant: "z-ai", host: "chat.z.ai", conversationId: "conversation-created" });
  assert.equal(index.getActiveTurns().length, 2);
  assert.match(index.getActiveTurns()[0].navigation?.navigationId ?? "", /conversation-created/);
});

test("GLM native index clears identities across host variant and conversation switches", () => {
  const index = new GlmNativeIndex();
  index.activate({ variant: "z-ai", host: "chat.z.ai", conversationId: "conversation-a" });
  index.ingest(zAiPayload(), ZAI_DETAIL_URL);
  assert.equal(index.getActiveTurns().length, 2);

  index.activate({ variant: "chatglm", host: "chatglm.cn", conversationId: "conversation-a" });
  assert.deepEqual(index.getActiveTurns(), []);
  index.ingest(zAiPayload(), ZAI_DETAIL_URL);
  assert.deepEqual(index.getActiveTurns(), []);

  index.activate({ variant: "z-ai", host: "chat.z.ai", conversationId: "conversation-b" });
  index.ingest(
    zAiPayload({ conversationId: "conversation-b" }),
    "https://chat.z.ai/api/v1/chats/conversation-b"
  );
  assert.equal(index.getActiveTurns()[0].navigation?.navigationId, "glm-turn:z-ai:chat.z.ai:conversation-b:user-1");
});

test("Z.ai mounted enrichment binds only exact message element UUIDs", () => {
  const nativeTurns = parseGlmConversationResponse(zAiPayload(), ZAI_DETAIL_URL)[0].turns;
  const mountedTurns = [{
    ...nativeTurns[1],
    assistantText: "a longer mounted streamed answer",
    sourceAnchor: {
      ...nativeTurns[1].sourceAnchor,
      userMessageId: "message-user-2"
    },
    navigation: undefined
  }];

  const merged = mergeGlmNativeTurns(nativeTurns, mountedTurns);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].navigation?.messageId, "user-1");
  assert.equal(merged[1].assistantText, "a longer mounted streamed answer");
  assert.equal(merged[1].navigation?.navigationId, "glm-turn:z-ai:chat.z.ai:conversation-a:user-2");
});

test("Z.ai conversation ids are accepted only on exact conversation routes", () => {
  assert.equal(glmConversationIdFromUrl("https://chat.z.ai/c/abc-123"), "abc-123");
  assert.equal(glmConversationIdFromUrl("https://z.ai/c/abc-123"), "abc-123");
  assert.equal(glmConversationIdFromUrl("https://chat.z.ai/"), "");
  assert.equal(glmConversationIdFromUrl("https://chatglm.cn/c/abc-123"), "");
});

test("Z.ai navigation reveals only an exact mounted native message id", async () => {
  const target = parseGlmConversationResponse(zAiPayload(), ZAI_DETAIL_URL)[0].turns[0].navigation;
  assert.ok(target);
  const revealed = [];
  const exactElement = { id: "message-user-1" };

  assert.deepEqual(await navigateGlmTarget(target, {
    currentVariant: "z-ai",
    currentHost: "chat.z.ai",
    currentConversationId: "conversation-a",
    findMounted: (messageId) => messageId === "user-1" ? exactElement : null,
    reveal: (element) => revealed.push(element)
  }), { ok: true });
  assert.deepEqual(revealed, [exactElement]);

  const missing = await navigateGlmTarget({
    ...target,
    messageId: "missing",
    navigationId: "glm-turn:z-ai:chat.z.ai:conversation-a:missing"
  }, {
    currentVariant: "z-ai",
    currentHost: "chat.z.ai",
    currentConversationId: "conversation-a",
    findMounted: () => null,
    reveal: () => assert.fail("must not reveal a neighboring GLM message")
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason ?? "", /not mounted|did not use text matching|scroll search/i);

  const wrongHost = await navigateGlmTarget(target, {
    currentVariant: "chatglm",
    currentHost: "chatglm.cn",
    currentConversationId: "conversation-a",
    findMounted: () => exactElement,
    reveal: () => assert.fail("must not reuse a Z.ai identity on ChatGLM")
  });
  assert.equal(wrongHost.ok, false);
  assert.match(wrongHost.reason ?? "", /variant|host|conversation/i);
});

test("GLM passive native indexing contains no extraction scrolling", async () => {
  const source = await readFile(new URL("../src/content/glm-native-navigation.ts", import.meta.url), "utf8");
  const passiveSection = source.slice(0, source.indexOf("export async function navigateGlmTarget"));
  assert.doesNotMatch(passiveSection, /scrollTo\(|scrollBy\(|scrollTop\s*=|scrollIntoView\(/);
});

test("Z.ai observer and adapter use passive capture with host-scoped profiles", async () => {
  const observerSource = await readFile(new URL("../public/glm-conversation-observer.js", import.meta.url), "utf8");
  const adapterSource = await readFile(new URL("../src/content/conversation-adapters.ts", import.meta.url), "utf8");
  const manifestSource = await readFile(new URL("../src/manifest.ts", import.meta.url), "utf8");

  assert.match(observerSource, /isZaiConversationRequest/);
  assert.match(observerSource, /api\\\/v1\\\/chats/);
  assert.match(observerSource, /response\.clone\(\)\.text\(\)/);
  assert.match(observerSource, /requestBody/);
  assert.match(observerSource, /capture\(url, body, requestBody\)/);
  assert.match(observerSource, /absoluteUrl/);
  assert.match(observerSource, /new URL\(String\(url \|\| ""\), window\.location\.origin\)\.href/);
  assert.doesNotMatch(observerSource, /scrollTo|scrollIntoView|scrollTop\s*=/);
  assert.match(adapterSource, /createGlmAdapter/);
  assert.match(adapterSource, /profile\.site\.id === "glm"/);
  assert.match(adapterSource, /hostPatterns:\s*\["chatglm\.cn",\s*"www\.chatglm\.cn"\]/);
  assert.match(adapterSource, /hostPatterns:\s*\["chat\.z\.ai",\s*"z\.ai"\]/);
  assert.match(adapterSource, /messageIdAttributes:\s*\["id"\]/);
  assert.match(manifestSource, /glm-conversation-observer\.js/);
  assert.match(manifestSource, /https:\/\/chat\.z\.ai\/\*/);
});
