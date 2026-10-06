import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hashText } from "../src/shared/hash.ts";

function claudeMessage({
  uuid,
  sender,
  text,
  index,
  parentMessageUuid = null,
  editedAt = null,
  deletedAt = null
}) {
  return {
    uuid,
    sender,
    index,
    parent_message_uuid: parentMessageUuid,
    edited_at: editedAt,
    deleted_at: deletedAt,
    content: [{ type: "text", text }]
  };
}

function conversationBody({
  conversationId = "11111111-1111-4111-8111-111111111111",
  currentLeafMessageUuid,
  messages
}) {
  return JSON.stringify({
    uuid: conversationId,
    current_leaf_message_uuid: currentLeafMessageUuid,
    chat_messages: messages
  });
}

const conversationUrl =
  "https://claude.ai/api/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/chat_conversations/11111111-1111-4111-8111-111111111111?tree=True&rendering_mode=messages&render_all_tools=true";

function mountedTurn(index, userText, assistantText = "No text response", userMessageId = `mounted-${index}`) {
  return {
    id: `mounted-turn-${index}`,
    turnIndex: index,
    userText,
    assistantText,
    extractedAt: 1,
    sourceAnchor: {
      turnIndex: index,
      userMessageId,
      assistantMessageId: `mounted-assistant-${index}`,
      userHash: hashText(userText),
      assistantHash: hashText(assistantText),
      userPreview: userText,
      assistantPreview: assistantText
    }
  };
}

