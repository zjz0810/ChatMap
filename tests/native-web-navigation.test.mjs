import assert from "node:assert/strict";
import test from "node:test";

import { hashText } from "../src/shared/hash.ts";

async function loadModule() {
  try {
    return await import("../src/content/native-web-navigation.ts");
  } catch (error) {
    assert.fail(`missing shared native web navigation provider: ${error.message}`);
  }
}

function turn(index, userText, userMessageId, assistantText = "No text response") {
  return {
    id: `turn-${index}`,
    turnIndex: index,
    userText,
    assistantText,
    extractedAt: 1,
    sourceAnchor: {
      turnIndex: index,
      userMessageId,
      userHash: hashText(userText),
      assistantHash: hashText(assistantText),
      userPreview: userText,
      assistantPreview: assistantText
    }
  };
}

test("native web turns receive site-scoped ophel_notSourceAnchor identities", async () => {
  const { attachNativeWebNavigation } = await loadModule();
  const [result] = attachNativeWebNavigation([turn(0, "Explain adapters", "message-42")], "deepseek");

  assert.equal(result.navigation.kind, "ophel_notSourceAnchor");
  assert.equal(result.navigation.site, "deepseek");
  assert.equal(result.navigation.navigationId, "deepseek-message:message-42");
  assert.equal(result.navigation.messageId, "message-42");
  assert.equal(result.navigation.identitySource, "native-message-id");
});

test("mounted DOM identity stays stable when a DeepSeek turn moves between virtualized scan windows", async () => {
  const { attachNativeWebNavigation } = await loadModule();
  const [first] = attachNativeWebNavigation(
    [turn(0, "How do I open this notebook?", "user-0-a1")],
    "deepseek"
  );
  const [remounted] = attachNativeWebNavigation(
    [turn(6, "How do I open this notebook?", "user-12-f9")],
    "deepseek"
  );

  assert.equal(first.navigation.identitySource, "mounted-dom-id");
  assert.equal(remounted.navigation.identitySource, "mounted-dom-id");
  assert.equal(first.navigation.navigationId, remounted.navigation.navigationId);
  assert.equal(first.navigation.textHash, hashText("How do I open this notebook?"));
});

test("mounted DOM identity keeps repeated prompts distinct within the same mounted window", async () => {
  const { attachNativeWebNavigation } = await loadModule();
  const repeated = attachNativeWebNavigation(
    [turn(0, "Continue", "user-0-a1"), turn(1, "Continue", "user-2-b2")],
    "deepseek"
  );

  assert.notEqual(repeated[0].navigation.navigationId, repeated[1].navigation.navigationId);
});

test("remounted DeepSeek turns merge by stable mounted identity instead of being appended", async () => {
  const { attachNativeWebNavigation, mergeNativeWebTurns } = await loadModule();
  const first = attachNativeWebNavigation(
    [turn(0, "How do I open this notebook?", "user-0-a1", "Use Jupyter Notebook.")],
    "deepseek"
  );
  const remounted = attachNativeWebNavigation(
    [
      turn(
        8,
        "How do I open this notebook?",
        "user-16-f9",
        "Use Jupyter Notebook or JupyterLab, then open the notebook from the file browser."
      )
    ],
    "deepseek"
  );

  const merged = mergeNativeWebTurns(first, remounted);

  assert.equal(merged.length, 1);
  assert.match(merged[0].assistantText, /file browser/);
});

test("identity-first merge preserves repeated user questions with different native identities", async () => {
  const { attachNativeWebNavigation, mergeNativeWebTurns } = await loadModule();
  const repeated = attachNativeWebNavigation(
    [turn(0, "Repeat this", "message-a"), turn(1, "Repeat this", "message-b")],
    "kimi"
  );

  const merged = mergeNativeWebTurns([], repeated);

  assert.equal(merged.length, 2);
  assert.notEqual(merged[0].navigation.navigationId, merged[1].navigation.navigationId);
});

test("identity-first merge enriches the same navigation target without collapsing neighbors", async () => {
  const { attachNativeWebNavigation, mergeNativeWebTurns } = await loadModule();
  const first = attachNativeWebNavigation([turn(0, "Question", "message-a")], "claude");
  const enriched = attachNativeWebNavigation(
    [turn(0, "Question", "message-a", "A complete assistant answer")],
    "claude"
  );

  const merged = mergeNativeWebTurns(first, enriched);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].assistantText, "A complete assistant answer");
  assert.equal(merged[0].navigation.navigationId, "claude-message:message-a");
});

test("native web resolver source is exact-identity only and contains no text or scroll fallback", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/content/native-web-navigation.ts", import.meta.url), "utf8");
  const resolverStart = source.indexOf("export async function resolveNativeWebTarget");
  const resolverBody = source.slice(resolverStart);

  assert.match(resolverBody, /candidate\.navigation\?\.navigationId\s*===\s*target\.navigationId/);
  assert.doesNotMatch(resolverBody, /includes\(|target\.userPreview|candidate\.userText|textHash\s*===|scrollTo\(|scrollBy\(/);
});
