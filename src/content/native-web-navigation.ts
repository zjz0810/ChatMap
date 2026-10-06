import type { JumpToTurnResult, NativeConversationCapabilities, Turn, TurnNavigation } from "../shared/types";
import {
  blocksToTurns,
  extractBlocksFromDocument,
  getWebChatScrollElement,
  normalizeWebTurnIndexes,
  revealWebTurnElement,
  type WebConversationProfile
} from "./web-adapter-core.ts";

const SYNTHETIC_MOUNTED_ID = /^(?:user|assistant)-\d+-[a-z0-9]+$/i;
const EMPTY_ASSISTANT_REPLY = "No text response";

export const CHATGPT_NATIVE_CAPABILITIES: NativeConversationCapabilities = {
  userIndex: "verified-native",
  targetIdentity: "verified-native",
  directJump: "verified-native",
  shellRevive: "bounded-native",
  assistantText: "best-effort",
  limitations: ["Assistant text can remain partial when the page does not expose it cheaply."]
};

export const NATIVE_WEB_DOM_CAPABILITIES: NativeConversationCapabilities = {
  userIndex: "mounted-dom",
  targetIdentity: "mounted-dom",
  directJump: "mounted-only",
  shellRevive: "unavailable",
  assistantText: "best-effort",
  limitations: [
    "The index contains only turns currently mounted by the site.",
    "An unmounted target fails explicitly instead of triggering a scroll or text-search fallback."
  ]
};

function nativeWebNavigation(siteId: string, turn: Turn, mountedOccurrence: number): TurnNavigation {
  const messageId = turn.sourceAnchor.userMessageId ?? `user-${turn.turnIndex}-${turn.sourceAnchor.userHash}`;
  const identitySource = SYNTHETIC_MOUNTED_ID.test(messageId) ? "mounted-dom-id" : "native-message-id";
  const navigationId =
    identitySource === "native-message-id"
      ? `${siteId}-message:${messageId}`
      : `${siteId}-mounted-user:${turn.sourceAnchor.userHash}:${mountedOccurrence}`;

  return {
    kind: "ophel_notSourceAnchor",
    site: siteId,
    navigationId,
    identitySource,
    messageId,
    turnIndex: turn.turnIndex,
    textHash: turn.sourceAnchor.userHash
  };
}

export function attachNativeWebNavigation(turns: Turn[], siteId: string): Turn[] {
  const mountedOccurrences = new Map<string, number>();
  return turns.map((turn) => {
    const messageId = turn.sourceAnchor.userMessageId ?? "";
    const mountedOccurrence = mountedOccurrences.get(turn.sourceAnchor.userHash) ?? 0;
    if (SYNTHETIC_MOUNTED_ID.test(messageId)) {
      mountedOccurrences.set(turn.sourceAnchor.userHash, mountedOccurrence + 1);
    }

    return {
      ...turn,
      navigation: nativeWebNavigation(siteId, turn, mountedOccurrence)
    };
  });
}

function shouldUseIncomingTurn(existing: Turn, incoming: Turn): boolean {
  if (existing.assistantText === EMPTY_ASSISTANT_REPLY && incoming.assistantText !== EMPTY_ASSISTANT_REPLY) return true;
  if (!existing.sourceAnchor.assistantMessageId && incoming.sourceAnchor.assistantMessageId) return true;
  return incoming.assistantText.length > existing.assistantText.length + 16;
}

export function mergeNativeWebTurns(existingTurns: Turn[], incomingTurns: Turn[]): Turn[] {
  const merged = new Map<string, Turn>();

  for (const turn of [...existingTurns, ...incomingTurns]) {
    const key = turn.navigation?.navigationId;
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing || shouldUseIncomingTurn(existing, turn)) merged.set(key, turn);
  }

  return normalizeWebTurnIndexes([...merged.values()]).map((turn) => ({
    ...turn,
    navigation: turn.navigation
      ? {
          ...turn.navigation,
          turnIndex: turn.turnIndex
        }
      : undefined
  }));
}

export async function resolveNativeWebTarget(
  target: TurnNavigation,
  profile: WebConversationProfile
): Promise<JumpToTurnResult> {
  if (target.site !== profile.site.id) {
    return { ok: false, reason: `The navigation identity belongs to ${target.site}, not ${profile.site.displayName}.` };
  }

  const userBlocks = extractBlocksFromDocument(profile).filter((block) => block.role === "user" && block.element);
  const candidateTurns = attachNativeWebNavigation(blocksToTurns(userBlocks), profile.site.id);
  for (let index = 0; index < candidateTurns.length; index += 1) {
    const block = userBlocks[index];
    const candidate = candidateTurns[index];

    if (candidate.navigation?.navigationId === target.navigationId && block.element) {
      revealWebTurnElement(block.element, getWebChatScrollElement(profile));
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: `The original ${profile.site.displayName} turn is not mounted. TurnMap did not use text matching or scroll search.`
  };
}
