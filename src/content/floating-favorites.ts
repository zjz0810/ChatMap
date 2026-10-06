import type { SourceAnchor, Turn, TurnNavigation } from "../shared/types";

export const FLOATING_FAVORITES_STORAGE_KEY = "turnmap.floatingNavigator.favorites";
const FAVORITES_STORAGE_VERSION = 1;

export type FloatingFavorite = {
  identity: string;
  turnIndex: number;
  userText: string;
  navigation?: TurnNavigation;
  sourceAnchor: SourceAnchor;
  savedAt: number;
};

type FloatingFavoritesStorage = {
  version: typeof FAVORITES_STORAGE_VERSION;
  conversations: Record<string, FloatingFavorite[]>;
};

export type ResolvedFloatingFavorite = {
  favorite: FloatingFavorite;
  turn?: Turn;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function copySourceAnchor(anchor: SourceAnchor): SourceAnchor {
  return {
    ...anchor,
    userAttachmentNames: anchor.userAttachmentNames ? [...anchor.userAttachmentNames] : undefined
  };
}

function copyNavigation(navigation?: TurnNavigation): TurnNavigation | undefined {
  return navigation ? { ...navigation } : undefined;
}

function sourceAnchorFromUnknown(value: unknown): SourceAnchor | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.turnIndex !== "number" ||
    !Number.isFinite(value.turnIndex) ||
    typeof value.userHash !== "string" ||
    typeof value.assistantHash !== "string" ||
    typeof value.userPreview !== "string" ||
    typeof value.assistantPreview !== "string"
  ) {
    return null;
  }
  return {
    turnIndex: Math.max(0, Math.round(value.turnIndex)),
    userMessageId: typeof value.userMessageId === "string" ? value.userMessageId : undefined,
    assistantMessageId: typeof value.assistantMessageId === "string" ? value.assistantMessageId : undefined,
    userAttachmentNames: Array.isArray(value.userAttachmentNames)
      ? value.userAttachmentNames.filter((name): name is string => typeof name === "string")
      : undefined,
    userHash: value.userHash,
    assistantHash: value.assistantHash,
    userPreview: value.userPreview,
    assistantPreview: value.assistantPreview
  };
}

function navigationFromUnknown(value: unknown): TurnNavigation | undefined {
  if (!isRecord(value) || value.kind !== "ophel_notSourceAnchor" || value.site !== "chatgpt") return undefined;
  if (typeof value.navigationId !== "string" || !value.navigationId.trim()) return undefined;
  return {
    kind: "ophel_notSourceAnchor",
    site: "chatgpt",
    navigationId: value.navigationId,
    messageId: typeof value.messageId === "string" ? value.messageId : undefined,
    turnId: typeof value.turnId === "string" ? value.turnId : undefined,
    nativeTocIndex: typeof value.nativeTocIndex === "number" ? value.nativeTocIndex : undefined,
    turnIndex: typeof value.turnIndex === "number" ? value.turnIndex : undefined,
    textHash: typeof value.textHash === "string" ? value.textHash : undefined,
    userPreview: typeof value.userPreview === "string" ? value.userPreview : undefined
  };
}

function favoriteFromUnknown(value: unknown): FloatingFavorite | null {
  if (!isRecord(value)) return null;
  const sourceAnchor = sourceAnchorFromUnknown(value.sourceAnchor);
  if (
    !sourceAnchor ||
    typeof value.identity !== "string" ||
    !value.identity.trim() ||
    typeof value.turnIndex !== "number" ||
    !Number.isFinite(value.turnIndex) ||
    typeof value.userText !== "string" ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt)
  ) {
    return null;
  }
  return {
    identity: value.identity,
    turnIndex: Math.max(0, Math.round(value.turnIndex)),
    userText: value.userText,
    navigation: navigationFromUnknown(value.navigation),
    sourceAnchor,
    savedAt: value.savedAt
  };
}

function normalizeFavorites(value: unknown): FloatingFavorite[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>();
  return value.flatMap((candidate) => {
    const favorite = favoriteFromUnknown(candidate);
    if (!favorite || known.has(favorite.identity)) return [];
    known.add(favorite.identity);
    return [favorite];
  });
}

