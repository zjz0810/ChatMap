import type { Turn } from "../shared/types";
import { mergeChatGptWindows, reindexChatGptTurns } from "../shared/chatgpt-turn-order.ts";
import { sourceAnchorMatches } from "./graph/source-anchors.ts";

export type TurnUpdateMode = "replace" | "refresh" | "refresh-index";

const CHATGPT_ASSISTANT_PLACEHOLDERS = new Set(["No text response", "无文字回复", "No assistant text captured"]);

function chatGptStableIdentity(turn: Turn): string | undefined {
  const explicitId = turn.sourceAnchor.userMessageId ?? turn.navigation?.messageId ?? turn.navigation?.turnId;
  if (explicitId) return `id:${explicitId}`;
  const navigationId = turn.navigation?.navigationId;
  return navigationId && !navigationId.startsWith("chatgpt-native-user-query:")
    ? `nav:${navigationId}`
    : undefined;
}

function normalizedPrompt(turn: Turn): string {
  return turn.userText.replace(/\s+/g, " ").trim();
}

/** Reorder a sufficiently covering ChatGPT scan, retaining any missed turns. */
export function reconcileChatGptIndexOrder(
  existingTurns: Turn[],
  incomingTurns: Turn[],
  scanComplete: boolean
): Turn[] | null {
  if (incomingTurns.some((turn) => turn.navigation?.site !== "chatgpt")) return null;
  if (existingTurns.length === 0) return reindexChatGptTurns(incomingTurns);
  // A scan can reach every message but still fail the scroll-stability check.
  // Accept that scan when it covers all known turns; when the scanner confirms
  // completion, tolerate a small virtualized-list gap and retain those turns.
  const minimumCoverage = scanComplete ? Math.ceil(existingTurns.length * 0.9) : existingTurns.length;
  if (incomingTurns.length < minimumCoverage) return null;

  const unmatched = new Set(existingTurns.map((_turn, index) => index));
  const ordered = incomingTurns.map((incoming) => {
    const incomingIdentity = chatGptStableIdentity(incoming);
    let match = incomingIdentity
      ? [...unmatched].find((index) => chatGptStableIdentity(existingTurns[index]) === incomingIdentity)
      : undefined;
    if (match === undefined) {
      const prompt = normalizedPrompt(incoming);
      if (prompt) match = [...unmatched].find((index) => normalizedPrompt(existingTurns[index]) === prompt);
    }

    if (match === undefined) {
      return { turn: incoming, existingIndex: undefined as number | undefined };
    }

    unmatched.delete(match);
    return { turn: mergeChatGptWindows([existingTurns[match]], [incoming])[0], existingIndex: match };
  });

  // One id-less prompt edit in an otherwise positionally identical scan is the
  // same turn. Preserve its node id instead of treating it as a new prompt.
  if (ordered.length === existingTurns.length && unmatched.size === 1) {
    const unmatchedExistingIndex = [...unmatched][0];
    const unmatchedIncomingIndexes = ordered
      .map((entry, index) => entry.existingIndex === undefined ? index : -1)
      .filter((index) => index >= 0);
    const anchorsStayInPlace = ordered.every((entry, index) =>
      entry.existingIndex === undefined || entry.existingIndex === index
    );
    if (unmatchedIncomingIndexes.length === 1 && anchorsStayInPlace && unmatchedExistingIndex === unmatchedIncomingIndexes[0]) {
      const index = unmatchedIncomingIndexes[0];
      ordered[index] = {
        turn: mergeChatGptWindows([existingTurns[index]], [incomingTurns[index]])[0],
        existingIndex: index
      };
      unmatched.delete(index);
    }
  }

  if (existingTurns.length - unmatched.size < minimumCoverage) return null;

  // Preserve turns omitted by a nearly complete virtualized scan. Place each
  // missing run beside its nearest surviving old-order anchor.
  const unmatchedIndexes = [...unmatched].sort((left, right) => left - right);
  for (let cursor = 0; cursor < unmatchedIndexes.length;) {
    const start = unmatchedIndexes[cursor];
    const group = [start];
    cursor += 1;
    while (cursor < unmatchedIndexes.length && unmatchedIndexes[cursor] === group.at(-1)! + 1) {
      group.push(unmatchedIndexes[cursor]);
      cursor += 1;
    }

    const nextMatchedIndex = existingTurns.findIndex((_turn, index) => index > group.at(-1)! &&
      ordered.some((entry) => entry.existingIndex === index));
    const previousMatchedIndex = [...existingTurns.keys()].reverse().find((index) => index < start &&
      ordered.some((entry) => entry.existingIndex === index));
    const nextOutputIndex = nextMatchedIndex === -1 ? -1 : ordered.findIndex((entry) => entry.existingIndex === nextMatchedIndex);
    const previousOutputIndex = previousMatchedIndex === undefined
      ? -1
      : ordered.findIndex((entry) => entry.existingIndex === previousMatchedIndex);
    const insertionIndex = nextOutputIndex >= 0 && (previousOutputIndex < 0 || previousOutputIndex < nextOutputIndex)
      ? nextOutputIndex
      : previousOutputIndex >= 0
        ? previousOutputIndex + 1
        : ordered.length;
    ordered.splice(insertionIndex, 0, ...group.map((index) => ({ turn: existingTurns[index], existingIndex: index })));
  }

  return reindexChatGptTurns(ordered.map((entry) => entry.turn));
}

