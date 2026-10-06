import assert from "node:assert/strict";
import test from "node:test";

import { hashText } from "../src/shared/hash.ts";
import {
  favoriteFromTurn,
  floatingFavoriteIdentity,
  isTurnFavorited,
  resolveFloatingFavorites,
  toggleTurnFavorite
} from "../src/content/floating-favorites.ts";

function turn(index, userText, navigationId = `chatgpt-message:user-${index}`) {
  return {
    id: `turn-${index}`,
    turnIndex: index,
    userText,
    assistantText: "No assistant text captured",
    extractedAt: 1,
    navigation: {
      kind: "ophel_notSourceAnchor",
      site: "chatgpt",
      navigationId,
      turnIndex: index
    },
    sourceAnchor: {
      turnIndex: index,
      userMessageId: `user-${index}`,
      userHash: hashText(userText),
      assistantHash: hashText("No assistant text captured"),
      userPreview: userText,
      assistantPreview: "No assistant text captured"
    }
  };
}

test("floating favorites use native navigation identity, not repeated text or turn index", () => {
  const first = turn(0, "Repeat this question", "chatgpt-native-user-query:0:repeat");
  const second = turn(7, "Repeat this question", "chatgpt-native-user-query:7:repeat");

  assert.notEqual(floatingFavoriteIdentity(first), floatingFavoriteIdentity(second));
  assert.equal(floatingFavoriteIdentity(first), "navigation:chatgpt-native-user-query:0:repeat");
});

test("floating favorites can be toggled for a user-only turn and retain its native jump target", () => {
  const userOnlyTurn = turn(2, "Save this before the answer finishes");
  const favorited = toggleTurnFavorite(userOnlyTurn, [], 123);

  assert.equal(favorited.length, 1);
  assert.equal(isTurnFavorited(userOnlyTurn, favorited), true);
  assert.equal(favorited[0].navigation?.navigationId, userOnlyTurn.navigation.navigationId);
  assert.equal(favorited[0].userText, userOnlyTurn.userText);
  assert.deepEqual(toggleTurnFavorite(userOnlyTurn, favorited, 124), []);
});

test("floating favorites retain missing turns and order them by conversation position", () => {
  const late = turn(5, "Later question");
  const early = turn(1, "Earlier question");
  const missing = favoriteFromTurn(turn(3, "Deleted question"), 10);
  const favorites = [favoriteFromTurn(late, 30), missing, favoriteFromTurn(early, 20)];

  const resolved = resolveFloatingFavorites(favorites, [early, late]);

  assert.deepEqual(
    resolved.map(({ favorite, turn }) => [favorite.userText, Boolean(turn)]),
    [
      ["Earlier question", true],
      ["Deleted question", false],
      ["Later question", true]
    ]
  );
});