function normalizedStorage(value: unknown): FloatingFavoritesStorage {
  const conversations = isRecord(value) && isRecord(value.conversations) ? value.conversations : {};
  return {
    version: FAVORITES_STORAGE_VERSION,
    conversations: Object.fromEntries(
      Object.entries(conversations)
        .filter(([conversationId]) => conversationId.trim())
        .map(([conversationId, favorites]) => [conversationId, normalizeFavorites(favorites)])
        .filter(([, favorites]) => favorites.length > 0)
    )
  };
}

export function floatingFavoriteIdentity(turn: Pick<Turn, "id" | "navigation" | "sourceAnchor">): string {
  const navigationId = turn.navigation?.navigationId?.trim();
  if (navigationId) return `navigation:${navigationId}`;

  const messageId = turn.navigation?.messageId?.trim() || turn.sourceAnchor.userMessageId?.trim();
  if (messageId) return `message:${messageId}`;

  return `source:${turn.sourceAnchor.userHash}:${turn.sourceAnchor.assistantHash || turn.id}`;
}

export function favoriteFromTurn(turn: Turn, savedAt = Date.now()): FloatingFavorite {
  return {
    identity: floatingFavoriteIdentity(turn),
    turnIndex: turn.turnIndex,
    userText: turn.userText,
    navigation: copyNavigation(turn.navigation),
    sourceAnchor: copySourceAnchor(turn.sourceAnchor),
    savedAt
  };
}

export function isTurnFavorited(turn: Turn, favorites: FloatingFavorite[]): boolean {
  const identity = floatingFavoriteIdentity(turn);
  return favorites.some((favorite) => favorite.identity === identity);
}

export function toggleTurnFavorite(turn: Turn, favorites: FloatingFavorite[], savedAt = Date.now()): FloatingFavorite[] {
  const identity = floatingFavoriteIdentity(turn);
  if (favorites.some((favorite) => favorite.identity === identity)) {
    return favorites.filter((favorite) => favorite.identity !== identity);
  }
  return [...favorites, favoriteFromTurn(turn, savedAt)];
}

export function resolveFloatingFavorites(
  favorites: FloatingFavorite[],
  turns: Turn[]
): ResolvedFloatingFavorite[] {
  const turnByIdentity = new Map(turns.map((turn) => [floatingFavoriteIdentity(turn), turn]));
  return favorites
    .map((favorite) => ({ favorite, turn: turnByIdentity.get(favorite.identity) }))
    .sort((left, right) => {
      const leftIndex = left.turn?.turnIndex ?? left.favorite.turnIndex;
      const rightIndex = right.turn?.turnIndex ?? right.favorite.turnIndex;
      return leftIndex - rightIndex || left.favorite.savedAt - right.favorite.savedAt;
    });
}

export async function loadFloatingFavorites(conversationId: string): Promise<FloatingFavorite[]> {
  if (!conversationId.trim()) return [];
  const result = await chrome.storage.local.get(FLOATING_FAVORITES_STORAGE_KEY);
  const storage = normalizedStorage(result[FLOATING_FAVORITES_STORAGE_KEY]);
  return storage.conversations[conversationId] ?? [];
}

export async function saveFloatingFavorites(conversationId: string, favorites: FloatingFavorite[]): Promise<void> {
  if (!conversationId.trim()) return;
  const result = await chrome.storage.local.get(FLOATING_FAVORITES_STORAGE_KEY);
  const storage = normalizedStorage(result[FLOATING_FAVORITES_STORAGE_KEY]);
  const nextFavorites = normalizeFavorites(favorites);
  const conversations = { ...storage.conversations };
  if (nextFavorites.length === 0) {
    delete conversations[conversationId];
  } else {
    conversations[conversationId] = nextFavorites;
  }
  await chrome.storage.local.set({
    [FLOATING_FAVORITES_STORAGE_KEY]: {
      version: FAVORITES_STORAGE_VERSION,
      conversations
    } satisfies FloatingFavoritesStorage
  });
}