function sameTurn(left: Turn, right: Turn): boolean {
  const sameNavigationIdentity =
    Boolean(left.navigation?.navigationId) &&
    left.navigation?.site === right.navigation?.site &&
    left.navigation?.navigationId === right.navigation?.navigationId;
  const bothChatGptTurns =
    left.navigation?.site === "chatgpt" && right.navigation?.site === "chatgpt";
  const sameChatGptUserMessage =
    Boolean(left.sourceAnchor.userMessageId) &&
    left.sourceAnchor.userMessageId === right.sourceAnchor.userMessageId;
  if (bothChatGptTurns && left.turnIndex !== right.turnIndex) {
    // Hash-only matches can merge repeated prompts from separate turns. Keep
    // cross-index merging limited to stable message identities.
    return sameNavigationIdentity || sameChatGptUserMessage || left.id === right.id;
  }
  const sameChatGptPositionAndPrompt =
    bothChatGptTurns &&
    left.turnIndex === right.turnIndex &&
    left.sourceAnchor.userHash === right.sourceAnchor.userHash;
  return (
    sameNavigationIdentity ||
    sameChatGptUserMessage ||
    sameChatGptPositionAndPrompt ||
    left.id === right.id ||
    sourceAnchorMatches(left.sourceAnchor, right.sourceAnchor)
  );
}

function findTurnIndex(turns: Turn[], target: Turn): number {
  return turns.findIndex((turn) => sameTurn(turn, target));
}

function maxExistingTurnIndex(turns: Turn[]): number {
  return Math.max(-1, ...turns.map((turn) => turn.turnIndex));
}

function mergeSourceAnchorIdentity(existing: Turn, incoming: Turn): Turn["sourceAnchor"] {
  const sourceAnchor = { ...existing.sourceAnchor };
  for (const key of ["userMessageId", "assistantMessageId", "userAttachmentNames"] as const) {
    const value = incoming.sourceAnchor[key];
    if (value !== undefined) sourceAnchor[key] = value as never;
  }
  return sourceAnchor;
}

function mergeTurnIdentity(existing: Turn, incoming: Turn): Turn {
  const sourceAnchor = mergeSourceAnchorIdentity(existing, incoming);
  const navigation = incoming.navigation ?? existing.navigation;
  const createdAt = incoming.createdAt ?? existing.createdAt;
  if (
    JSON.stringify(navigation) === JSON.stringify(existing.navigation) &&
    JSON.stringify(sourceAnchor) === JSON.stringify(existing.sourceAnchor) &&
    createdAt === existing.createdAt
  ) return existing;
  return { ...existing, navigation, sourceAnchor, createdAt };
}

