import type { Turn, TurnNavigation } from "../shared/types.ts";
import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import { normalizeWebText } from "./web-adapter-core.ts";

const EMPTY_ASSISTANT_REPLY = "No text response";
const OBSERVER_SOURCE = "turnmap-claude-observer";
const OBSERVER_COMMAND_SOURCE = "turnmap-claude-observer-command";

type ClaudeMessage = {
  uuid: string;
  role: "user" | "assistant";
  text: string;
  parentMessageUuid?: string;
  index?: number;
  timestampMs?: number;
  payloadOrder: number;
};

export type ClaudeNativeSnapshot = {
  conversationId: string;
  branchId: string;
  deletedUserMessageIds: string[];
  turns: Turn[];
};

export type ClaudeNativeBinding = {
  complete: boolean;
  turns: Turn[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(value: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function messageText(value: Record<string, unknown>): string {
  const directText = stringField(value, ["text"]);
  const content = value.content;
  if (!Array.isArray(content)) return normalizeWebText(directText);

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!isRecord(item)) continue;
    const type = stringField(item, ["type"]);
    if (type && type !== "text") continue;
    const text = stringField(item, ["text"]);
    if (text) parts.push(text);
  }
  return normalizeWebText(parts.join("\n") || directText);
}

function timestampMs(value: Record<string, unknown>): number | undefined {
  for (const name of ["created_at", "updated_at", "edited_at"]) {
    const candidate = value[name];
    if (typeof candidate !== "string" || !candidate) continue;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeMessage(value: unknown, payloadOrder: number): ClaudeMessage | null {
  if (!isRecord(value) || value.deleted_at || value.is_deleted === true) return null;
  const uuid = stringField(value, ["uuid", "message_uuid", "message_id"]);
  const sender = stringField(value, ["sender", "role"]).toLowerCase();
  const role = sender === "human" || sender === "user" ? "user" : sender === "assistant" ? "assistant" : null;
  if (!uuid || !role) return null;
  const text = messageText(value);
  if (!text && role === "user") return null;
  const rawIndex = value.index;
  return {
    uuid,
    role,
    text: text || EMPTY_ASSISTANT_REPLY,
    parentMessageUuid: stringField(value, ["parent_message_uuid", "parent_uuid", "parent_message_id"]) || undefined,
    index: typeof rawIndex === "number" && Number.isFinite(rawIndex) ? rawIndex : undefined,
    timestampMs: timestampMs(value),
    payloadOrder
  };
}

function conversationIdFromApiUrl(input: string): string {
  try {
    const match = new URL(input).pathname.match(/\/chat_conversations\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function findConversationPayloads(value: unknown, results: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => findConversationPayloads(item, results));
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.chat_messages)) {
    results.push(value);
    return;
  }
  Object.values(value).forEach((item) => findConversationPayloads(item, results));
}

function orderedMessages(messages: ClaudeMessage[], leafMessageUuid: string): ClaudeMessage[] {
  const byId = new Map(messages.map((message) => [message.uuid, message]));
  if (leafMessageUuid && byId.has(leafMessageUuid)) {
    const branch: ClaudeMessage[] = [];
    const seen = new Set<string>();
    let current = byId.get(leafMessageUuid);
    while (current && !seen.has(current.uuid)) {
      branch.push(current);
      seen.add(current.uuid);
      current = current.parentMessageUuid ? byId.get(current.parentMessageUuid) : undefined;
    }
    branch.reverse();
    if (branch.some((message) => message.role === "user")) return branch;
  }

  return [...messages].sort((left, right) => {
    if (left.index != null && right.index != null && left.index !== right.index) return left.index - right.index;
    if (left.timestampMs != null && right.timestampMs != null && left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    return left.payloadOrder - right.payloadOrder;
  });
}

function messagesToTurns(conversationId: string, branchId: string, messages: ClaudeMessage[]): Turn[] {
  const turns: Turn[] = [];
  const assignTurnId = stableTurnIdAssigner();
  let pendingUser: ClaudeMessage | null = null;

  const pushTurn = (user: ClaudeMessage, assistant?: ClaudeMessage) => {
    const assistantText = assistant?.text || EMPTY_ASSISTANT_REPLY;
    const turnIndex = turns.length;
    const sourceAnchor = {
      turnIndex,
      userMessageId: user.uuid,
      assistantMessageId: assistant?.uuid,
      userHash: hashText(user.text),
      assistantHash: hashText(assistantText),
      userPreview: user.text.slice(0, 120),
      assistantPreview: assistantText.slice(0, 120)
    };
    const navigation: TurnNavigation = {
      kind: "ophel_notSourceAnchor",
      site: "claude",
      navigationId: `claude-turn:${conversationId}:${user.uuid}`,
      identitySource: "native-message-id",
      messageId: user.uuid,
      turnId: assistant?.uuid,
      parentMessageId: user.parentMessageUuid,
      branchId,
      nativeTocIndex: turnIndex,
      turnIndex,
      textHash: hashText(user.text),
      userPreview: user.text.slice(0, 120)
    };
    turns.push({
      id: assignTurnId(sourceAnchor),
      turnIndex,
      userText: user.text,
      assistantText,
      sourceAnchor,
      navigation,
      extractedAt: Date.now()
    });
  };

  for (const message of messages) {
    if (message.role === "user") {
      if (pendingUser) pushTurn(pendingUser);
      pendingUser = message;
      continue;
    }
    if (pendingUser) {
      pushTurn(pendingUser, message);
      pendingUser = null;
    }
  }
  if (pendingUser) pushTurn(pendingUser);
  return turns;
}

export function parseClaudeConversationResponse(url: string, body: string): ClaudeNativeSnapshot[] {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return [];
  }

  const payloads: Record<string, unknown>[] = [];
  findConversationPayloads(root, payloads);
  const urlConversationId = conversationIdFromApiUrl(url);
  return payloads.flatMap((payload) => {
    const conversationId = stringField(payload, ["uuid", "conversation_uuid", "conversation_id"]) || urlConversationId;
    if (!conversationId) return [];
    const rawMessages = payload.chat_messages as unknown[];
    const deletedUserMessageIds = rawMessages.flatMap((value) => {
      if (!isRecord(value) || (!value.deleted_at && value.is_deleted !== true)) return [];
      const sender = stringField(value, ["sender", "role"]).toLowerCase();
      if (sender !== "human" && sender !== "user") return [];
      const uuid = stringField(value, ["uuid", "message_uuid", "message_id"]);
      return uuid ? [uuid] : [];
    });
    const messages = rawMessages
      .map(normalizeMessage)
      .filter((message): message is ClaudeMessage => Boolean(message));
    if (messages.length === 0) return [];
    const leafMessageUuid = stringField(payload, [
      "current_leaf_message_uuid",
      "leaf_message_uuid",
      "current_message_uuid"
    ]);
    const branchId = leafMessageUuid || "linear";
    const turns = messagesToTurns(conversationId, branchId, orderedMessages(messages, leafMessageUuid));
    return turns.length > 0 || deletedUserMessageIds.length > 0
      ? [{ conversationId, branchId, deletedUserMessageIds, turns }]
      : [];
  });
}

export class ClaudeNativeIndex {
  private activeConversationId = "";
  private snapshotsByConversation = new Map<string, ClaudeNativeSnapshot>();

  activate(conversationId: string): void {
    if (conversationId === this.activeConversationId) return;
    this.activeConversationId = conversationId;
    for (const cachedId of this.snapshotsByConversation.keys()) {
      if (cachedId !== conversationId) this.snapshotsByConversation.delete(cachedId);
    }
  }

  ingest(url: string, body: string): string[] {
    const updated: string[] = [];
    for (const snapshot of parseClaudeConversationResponse(url, body)) {
      if (this.activeConversationId && snapshot.conversationId !== this.activeConversationId) continue;
      const existing = this.snapshotsByConversation.get(snapshot.conversationId);
      const nextSnapshot = existing && existing.branchId === snapshot.branchId
        ? mergeClaudeSnapshots(existing, snapshot)
        : snapshot;
      if (
        !existing ||
        existing.branchId !== nextSnapshot.branchId ||
        JSON.stringify(existing.turns.map(turnIdentityAndText)) !== JSON.stringify(nextSnapshot.turns.map(turnIdentityAndText))
      ) {
        this.snapshotsByConversation.set(snapshot.conversationId, nextSnapshot);
        updated.push(snapshot.conversationId);
      }
    }
    return updated;
  }

  getActiveTurns(): Turn[] {
    return this.snapshotsByConversation.get(this.activeConversationId)?.turns ?? [];
  }

  getActiveBranchId(): string {
    return this.snapshotsByConversation.get(this.activeConversationId)?.branchId ?? "";
  }
}

function mergeClaudeSnapshots(
  existing: ClaudeNativeSnapshot,
  incoming: ClaudeNativeSnapshot
): ClaudeNativeSnapshot {
  const incomingById = new Map(
    incoming.turns.map((turn) => [turn.navigation?.navigationId ?? turn.id, turn] as const)
  );
  const deletedUserMessageIds = new Set(incoming.deletedUserMessageIds);
  const merged = existing.turns.filter(
    (turn) => !deletedUserMessageIds.has(turn.sourceAnchor.userMessageId ?? "")
  ).map((turn) => {
    const key = turn.navigation?.navigationId ?? turn.id;
    const replacement = incomingById.get(key);
    incomingById.delete(key);
    return replacement ?? turn;
  });
  merged.push(...incomingById.values());
  const assignTurnId = stableTurnIdAssigner();
  const turns = merged.map((turn, turnIndex) => {
    const sourceAnchor = { ...turn.sourceAnchor, turnIndex };
    return {
      ...turn,
      id: assignTurnId(sourceAnchor),
      turnIndex,
      sourceAnchor,
      navigation: turn.navigation
        ? { ...turn.navigation, turnIndex, nativeTocIndex: turnIndex, branchId: incoming.branchId }
        : undefined
    };
  });
  return { ...incoming, turns };
}

function turnIdentityAndText(turn: Turn): string[] {
  return [
    turn.navigation?.navigationId ?? "",
    turn.navigation?.turnId ?? "",
    turn.userText,
    turn.assistantText
  ];
}

function enrichNativeTurn(nativeTurn: Turn, mountedTurn: Turn): Turn {
  const userText = mountedTurn.userText.length > nativeTurn.userText.length ? mountedTurn.userText : nativeTurn.userText;
  const assistantText =
    nativeTurn.assistantText === EMPTY_ASSISTANT_REPLY || mountedTurn.assistantText.length > nativeTurn.assistantText.length
      ? mountedTurn.assistantText
      : nativeTurn.assistantText;
  return {
    ...nativeTurn,
    userText,
    assistantText,
    sourceAnchor: {
      ...nativeTurn.sourceAnchor,
      userHash: hashText(userText),
      assistantHash: hashText(assistantText),
      userPreview: userText.slice(0, 120),
      assistantPreview: assistantText.slice(0, 120)
    },
    navigation: nativeTurn.navigation
      ? {
          ...nativeTurn.navigation,
          textHash: hashText(userText),
          userPreview: userText.slice(0, 120)
        }
      : undefined,
    extractedAt: Date.now()
  };
}

function exactOrderedUserPrefix(nativeTurns: Turn[], mountedTurns: Turn[]): boolean {
  return (
    mountedTurns.length >= nativeTurns.length &&
    nativeTurns.every(
      (turn, index) => normalizeWebText(turn.userText) === normalizeWebText(mountedTurns[index]?.userText ?? "")
    )
  );
}

export function bindClaudeNativeTurns(nativeTurns: Turn[], mountedTurns: Turn[]): ClaudeNativeBinding {
  const nativeMessageIds = new Set(nativeTurns.map((turn) => turn.navigation?.messageId).filter(Boolean));
  const mountedByNativeMessageId = new Map<string, Turn>();
  for (const turn of mountedTurns) {
    const messageId = turn.sourceAnchor.userMessageId;
    if (messageId && nativeMessageIds.has(messageId)) mountedByNativeMessageId.set(messageId, turn);
  }

  if (
    nativeTurns.length > 0 &&
    nativeTurns.every((turn) => Boolean(turn.navigation?.messageId && mountedByNativeMessageId.has(turn.navigation.messageId)))
  ) {
    const enriched = nativeTurns.map((turn) => enrichNativeTurn(turn, mountedByNativeMessageId.get(turn.navigation!.messageId!)!));
    const extras = mountedTurns.filter((turn) => !nativeMessageIds.has(turn.sourceAnchor.userMessageId ?? ""));
    return {
      complete: extras.length === 0,
      turns: [...enriched, ...extras.map((turn) => ({ ...turn, navigation: undefined }))]
    };
  }

  if (nativeTurns.length > 0 && exactOrderedUserPrefix(nativeTurns, mountedTurns)) {
    const enriched = nativeTurns.map((turn, index) => enrichNativeTurn(turn, mountedTurns[index]));
    const extras = mountedTurns.slice(nativeTurns.length).map((turn) => ({ ...turn, navigation: undefined }));
    return { complete: extras.length === 0, turns: [...enriched, ...extras] };
  }

  return { complete: false, turns: nativeTurns };
}

export function findClaudeMountedTurnIndex(
  target: TurnNavigation,
  nativeTurns: Turn[],
  mountedTurns: Turn[]
): number | null {
  if (target.messageId) {
    const exactIndex = mountedTurns.findIndex((turn) => turn.sourceAnchor.userMessageId === target.messageId);
    if (exactIndex >= 0) return exactIndex;
  }
  const binding = bindClaudeNativeTurns(nativeTurns, mountedTurns);
  if (!binding.complete) return null;
  const index = binding.turns.findIndex((turn) => turn.navigation?.navigationId === target.navigationId);
  return index >= 0 ? index : null;
}

export function claudeConversationIdFromUrl(input: string): string {
  try {
    const match = new URL(input).pathname.match(/\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

export function findMountedClaudeMessageElement(messageId: string): HTMLElement | null {
  if (!messageId) return null;
  const escaped = escapeCssIdentifier(messageId);
  const candidate = document.querySelector<HTMLElement>(
    `[data-message-uuid="${escaped}"], [data-message-id="${escaped}"], [data-uuid="${escaped}"], #${escaped}`
  );
  if (!candidate) return null;
  if (candidate.matches("[data-testid='user-message'], [data-role='user']")) return candidate;
  return candidate.querySelector<HTMLElement>("[data-testid='user-message'], [data-role='user']") ?? candidate;
}

export const claudeNativeIndex = new ClaudeNativeIndex();

let observerStarted = false;
let observerListener: (() => void) | null = null;

function postObserverCommand(type: "flush" | "ack", payload?: unknown): void {
  window.postMessage({ source: OBSERVER_COMMAND_SOURCE, type, payload }, window.location.origin);
}

export function startClaudeNativeObserver(listener: () => void): void {
  observerListener = listener;
  if (!observerStarted) {
    observerStarted = true;
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: { id?: string; url?: string; body?: string };
      } | null;
      if (!data || data.source !== OBSERVER_SOURCE || data.type !== "capture") return;
      const id = data.payload?.id;
      try {
        if (typeof data.payload?.url === "string" && typeof data.payload.body === "string") {
          const updated = claudeNativeIndex.ingest(data.payload.url, data.payload.body);
          if (updated.length > 0) observerListener?.();
        }
      } finally {
        if (typeof id === "string") postObserverCommand("ack", { id });
      }
    });
  }
  postObserverCommand("flush");
}
