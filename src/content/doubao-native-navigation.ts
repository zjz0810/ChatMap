import type { JumpToTurnResult, Turn, TurnNavigation } from "../shared/types.ts";
import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import { normalizeWebText } from "./web-adapter-core.ts";

const EMPTY_ASSISTANT_REPLY = "No text response";
const OBSERVER_SOURCE = "turnmap-doubao-observer";
const OBSERVER_COMMAND_SOURCE = "turnmap-doubao-observer-command";

type DoubaoMessageRecord = {
  conversationId: string;
  messageId: string;
  replyId?: string;
  index: number;
  role: "user" | "assistant";
  text: string;
  payloadOrder: number;
};

export type DoubaoNativeSnapshot = {
  conversationId: string;
  turns: Turn[];
};

export type DoubaoVirtualTargetRequest = {
  messageId: string;
  nativeIndex?: number;
  virtualKeys: string[];
};

type MessageElement = {
  getAttribute(name: string): string | null;
};

export type DoubaoNavigationEnvironment<T extends MessageElement = HTMLElement> = {
  findMounted(messageId: string): T | null;
  requestVirtualTarget(request: DoubaoVirtualTargetRequest): Promise<boolean>;
  waitForMounted(messageId: string): Promise<T | null>;
  reveal(element: T): void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return "";
}

function numberField(value: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const candidate = Number(value[key]);
    if (Number.isFinite(candidate)) return candidate;
  }
  return fallback;
}

function parseEmbeddedJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function textParts(value: unknown, depth = 0): string[] {
  if (depth > 8 || value == null) return [];
  if (typeof value === "string") {
    const parsed = parseEmbeddedJson(value);
    return parsed === value ? [value] : textParts(parsed, depth + 1);
  }
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap((entry) => textParts(entry, depth + 1));
  if (!isObject(value)) return [];

  const preferredKeys = [
    "text",
    "markdown",
    "display_content",
    "displayContent",
    "content",
    "content_obj",
    "contentObj",
    "content_block",
    "contentBlock",
    "content_blocks_v2",
    "contentBlocksV2",
    "body",
    "value"
  ];
  const parts = preferredKeys.flatMap((key) => key in value ? textParts(value[key], depth + 1) : []);
  if (parts.length > 0) return parts;
  return [];
}

function messageText(value: Record<string, unknown>): string {
  const parts = textParts(value)
    .map((part) => normalizeWebText(part))
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (unique.some((existing) => existing === part || existing.includes(part))) continue;
    unique.push(part);
  }
  return normalizeWebText(unique.join("\n"));
}

function roleForMessage(value: Record<string, unknown>): DoubaoMessageRecord["role"] | null {
  const raw = value.user_type ?? value.userType ?? value.role ?? value.sender_type ?? value.senderType;
  if (raw === 1 || String(raw).toLowerCase() === "human" || String(raw).toLowerCase() === "user") return "user";
  if (
    raw === 2 ||
    String(raw).toLowerCase() === "aibot" ||
    String(raw).toLowerCase() === "bot" ||
    String(raw).toLowerCase() === "assistant"
  ) {
    return "assistant";
  }
  return null;
}

function looksLikeMessage(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const messageId = stringField(value, ["message_id", "messageId", "msg_id", "msgId"]);
  return Boolean(messageId && roleForMessage(value));
}