test("Claude conversation JSON yields a complete strong-identity user index without scrolling", async () => {
  const { parseClaudeConversationResponse } = await import(
    "../src/content/claude-native-navigation.ts"
  );
  const body = conversationBody({
    currentLeafMessageUuid: "assistant-3",
    messages: [
      claudeMessage({ uuid: "user-1", sender: "human", text: "Repeat", index: 0 }),
      claudeMessage({
        uuid: "assistant-1",
        sender: "assistant",
        text: "First",
        index: 1,
        parentMessageUuid: "user-1"
      }),
      claudeMessage({
        uuid: "user-2",
        sender: "human",
        text: "Repeat",
        index: 2,
        parentMessageUuid: "assistant-1"
      }),
      claudeMessage({
        uuid: "assistant-2",
        sender: "assistant",
        text: "Second",
        index: 3,
        parentMessageUuid: "user-2"
      }),
      claudeMessage({
        uuid: "user-3",
        sender: "human",
        text: "Edited",
        index: 4,
        parentMessageUuid: "assistant-2",
        editedAt: "2026-07-13T08:00:00.000Z"
      }),
      claudeMessage({
        uuid: "assistant-3",
        sender: "assistant",
        text: "Third",
        index: 5,
        parentMessageUuid: "user-3"
      })
    ]
  });

  const [snapshot] = parseClaudeConversationResponse(conversationUrl, body);

  assert.equal(snapshot.conversationId, "11111111-1111-4111-8111-111111111111");
  assert.equal(snapshot.branchId, "assistant-3");
  assert.equal(snapshot.turns.length, 3);
  assert.deepEqual(snapshot.turns.map((turn) => turn.userText), ["Repeat", "Repeat", "Edited"]);
  assert.deepEqual(snapshot.turns.map((turn) => turn.navigation.messageId), ["user-1", "user-2", "user-3"]);
  assert.equal(snapshot.turns[1].navigation.parentMessageId, "assistant-1");
  assert.ok(snapshot.turns.every((turn) => turn.navigation.branchId === "assistant-3"));
  assert.equal(new Set(snapshot.turns.map((turn) => turn.navigation.navigationId)).size, 3);
  assert.ok(snapshot.turns.every((turn) => turn.navigation.identitySource === "native-message-id"));

  const source = readFileSync(new URL("../src/content/claude-native-navigation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /scrollTo\(|scrollBy\(|scrollTop\s*=|scrollIntoView\(/);
});

test("Claude active branches retain edit and retry relationships by UUID", async () => {
  const { parseClaudeConversationResponse } = await import(
    "../src/content/claude-native-navigation.ts"
  );
  const messages = [
    claudeMessage({ uuid: "user-root", sender: "human", text: "Start", index: 0 }),
    claudeMessage({
      uuid: "assistant-root",
      sender: "assistant",
      text: "Root answer",
      index: 1,
      parentMessageUuid: "user-root"
    }),
    claudeMessage({
      uuid: "user-original",
      sender: "human",
      text: "Explain this",
      index: 2,
      parentMessageUuid: "assistant-root"
    }),
    claudeMessage({
      uuid: "assistant-original",
      sender: "assistant",
      text: "Original answer",
      index: 3,
      parentMessageUuid: "user-original"
    }),
    claudeMessage({
      uuid: "user-edited",
      sender: "human",
      text: "Explain this precisely",
      index: 2,
      parentMessageUuid: "assistant-root",
      editedAt: "2026-07-13T08:00:00.000Z"
    }),
    claudeMessage({
      uuid: "assistant-retry-a",
      sender: "assistant",
      text: "First retry",
      index: 3,
      parentMessageUuid: "user-edited"
    }),
    claudeMessage({
      uuid: "assistant-retry-b",
      sender: "assistant",
      text: "Selected retry",
      index: 3,
      parentMessageUuid: "user-edited"
    })
  ];

  const original = parseClaudeConversationResponse(
    conversationUrl,
    conversationBody({ currentLeafMessageUuid: "assistant-original", messages })
  )[0];
  const retry = parseClaudeConversationResponse(
    conversationUrl,
    conversationBody({ currentLeafMessageUuid: "assistant-retry-b", messages })
  )[0];

  assert.deepEqual(original.turns.map((turn) => turn.navigation.messageId), ["user-root", "user-original"]);
  assert.equal(original.turns[1].navigation.turnId, "assistant-original");
  assert.deepEqual(retry.turns.map((turn) => turn.navigation.messageId), ["user-root", "user-edited"]);
  assert.equal(retry.turns[1].navigation.turnId, "assistant-retry-b");
  assert.equal(retry.turns[1].assistantText, "Selected retry");
});

test("Claude native index replaces stale branches and isolates SPA conversations", async () => {
  const { ClaudeNativeIndex } = await import("../src/content/claude-native-navigation.ts");
  const index = new ClaudeNativeIndex();
  const baseMessages = [
    claudeMessage({ uuid: "user-root", sender: "human", text: "Start", index: 0 }),
    claudeMessage({
      uuid: "assistant-root",
      sender: "assistant",
      text: "Root answer",
      index: 1,
      parentMessageUuid: "user-root"
    })
  ];

  index.activate("11111111-1111-4111-8111-111111111111");
  index.ingest(
    conversationUrl,
    conversationBody({
      currentLeafMessageUuid: "assistant-old",
      messages: [
        ...baseMessages,
        claudeMessage({
          uuid: "user-old",
          sender: "human",
          text: "Old branch",
          index: 2,
          parentMessageUuid: "assistant-root"
        }),
        claudeMessage({
          uuid: "assistant-old",
          sender: "assistant",
          text: "Old answer",
          index: 3,
          parentMessageUuid: "user-old"
        })
      ]
    })
  );
  index.ingest(
    conversationUrl,
    conversationBody({
      currentLeafMessageUuid: "assistant-new",
      messages: [
        ...baseMessages,
        claudeMessage({
          uuid: "user-new",
          sender: "human",
          text: "New branch",
          index: 2,
          parentMessageUuid: "assistant-root"
        }),
        claudeMessage({
          uuid: "assistant-new",
          sender: "assistant",
          text: "New answer",
          index: 3,
          parentMessageUuid: "user-new"
        })
      ]
    })
  );

  assert.deepEqual(index.getActiveTurns().map((turn) => turn.userText), ["Start", "New branch"]);
  assert.equal(index.getActiveBranchId(), "assistant-new");

  index.activate("22222222-2222-4222-8222-222222222222");
  assert.deepEqual(index.getActiveTurns(), []);
});

test("Claude native index is grow-only across transient partial captures on the same branch", async () => {
  const { ClaudeNativeIndex } = await import("../src/content/claude-native-navigation.ts");
  const index = new ClaudeNativeIndex();
  const fullMessages = [
    claudeMessage({ uuid: "user-1", sender: "human", text: "First", index: 0 }),
    claudeMessage({
      uuid: "assistant-1",
      sender: "assistant",
      text: "First answer",
      index: 1,
      parentMessageUuid: "user-1"
    }),
    claudeMessage({
      uuid: "user-2",
      sender: "human",
      text: "Second",
      index: 2,
      parentMessageUuid: "assistant-1"
    }),
    claudeMessage({
      uuid: "assistant-2",
      sender: "assistant",
      text: "Second answer",
      index: 3,
      parentMessageUuid: "user-2"
    })
  ];

  index.activate("11111111-1111-4111-8111-111111111111");
  index.ingest(
    conversationUrl,
    conversationBody({ currentLeafMessageUuid: "assistant-2", messages: fullMessages })
  );
  index.ingest(
    conversationUrl,
    conversationBody({ currentLeafMessageUuid: "assistant-2", messages: fullMessages.slice(0, 2) })
  );

  assert.deepEqual(index.getActiveTurns().map((turn) => turn.userText), ["First", "Second"]);
});

test("Claude native index removes explicit user-message tombstones without treating partial absence as deletion", async () => {
  const { ClaudeNativeIndex } = await import("../src/content/claude-native-navigation.ts");
  const index = new ClaudeNativeIndex();
  const firstPair = [
    claudeMessage({ uuid: "user-1", sender: "human", text: "Keep", index: 0 }),
    claudeMessage({
      uuid: "assistant-1",
      sender: "assistant",
      text: "Kept answer",
      index: 1,
      parentMessageUuid: "user-1"
    })
  ];
  const secondPair = [
    claudeMessage({
      uuid: "user-2",
      sender: "human",
      text: "Delete",
      index: 2,
      parentMessageUuid: "assistant-1"
    }),
    claudeMessage({
      uuid: "assistant-2",
      sender: "assistant",
      text: "Deleted answer",
      index: 3,
      parentMessageUuid: "user-2"
    })
  ];

  index.activate("11111111-1111-4111-8111-111111111111");
  index.ingest(
    conversationUrl,
    conversationBody({ currentLeafMessageUuid: "assistant-2", messages: [...firstPair, ...secondPair] })
  );
  index.ingest(
    conversationUrl,
    conversationBody({
      currentLeafMessageUuid: "assistant-2",
      messages: [
        ...firstPair,
        { ...secondPair[0], deleted_at: "2026-07-13T09:00:00.000Z" },
        { ...secondPair[1], deleted_at: "2026-07-13T09:00:00.000Z" }
      ]
    })
  );

  assert.deepEqual(index.getActiveTurns().map((turn) => turn.userText), ["Keep"]);
});

test("Claude UUID binding survives DOM remounts and resolves the exact mounted target", async () => {
  const { bindClaudeNativeTurns, findClaudeMountedTurnIndex, parseClaudeConversationResponse } = await import(
    "../src/content/claude-native-navigation.ts"
  );
  const nativeTurns = parseClaudeConversationResponse(
    conversationUrl,
    conversationBody({
      currentLeafMessageUuid: "assistant-2",
      messages: [
        claudeMessage({ uuid: "user-1", sender: "human", text: "Repeat", index: 0 }),
        claudeMessage({
          uuid: "assistant-1",
          sender: "assistant",
          text: "First",
          index: 1,
          parentMessageUuid: "user-1"
        }),
        claudeMessage({
          uuid: "user-2",
          sender: "human",
          text: "Repeat",
          index: 2,
          parentMessageUuid: "assistant-1"
        }),
        claudeMessage({
          uuid: "assistant-2",
          sender: "assistant",
          text: "Second",
          index: 3,
          parentMessageUuid: "user-2"
        })
      ]
    })
  )[0].turns;
  const firstMount = [
    mountedTurn(0, "Repeat", "First mounted", "user-1"),
    mountedTurn(1, "Repeat", "Second mounted", "user-2")
  ];
  const remount = [
    mountedTurn(8, "Repeat", "First remounted", "user-1"),
    mountedTurn(9, "Repeat", "Second remounted", "user-2")
  ];

  assert.equal(bindClaudeNativeTurns(nativeTurns, firstMount).complete, true);
  assert.equal(bindClaudeNativeTurns(nativeTurns, remount).complete, true);
  assert.equal(findClaudeMountedTurnIndex(nativeTurns[1].navigation, nativeTurns, remount), 1);
  assert.equal(bindClaudeNativeTurns(nativeTurns, remount).turns[1].assistantText, "Second remounted");
});

test("Claude partial DOM windows are never positionally guessed and streaming suffixes append safely", async () => {
  const { bindClaudeNativeTurns, findClaudeMountedTurnIndex, parseClaudeConversationResponse } = await import(
    "../src/content/claude-native-navigation.ts"
  );
  const nativeTurns = parseClaudeConversationResponse(
    conversationUrl,
    conversationBody({
      currentLeafMessageUuid: "assistant-2",
      messages: [
        claudeMessage({ uuid: "user-1", sender: "human", text: "Repeat", index: 0 }),
        claudeMessage({
          uuid: "assistant-1",
          sender: "assistant",
          text: "First",
          index: 1,
          parentMessageUuid: "user-1"
        }),
        claudeMessage({
          uuid: "user-2",
          sender: "human",
          text: "Repeat",
          index: 2,
          parentMessageUuid: "assistant-1"
        }),
        claudeMessage({
          uuid: "assistant-2",
          sender: "assistant",
          text: "Second",
          index: 3,
          parentMessageUuid: "user-2"
        })
      ]
    })
  )[0].turns;
  const partialWindow = [mountedTurn(7, "Repeat", "Second", "unknown-window-id")];

  assert.equal(findClaudeMountedTurnIndex(nativeTurns[1].navigation, nativeTurns, partialWindow), null);
  assert.equal(bindClaudeNativeTurns(nativeTurns, partialWindow).complete, false);

  const fullWithStreamingSuffix = [
    mountedTurn(0, "Repeat", "First"),
    mountedTurn(1, "Repeat", "Second"),
    mountedTurn(2, "Streaming question", "Partial answer")
  ];
  const binding = bindClaudeNativeTurns(nativeTurns, fullWithStreamingSuffix);
  assert.equal(binding.complete, false);
  assert.equal(binding.turns.length, 3);
  assert.equal(binding.turns[2].userText, "Streaming question");
  assert.equal(binding.turns[2].navigation, undefined);
});

test("Claude conversation URL parsing accepts only chat UUID routes", async () => {
  const { claudeConversationIdFromUrl } = await import("../src/content/claude-native-navigation.ts");

  assert.equal(
    claudeConversationIdFromUrl("https://claude.ai/chat/11111111-1111-4111-8111-111111111111"),
    "11111111-1111-4111-8111-111111111111"
  );
  assert.equal(claudeConversationIdFromUrl("https://claude.ai/new"), "");
  assert.equal(claudeConversationIdFromUrl("not a url"), "");
});

test("Claude adapter prefers the passive UUID index and fails unmounted targets explicitly", () => {
  const source = readFileSync(new URL("../src/content/conversation-adapters.ts", import.meta.url), "utf8");

  assert.match(source, /createClaudeAdapter/);
  assert.match(source, /claudeNativeIndex\.getActiveTurns\(\)/);
  assert.match(source, /bindClaudeNativeTurns/);
  assert.match(source, /findClaudeMountedTurnIndex/);
  assert.match(source, /profile\.site\.id\s*===\s*"claude"/);
  assert.match(source, /The Claude target is not deterministically mounted/);
  assert.doesNotMatch(source, /requestClaudeVirtualTarget|scroll search.*Claude/i);
});

test("Claude observer passively captures exact conversation detail responses at document_start", () => {
  const manifestSource = readFileSync(new URL("../src/manifest.ts", import.meta.url), "utf8");
  const observerSource = readFileSync(
    new URL("../public/claude-conversation-observer.js", import.meta.url),
    "utf8"
  );

  assert.match(manifestSource, /claude-conversation-observer\.js/);
  assert.match(manifestSource, /run_at:\s*"document_start"/);
  assert.match(manifestSource, /world:\s*"MAIN"/);
  assert.match(observerSource, /chat_conversations/);
  assert.match(observerSource, /turnmap-claude-observer/);
  assert.match(observerSource, /type\s*===\s*"flush"/);
  assert.match(observerSource, /method\s*===\s*"GET"/);
  assert.match(observerSource, /window\.XMLHttpRequest\.prototype\s*=\s*OriginalXMLHttpRequest\.prototype/);
  assert.match(observerSource, /Object\.setPrototypeOf\(window\.XMLHttpRequest,\s*OriginalXMLHttpRequest\)/);
  assert.doesNotMatch(observerSource, /\/completion["'`]/);
  assert.doesNotMatch(observerSource, /scrollTo\(|scrollBy\(|scrollTop\s*=|scrollIntoView\(/);
});
