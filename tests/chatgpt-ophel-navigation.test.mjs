import assert from "node:assert/strict";
import test from "node:test";

import { hashText } from "../src/shared/hash.ts";

async function loadNavigationModule() {
  try {
    return await import("../src/content/chatgpt-ophel-navigation.ts");
  } catch (error) {
    assert.fail(`missing clean-room ChatGPT ophel_notSourceAnchor navigation module: ${error.message}`);
  }
}

function turn(id, index, userText, assistantText = `assistant ${index}`, navigation) {
  return {
    id,
    turnIndex: index,
    userText,
    assistantText,
    extractedAt: 1,
    navigation,
    sourceAnchor: {
      turnIndex: index,
      userMessageId: `legacy-user-${index}`,
      assistantMessageId: `legacy-assistant-${index}`,
      userHash: hashText(userText),
      assistantHash: hashText(assistantText),
      userPreview: userText.slice(0, 120),
      assistantPreview: assistantText.slice(0, 120)
    }
  };
}

test("ChatGPT native user seeds create ophel_notSourceAnchor navigation ids without scrolling", async () => {
  const { turnsFromOphelNavigationSeeds } = await loadNavigationModule();

  const turns = turnsFromOphelNavigationSeeds([
    { index: 0, text: "First prompt", messageId: "aaa" },
    { index: 1, text: "Repeat prompt" },
    { index: 2, text: "Repeat prompt" }
  ]);

  assert.equal(turns.length, 3);
  assert.equal(turns[0].navigation?.kind, "ophel_notSourceAnchor");
  assert.equal(turns[0].navigation?.navigationId, "chatgpt-message:aaa");
  assert.match(turns[1].navigation?.navigationId ?? "", /^chatgpt-native-user-query:1:/);
  assert.match(turns[2].navigation?.navigationId ?? "", /^chatgpt-native-user-query:2:/);
  assert.notEqual(turns[1].navigation?.navigationId, turns[2].navigation?.navigationId);
});

test("ChatGPT native user index extends partial extraction by navigation identity, not SourceAnchor", async () => {
  const { mergeOphelNavigationTurns, turnsFromOphelNavigationSeeds } = await loadNavigationModule();
  const existing = [
    turn("turn-0", 0, "Old visible text", "Full assistant answer", {
      kind: "ophel_notSourceAnchor",
      navigationId: "chatgpt-message:user-42",
      messageId: "user-42",
      turnIndex: 0
    })
  ];
  const nativeTurns = turnsFromOphelNavigationSeeds([
    { index: 0, text: "Updated native text for the same message", messageId: "user-42" },
    { index: 1, text: "Prompt outside DOM", messageId: "user-43" }
  ]);

  const merged = mergeOphelNavigationTurns(existing, nativeTurns);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].assistantText, "Full assistant answer");
  assert.equal(merged[0].userText, "Updated native text for the same message");
  assert.equal(merged[0].navigation?.navigationId, "chatgpt-message:user-42");
  assert.equal(merged[1].userText, "Prompt outside DOM");
});

test("ChatGPT native placeholders do not bind to API turns by position when prompt text differs", async () => {
  const { mergeOphelNavigationTurns, turnsFromOphelNavigationSeeds } = await loadNavigationModule();
  const existing = [
    turn("turn-0", 0, "Full API user 0", "Full API answer 0", {
      kind: "ophel_notSourceAnchor",
      site: "chatgpt",
      navigationId: "chatgpt-message:api-user-0",
      messageId: "api-user-0",
      turnIndex: 0
    }),
    turn("turn-1", 1, "Full API user 1", "Full API answer 1", {
      kind: "ophel_notSourceAnchor",
      site: "chatgpt",
      navigationId: "chatgpt-message:api-user-1",
      messageId: "api-user-1",
      turnIndex: 1
    })
  ];
  const nativeTurns = turnsFromOphelNavigationSeeds([
    { index: 0, text: "Native TOC user 0" },
    { index: 1, text: "Native TOC user 1" }
  ]);

  const merged = mergeOphelNavigationTurns(existing, nativeTurns);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].assistantText, "Full API answer 0");
  assert.equal(merged[1].assistantText, "Full API answer 1");
  assert.equal(merged[0].userText, "Full API user 0");
  assert.equal(merged[1].userText, "Full API user 1");
  assert.equal(merged[0].navigation?.navigationId, "chatgpt-message:api-user-0");
  assert.equal(merged[1].navigation?.navigationId, "chatgpt-message:api-user-1");
});

test("ChatGPT native navigation cannot create graph turns when expansion is disabled", async () => {
  const { mergeOphelNavigationTurns, turnsFromOphelNavigationSeeds } = await loadNavigationModule();
  const nativeTurns = turnsFromOphelNavigationSeeds([
    { index: 0, text: "Repeated navigation prompt" },
    { index: 1, text: "Repeated navigation prompt" }
  ]);

  assert.deepEqual(mergeOphelNavigationTurns([], nativeTurns, false), []);
});

test("ChatGPT visible entries do not match distant native TOC targets by local viewport index only", async () => {
  const { visibleEntryMatchesNavigation } = await loadNavigationModule();

  assert.equal(
    visibleEntryMatchesNavigation(
      { index: 0, text: "Currently visible prompt", messageId: undefined, turnId: undefined },
      {
        kind: "ophel_notSourceAnchor",
        site: "chatgpt",
        navigationId: "chatgpt-native-user-query:0:far-away",
        nativeTocIndex: 0,
        textHash: hashText("Far away prompt"),
        userPreview: "Far away prompt"
      }
    ),
    false
  );
});

test("ChatGPT native TOC remount matching uses text after activation, not local viewport index", async () => {
  const { nativeTocActivatedEntryMatchesNavigation } = await loadNavigationModule();

  assert.equal(
    nativeTocActivatedEntryMatchesNavigation(
      { index: 0, text: "Far away prompt", messageId: undefined, turnId: undefined },
      {
        kind: "ophel_notSourceAnchor",
        site: "chatgpt",
        navigationId: "chatgpt-native-user-query:42:far-away",
        nativeTocIndex: 42,
        textHash: hashText("Far away prompt"),
        userPreview: "Far away prompt"
      }
    ),
    true
  );
  assert.equal(
    nativeTocActivatedEntryMatchesNavigation(
      { index: 0, text: "Different visible prompt", messageId: undefined, turnId: undefined },
      {
        kind: "ophel_notSourceAnchor",
        site: "chatgpt",
        navigationId: "chatgpt-native-user-query:42:far-away",
        nativeTocIndex: 42,
        textHash: hashText("Far away prompt"),
        userPreview: "Far away prompt"
      }
    ),
    false
  );
});

test("ChatGPT native TOC can recover hidden Prompt labels from sibling title text", async () => {
  const { resolveNativeTocText } = await loadNavigationModule();

  assert.equal(
    resolveNativeTocText(
      { ariaLabel: "Prompt 2", text: "", title: "" },
      ["First user question", "Second user question"],
      1
    ),
    "Second user question"
  );
  assert.equal(
    resolveNativeTocText({ ariaLabel: "Ask about TurnMap", text: "", title: "" }, [], 0),
    "Ask about TurnMap"
  );
});