function collectMessageObjects(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (candidate: unknown, depth: number) => {
    if (depth > 10 || candidate == null || seen.has(candidate)) return;
    if (typeof candidate === "object") seen.add(candidate);
    if (Array.isArray(candidate)) {
      if (candidate.some(looksLikeMessage)) {
        candidate.filter(looksLikeMessage).forEach((entry) => records.push(entry));
        return;
      }
      candidate.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (!isObject(candidate)) return;
    if (looksLikeMessage(candidate)) {
      records.push(candidate);
      return;
    }
    Object.values(candidate).forEach((entry) => visit(entry, depth + 1));
  };
  visit(value, 0);
  return records;
}

function recordsFromPayload(payload: unknown): DoubaoMessageRecord[] {
  return collectMessageObjects(payload).flatMap((value, payloadOrder) => {
    const role = roleForMessage(value);
    const conversationId = stringField(value, [
      "conversation_id",
      "conversationId",
      "local_conversation_id",
      "localConversationId"
    ]);
    const messageId = stringField(value, ["message_id", "messageId", "msg_id", "msgId"]);
    if (!role || !conversationId || !messageId) return [];
    return [{
      conversationId,
      messageId,
      replyId: stringField(value, ["reply_id", "replyId", "bot_reply_message_id", "botReplyMessageId"]) || undefined,
      index: numberField(value, ["index", "index_in_conv", "indexInConv", "message_index", "messageIndex"], payloadOrder),
      role,
      text: messageText(value),
      payloadOrder
    }];
  });
}

function navigationFor(record: DoubaoMessageRecord, turnIndex: number): TurnNavigation {
  return {
    kind: "ophel_notSourceAnchor",
    site: "doubao",
    navigationId: `doubao-turn:${record.conversationId}:${record.messageId}`,
    identitySource: "native-message-id",
    messageId: record.messageId,
    nativeTocIndex: record.index,
    turnIndex,
    textHash: hashText(record.text),
    userPreview: record.text.slice(0, 120)
  };
}

function recordsToTurns(records: DoubaoMessageRecord[]): Turn[] {
  const richestById = new Map<string, DoubaoMessageRecord>();
  for (const record of records) {
    const existing = richestById.get(record.messageId);
    if (!existing || record.text.length >= existing.text.length) richestById.set(record.messageId, record);
  }
  const ordered = [...richestById.values()].sort(
    (left, right) => left.index - right.index || left.payloadOrder - right.payloadOrder
  );
  const users = ordered.filter((record) => record.role === "user" && record.text);
  const assistants = ordered.filter((record) => record.role === "assistant");
  const assignTurnId = stableTurnIdAssigner();

  return users.map((user, turnIndex) => {
    const nextUserIndex = users[turnIndex + 1]?.index ?? Number.POSITIVE_INFINITY;
    const assistant =
      assistants.find((candidate) => candidate.replyId === user.messageId) ??
      assistants.find((candidate) => candidate.index > user.index && candidate.index < nextUserIndex);
    const assistantText = assistant?.text || EMPTY_ASSISTANT_REPLY;
    const sourceAnchor = {
      turnIndex,
      userMessageId: user.messageId,
      assistantMessageId: assistant?.messageId,
      userHash: hashText(user.text),
      assistantHash: hashText(assistantText),
      userPreview: user.text.slice(0, 120),
      assistantPreview: assistantText.slice(0, 120)
    };
    return {
      id: assignTurnId(sourceAnchor),
      turnIndex,
      userText: user.text,
      assistantText,
      sourceAnchor,
      navigation: navigationFor(user, turnIndex),
      extractedAt: Date.now()
    };
  });
}

export function parseDoubaoConversationResponse(body: string): DoubaoNativeSnapshot[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  const byConversation = new Map<string, DoubaoMessageRecord[]>();
  for (const record of recordsFromPayload(payload)) {
    const existing = byConversation.get(record.conversationId);
    if (existing) existing.push(record);
    else byConversation.set(record.conversationId, [record]);
  }
  return [...byConversation].map(([conversationId, records]) => ({
    conversationId,
    turns: recordsToTurns(records)
  }));
}

function normalizeTurnIndexes(turns: Turn[]): Turn[] {
  const assignTurnId = stableTurnIdAssigner();
  return [...turns]
    .sort((left, right) => (left.navigation?.nativeTocIndex ?? left.turnIndex) - (right.navigation?.nativeTocIndex ?? right.turnIndex))
    .map((turn, turnIndex) => {
      const sourceAnchor = { ...turn.sourceAnchor, turnIndex };
      return {
        ...turn,
        id: assignTurnId(sourceAnchor),
        turnIndex,
        sourceAnchor,
        navigation: turn.navigation ? { ...turn.navigation, turnIndex } : undefined
      };
    });
}

export class DoubaoNativeIndex {
  private activeConversationId = "";
  private turnsByConversation = new Map<string, Map<string, Turn>>();

  activate(conversationId: string): void {
    if (conversationId === this.activeConversationId) return;
    this.activeConversationId = conversationId;
    for (const cachedId of this.turnsByConversation.keys()) {
      if (cachedId !== conversationId) this.turnsByConversation.delete(cachedId);
    }
  }

  ingest(body: string): string[] {
    const updated: string[] = [];
    for (const snapshot of parseDoubaoConversationResponse(body)) {
      if (this.activeConversationId && snapshot.conversationId !== this.activeConversationId) continue;
      const merged = this.turnsByConversation.get(snapshot.conversationId) ?? new Map<string, Turn>();
      let changed = false;
      for (const turn of snapshot.turns) {
        const key = turn.navigation?.navigationId;
        if (!key) continue;
        const existing = merged.get(key);
        if (!existing || turn.assistantText.length > existing.assistantText.length || turn.userText.length > existing.userText.length) {
          merged.set(key, turn);
          changed = true;
        }
      }
      this.turnsByConversation.set(snapshot.conversationId, merged);
      if (changed) updated.push(snapshot.conversationId);
    }
    return updated;
  }

  getActiveTurns(): Turn[] {
    const turns = this.turnsByConversation.get(this.activeConversationId);
    return turns ? normalizeTurnIndexes([...turns.values()]) : [];
  }
}

function elementHasMessageId(element: MessageElement | null, messageId: string): boolean {
  return element?.getAttribute("data-message-id") === messageId;
}

export async function navigateDoubaoTarget<T extends MessageElement>(
  target: TurnNavigation,
  environment: DoubaoNavigationEnvironment<T>
): Promise<JumpToTurnResult> {
  const messageId = target.messageId;
  if (!messageId) return { ok: false, reason: "This Doubao turn has no stable message ID." };

  const mounted = environment.findMounted(messageId);
  if (elementHasMessageId(mounted, messageId)) {
    environment.reveal(mounted as T);
    return { ok: true };
  }

  const accepted = await environment.requestVirtualTarget({
    messageId,
    nativeIndex: target.nativeTocIndex,
    virtualKeys: [`block_${messageId}`, messageId]
  });
  if (!accepted) {
    return { ok: false, reason: "Doubao did not expose a deterministic virtual target for this message." };
  }

  const remounted = await environment.waitForMounted(messageId);
  if (!elementHasMessageId(remounted, messageId)) {
    return { ok: false, reason: "Doubao did not remount the exact message ID before the navigation timeout." };
  }
  environment.reveal(remounted as T);
  return { ok: true };
}

export function doubaoConversationIdFromUrl(input: string): string {
  try {
    const match = new URL(input).pathname.match(/^(?:\/code)?\/chat\/([^/?#]+)|^\/thread\/([^/?#]+)/);
    const id = match?.[1] || match?.[2] || "";
    return id === "new" ? "" : id;
  } catch {
    return "";
  }
}

export function findMountedDoubaoMessageElement(messageId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(messageId)
    : messageId.replace(/["\\]/g, "\\$&");
  return document.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`);
}

export function waitForMountedDoubaoMessageElement(messageId: string, timeoutMs = 2400): Promise<HTMLElement | null> {
  const existing = findMountedDoubaoMessageElement(messageId);
  if (existing || typeof document === "undefined") return Promise.resolve(existing);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (element: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(element);
    };
    const observer = new MutationObserver(() => {
      const element = findMountedDoubaoMessageElement(messageId);
      if (element) finish(element);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

export const doubaoNativeIndex = new DoubaoNativeIndex();

let observerStarted = false;
let observerListener: (() => void) | null = null;
let requestSequence = 0;
const navigationRequests = new Map<string, (accepted: boolean) => void>();

function postObserverCommand(type: "flush" | "ack" | "navigate", payload?: unknown): void {
  window.postMessage({ source: OBSERVER_COMMAND_SOURCE, type, payload }, window.location.origin);
}

export function requestDoubaoVirtualTarget(request: DoubaoVirtualTargetRequest): Promise<boolean> {
  const requestId = `${Date.now()}:${++requestSequence}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      navigationRequests.delete(requestId);
      resolve(false);
    }, 800);
    navigationRequests.set(requestId, (accepted) => {
      window.clearTimeout(timer);
      navigationRequests.delete(requestId);
      resolve(accepted);
    });
    postObserverCommand("navigate", { requestId, ...request });
  });
}

export function startDoubaoNativeObserver(listener: () => void): void {
  observerListener = listener;
  if (!observerStarted) {
    observerStarted = true;
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: { id?: string; body?: string; requestId?: string; accepted?: boolean };
      } | null;
      if (!data || data.source !== OBSERVER_SOURCE) return;
      if (data.type === "capture") {
        const id = data.payload?.id;
        try {
          if (typeof data.payload?.body === "string") {
            const updated = doubaoNativeIndex.ingest(data.payload.body);
            if (updated.length > 0) observerListener?.();
          }
        } finally {
          if (typeof id === "string") postObserverCommand("ack", { id });
        }
        return;
      }
      if (data.type === "navigate-result" && typeof data.payload?.requestId === "string") {
        navigationRequests.get(data.payload.requestId)?.(data.payload.accepted === true);
      }
    });
  }
  postObserverCommand("flush");
}