function enrichStreamedPlaceholder(existing: Turn, incoming: Turn): Turn {
  const sameChatGptTurn =
    existing.navigation?.site === "chatgpt" &&
    incoming.navigation?.site === "chatgpt" &&
    (existing.navigation.navigationId === incoming.navigation.navigationId ||
      (existing.turnIndex === incoming.turnIndex &&
        existing.sourceAnchor.userHash === incoming.sourceAnchor.userHash));

  if (sameChatGptTurn) {
    const currentAssistant = existing.assistantText.trim();
    const existingIsPlaceholder = CHATGPT_ASSISTANT_PLACEHOLDERS.has(currentAssistant);
    const assistantGrew =
      incoming.assistantText !== existing.assistantText &&
      (incoming.assistantText.length >= existing.assistantText.length || existingIsPlaceholder);
    const userGrew = incoming.userText.length > existing.userText.length;
    if (!assistantGrew && !userGrew) return mergeTurnIdentity(existing, incoming);
    return {
      ...incoming,
      id: existing.id,
      userText: userGrew ? incoming.userText : existing.userText,
      assistantText: assistantGrew ? incoming.assistantText : existing.assistantText,
      sourceAnchor: {
        ...existing.sourceAnchor,
        ...incoming.sourceAnchor,
        userMessageId: incoming.sourceAnchor.userMessageId ?? existing.sourceAnchor.userMessageId,
        assistantMessageId: assistantGrew
          ? incoming.sourceAnchor.assistantMessageId ?? existing.sourceAnchor.assistantMessageId
          : existing.sourceAnchor.assistantMessageId ?? incoming.sourceAnchor.assistantMessageId,
        userAttachmentNames: incoming.sourceAnchor.userAttachmentNames ?? existing.sourceAnchor.userAttachmentNames
      },
      navigation: incoming.navigation ?? existing.navigation
    };
  }

  if (incoming.navigation?.site === "chatgpt") {
    return mergeTurnIdentity(existing, incoming);
  }

  if (
    CHATGPT_ASSISTANT_PLACEHOLDERS.has(existing.assistantText.trim()) &&
    !CHATGPT_ASSISTANT_PLACEHOLDERS.has(incoming.assistantText.trim())
  ) {
    return incoming;
  }
  return existing;
}

function appendAfter(result: Turn[], anchor: Turn, incoming: Turn): void {
  const anchorIndex = findTurnIndex(result, anchor);
  if (anchorIndex === -1) {
    result.push(incoming);
    return;
  }
  result.splice(anchorIndex + 1, 0, incoming);
}

function insertBefore(result: Turn[], anchor: Turn, incoming: Turn): void {
  const anchorIndex = findTurnIndex(result, anchor);
  if (anchorIndex === -1) {
    result.push(incoming);
    return;
  }
  result.splice(anchorIndex, 0, incoming);
}

export function mergeTurnUpdates(
  existingTurns: Turn[],
  incomingTurns: Turn[],
  mode: TurnUpdateMode
): { turns: Turn[]; added: number } {
  if (incomingTurns.some((turn) => turn.navigation?.site === "chatgpt")) {
    const turns = mode === "replace"
      ? reindexChatGptTurns(incomingTurns)
      : mergeChatGptWindows(existingTurns, incomingTurns);
    return { turns, added: Math.max(0, turns.length - existingTurns.length) };
  }
  if (mode === "replace" || existingTurns.length === 0) {
    const turns = incomingTurns;
    return { turns, added: Math.max(0, turns.length - existingTurns.length) };
  }

  const result = existingTurns.map((existing) => {
    const incoming = incomingTurns.find((candidate) => sameTurn(existing, candidate));
    return incoming ? enrichStreamedPlaceholder(existing, incoming) : existing;
  });
  let added = 0;

  if (mode === "refresh") {
    const lastMatchedIncomingIndex = incomingTurns.reduce(
      (latest, turn, index) => (findTurnIndex(existingTurns, turn) === -1 ? latest : index),
      -1
    );
    const maxExistingIndex = maxExistingTurnIndex(existingTurns);

    incomingTurns.forEach((turn, index) => {
      if (findTurnIndex(result, turn) !== -1) return;
      const looksLikeTailTurn = lastMatchedIncomingIndex === -1
        ? turn.turnIndex > maxExistingIndex
        : index > lastMatchedIncomingIndex;
      if (!looksLikeTailTurn) return;
      result.push(turn);
      added += 1;
    });

    return { turns: result, added };
  }

  incomingTurns.forEach((turn, index) => {
    if (findTurnIndex(result, turn) !== -1) return;

    const previousResultTurn = [...incomingTurns.slice(0, index)]
      .reverse()
      .find((candidate) => findTurnIndex(result, candidate) !== -1);
    const nextExisting = incomingTurns
      .slice(index + 1)
      .find((candidate) => findTurnIndex(existingTurns, candidate) !== -1);

    if (previousResultTurn) {
      appendAfter(result, previousResultTurn, turn);
    } else if (nextExisting) {
      insertBefore(result, nextExisting, turn);
    } else {
      result.push(turn);
    }
    added += 1;
  });

  return { turns: result, added };
}
