import type { JumpToTurnResult, Turn, TurnNavigation } from "../shared/types.ts";
import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import { normalizeWebText } from "./web-adapter-core.ts";

const EMPTY_ASSISTANT_REPLY = "No text response";
const OBSERVER_SOURCE = "turnmap-deepseek-observer";
const OBSERVER_COMMAND_SOURCE = "turnmap-deepseek-observer-command";

type JsonObject = Record<string, unknown>;

type DeepSeekFragment = {
  type: string;
  content: string;
};

type DeepSeekMessageRecord = {
  messageId: string;
  parentId: string | null;
  role: "USER" | "ASSISTANT";
  fragments: DeepSeekFragment[];
  payloadOrder: number;
};

type DeepSeekHistoryPayload = {
  conversationId: string;
  currentMessageId: string;
  cacheControl: string;
  messages: DeepSeekMessageRecord[];
};

export type DeepSeekNativeSnapshot = {
  conversationId: string;
  complete: boolean;
  turns: Turn[];
};

type MessageElement = {
  getAttribute(name: string): string | null;
};

export type DeepSeekNavigationEnvironment<T extends MessageElement> = {
  findMounted(messageId: string): T | null;
  requestNativeTarget(messageId: string): Promise<boolean>;
  waitForMounted(messageId: string): Promise<T | null>;
  reveal(element: T): void;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function fragmentContent(value: unknown): string {
  if (typeof value === "string") return normalizeWebText(value);
  if (!Array.isArray(value)) return "";
  return normalizeWebText(value.flatMap((entry) => fragmentContent(entry)).filter(Boolean).join("\n"));
}

function parseMessage(value: unknown, payloadOrder: number): DeepSeekMessageRecord | null {
  if (!isObject(value)) return null;
  const messageId = stringId(value.message_id);
  const rawRole = typeof value.role === "string" ? value.role.toUpperCase() : "";
  if (!messageId || (rawRole !== "USER" && rawRole !== "ASSISTANT")) return null;
  const fragments = Array.isArray(value.fragments)
    ? value.fragments.flatMap((fragment) => {
        if (!isObject(fragment) || typeof fragment.type !== "string") return [];
        return [{
          type: fragment.type.toUpperCase(),
          content: fragmentContent(fragment.content)
        }];
      })
    : [];
  return {
    messageId,
    parentId: value.parent_id == null ? null : stringId(value.parent_id) || null,
    role: rawRole,
    fragments,
    payloadOrder
  };
}

function parseHistoryPayload(body: string): DeepSeekHistoryPayload | null {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(root) || !isObject(root.data) || !isObject(root.data.biz_data)) return null;
  const bizData = root.data.biz_data;
  if (!isObject(bizData.chat_session) || !Array.isArray(bizData.chat_messages)) return null;
  const conversationId = stringId(bizData.chat_session.id);
  if (!conversationId) return null;
  const messages = bizData.chat_messages.flatMap((value, index) => {
    const message = parseMessage(value, index);
    return message ? [message] : [];
  });
  return {
    conversationId,
    currentMessageId: stringId(bizData.chat_session.current_message_id),
    cacheControl: typeof bizData.cache_control === "string" ? bizData.cache_control.toUpperCase() : "",
    messages
  };
}

function fallbackCurrentMessageId(messages: DeepSeekMessageRecord[]): string {
  if (messages.length === 0) return "";
  const numeric = messages
    .map((message) => ({ message, value: Number(message.messageId) }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((left, right) => right.value - left.value)[0];
  return numeric?.message.messageId ?? messages[messages.length - 1].messageId;
}

function activeMessagePath(
  messages: Map<string, DeepSeekMessageRecord>,
  currentMessageId: string
): { complete: boolean; messages: DeepSeekMessageRecord[] } {
  const path: DeepSeekMessageRecord[] = [];
  const seen = new Set<string>();
  let messageId = currentMessageId;
  let complete = Boolean(messageId);
  while (messageId) {
    if (seen.has(messageId)) {
      complete = false;
      break;
    }
    seen.add(messageId);
    const message = messages.get(messageId);
    if (!message) {
      complete = false;
      break;
    }
    path.push(message);
    if (message.parentId == null) break;
    messageId = message.parentId;
  }
  if (path.length > 0 && path[path.length - 1].parentId != null) complete = false;
  return { complete, messages: path.reverse() };
}

function textForTypes(message: DeepSeekMessageRecord | undefined, types: string[]): string {
  if (!message) return "";
  return message.fragments.find((fragment) => types.includes(fragment.type) && fragment.content)?.content ?? "";
}

function navigationFor(
  conversationId: string,
  messageId: string,
  turnIndex: number,
  userText: string
): TurnNavigation {
  return {
    kind: "ophel_notSourceAnchor",
    site: "deepseek",
    navigationId: `deepseek-turn:${conversationId}:${messageId}`,
    identitySource: "native-message-id",
    messageId,
    nativeTocIndex: turnIndex,
    turnIndex,
    textHash: hashText(userText),
    userPreview: userText.slice(0, 120)
  };
}

function pathToTurns(conversationId: string, path: DeepSeekMessageRecord[]): Turn[] {
  const assignTurnId = stableTurnIdAssigner();
  const turns: Turn[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const user = path[index];
    if (user.role !== "USER") continue;
    const assistant = path[index + 1]?.role === "ASSISTANT" ? path[index + 1] : undefined;
    const userText = textForTypes(user, ["REQUEST"]);
    if (!userText) continue;
    const assistantText = textForTypes(assistant, ["RESPONSE", "TEMPLATE_RESPONSE"]) || EMPTY_ASSISTANT_REPLY;
    const turnIndex = turns.length;
    const sourceAnchor = {
      turnIndex,
      userMessageId: user.messageId,
      assistantMessageId: assistant?.messageId,
      userHash: hashText(userText),
      assistantHash: hashText(assistantText),
      userPreview: userText.slice(0, 120),
      assistantPreview: assistantText.slice(0, 120)
    };
    turns.push({
      id: assignTurnId(sourceAnchor),
      turnIndex,
      userText,
      assistantText,
      sourceAnchor,
      navigation: navigationFor(conversationId, user.messageId, turnIndex, userText),
      extractedAt: Date.now()
    });
  }
  return turns;
}

function snapshotFromMessages(
  conversationId: string,
  messages: Map<string, DeepSeekMessageRecord>,
  currentMessageId: string,
  fullResponseSeen: boolean
): DeepSeekNativeSnapshot {
  const fallbackId = currentMessageId || fallbackCurrentMessageId([...messages.values()]);
  const path = activeMessagePath(messages, fallbackId);
  return {
    conversationId,
    complete: fullResponseSeen && path.complete,
    turns: pathToTurns(conversationId, path.messages)
  };
}

export function parseDeepSeekHistoryResponse(body: string): DeepSeekNativeSnapshot[] {
  const payload = parseHistoryPayload(body);
  if (!payload) return [];
  const messages = new Map(payload.messages.map((message) => [message.messageId, message]));
  return [snapshotFromMessages(
    payload.conversationId,
    messages,
    payload.currentMessageId,
    payload.cacheControl === "REPLACE"
  )];
}

function richerMessage(existing: DeepSeekMessageRecord | undefined, incoming: DeepSeekMessageRecord): DeepSeekMessageRecord {
  if (!existing) return incoming;
  const existingText = textForTypes(existing, ["REQUEST", "RESPONSE", "TEMPLATE_RESPONSE"]);
  const incomingText = textForTypes(incoming, ["REQUEST", "RESPONSE", "TEMPLATE_RESPONSE"]);
  return incomingText.length >= existingText.length ? incoming : existing;
}

type ConversationCache = {
  messages: Map<string, DeepSeekMessageRecord>;
  currentMessageId: string;
  fullResponseSeen: boolean;
};

export class DeepSeekNativeIndex {
  private activeConversationId = "";
  private caches = new Map<string, ConversationCache>();

  activate(conversationId: string): void {
    if (conversationId === this.activeConversationId) return;
    this.activeConversationId = conversationId;
    for (const cachedId of this.caches.keys()) {
      if (cachedId !== conversationId) this.caches.delete(cachedId);
    }
  }

  ingest(body: string): string[] {
    const payload = parseHistoryPayload(body);
    if (!payload || (this.activeConversationId && payload.conversationId !== this.activeConversationId)) return [];
    const existing = this.caches.get(payload.conversationId);
    const cache: ConversationCache = payload.cacheControl === "REPLACE" || !existing
      ? { messages: new Map(), currentMessageId: "", fullResponseSeen: false }
      : existing;
    let changed = false;
    for (const message of payload.messages) {
      const current = cache.messages.get(message.messageId);
      const next = richerMessage(current, message);
      if (next !== current) {
        cache.messages.set(message.messageId, next);
        changed = true;
      }
    }
    if (payload.currentMessageId && payload.currentMessageId !== cache.currentMessageId) {
      cache.currentMessageId = payload.currentMessageId;
      changed = true;
    }
    if (payload.cacheControl === "REPLACE") cache.fullResponseSeen = true;
    this.caches.set(payload.conversationId, cache);
    return changed ? [payload.conversationId] : [];
  }

  getActiveTurns(): Turn[] {
    const cache = this.caches.get(this.activeConversationId);
    if (!cache) return [];
    return snapshotFromMessages(
      this.activeConversationId,
      cache.messages,
      cache.currentMessageId,
      cache.fullResponseSeen
    ).turns;
  }

  hasCompleteActiveIndex(): boolean {
    const cache = this.caches.get(this.activeConversationId);
    if (!cache) return false;
    return snapshotFromMessages(
      this.activeConversationId,
      cache.messages,
      cache.currentMessageId,
      cache.fullResponseSeen
    ).complete;
  }
}

function conversationIdFromNativeTurns(turns: Turn[]): string {
  const navigationId = turns.find((turn) => turn.navigation?.navigationId.startsWith("deepseek-turn:"))
    ?.navigation?.navigationId;
  if (!navigationId) return "";
  return navigationId.slice("deepseek-turn:".length, navigationId.lastIndexOf(":"));
}

function isSyntheticMountedId(messageId: string): boolean {
  return /^(?:user|assistant)-\d+-[a-z0-9]+$/i.test(messageId);
}

export function bindDeepSeekNativeTurns(nativeTurns: Turn[], mountedTurns: Turn[]): Turn[] {
  const mountedByMessageId = new Map(
    mountedTurns
      .filter((turn) => turn.sourceAnchor.userMessageId && !isSyntheticMountedId(turn.sourceAnchor.userMessageId))
      .map((turn) => [turn.sourceAnchor.userMessageId as string, turn] as const)
  );
  const nativeIds = new Set(nativeTurns.map((turn) => turn.navigation?.messageId).filter(Boolean));
  const conversationId = conversationIdFromNativeTurns(nativeTurns);
  const enriched = nativeTurns.map((turn) => {
    const mounted = mountedByMessageId.get(turn.navigation?.messageId ?? "");
    if (!mounted) return turn;
    const userText = mounted.userText.length > turn.userText.length ? mounted.userText : turn.userText;
    const assistantText = mounted.assistantText.length > turn.assistantText.length
      ? mounted.assistantText
      : turn.assistantText;
    if (userText === turn.userText && assistantText === turn.assistantText) return turn;
    return {
      ...turn,
      userText,
      assistantText,
      sourceAnchor: {
        ...turn.sourceAnchor,
        userHash: hashText(userText),
        assistantHash: hashText(assistantText),
        userPreview: userText.slice(0, 120),
        assistantPreview: assistantText.slice(0, 120)
      },
      navigation: turn.navigation ? {
        ...turn.navigation,
        textHash: hashText(userText),
        userPreview: userText.slice(0, 120)
      } : undefined,
      extractedAt: Date.now()
    };
  });
  if (!conversationId) return enriched;
  const extras = mountedTurns
    .filter((turn) => {
      const id = turn.sourceAnchor.userMessageId ?? "";
      return id && !isSyntheticMountedId(id) && !nativeIds.has(id);
    })
    .map((turn, offset) => {
      const messageId = turn.sourceAnchor.userMessageId as string;
      const turnIndex = enriched.length + offset;
      return {
        ...turn,
        turnIndex,
        sourceAnchor: { ...turn.sourceAnchor, turnIndex },
        navigation: navigationFor(conversationId, messageId, turnIndex, turn.userText)
      };
    });
  return [...enriched, ...extras];
}

function elementHasMessageId(element: MessageElement | null, messageId: string): boolean {
  return element?.getAttribute("data-virtual-list-item-key") === messageId;
}

export async function navigateDeepSeekTarget<T extends MessageElement>(
  target: TurnNavigation,
  environment: DeepSeekNavigationEnvironment<T>
): Promise<JumpToTurnResult> {
  const messageId = target.messageId;
  if (!messageId) return { ok: false, reason: "This DeepSeek turn has no stable message ID." };
  const mounted = environment.findMounted(messageId);
  if (elementHasMessageId(mounted, messageId)) {
    environment.reveal(mounted as T);
    return { ok: true };
  }
  if (!await environment.requestNativeTarget(messageId)) {
    return { ok: false, reason: "DeepSeek did not expose an exact native target for this message ID." };
  }
  const remounted = await environment.waitForMounted(messageId);
  if (!elementHasMessageId(remounted, messageId)) {
    return { ok: false, reason: "DeepSeek did not remount the exact message ID before the navigation timeout." };
  }
  environment.reveal(remounted as T);
  return { ok: true };
}

export function deepSeekConversationIdFromUrl(input: string): string {
  try {
    return new URL(input).pathname.match(/^\/a\/chat\/s\/([^/?#]+)/)?.[1] ?? "";
  } catch {
    return "";
  }
}

function escapeAttribute(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

export function findMountedDeepSeekMessageElement(messageId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const key = escapeAttribute(messageId);
  const wrappers = document.querySelectorAll<HTMLElement>(`[data-virtual-list-item-key="${key}"]`);
  for (const wrapper of wrappers) {
    if (wrapper.matches(".ds-message")) return wrapper;
    if (wrapper.querySelector(".ds-message")) return wrapper;
  }
  return null;
}

export function waitForMountedDeepSeekMessageElement(messageId: string, timeoutMs = 2600): Promise<HTMLElement | null> {
  const existing = findMountedDeepSeekMessageElement(messageId);
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
      const element = findMountedDeepSeekMessageElement(messageId);
      if (element) finish(element);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

export const deepSeekNativeIndex = new DeepSeekNativeIndex();

let observerStarted = false;
let observerListener: (() => void) | null = null;
let requestSequence = 0;
const navigationRequests = new Map<string, (accepted: boolean) => void>();

function postObserverCommand(type: "flush" | "ack" | "navigate", payload?: unknown): void {
  window.postMessage({ source: OBSERVER_COMMAND_SOURCE, type, payload }, window.location.origin);
}

export function requestDeepSeekNativeTarget(messageId: string): Promise<boolean> {
  const requestId = `${Date.now()}:${++requestSequence}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      navigationRequests.delete(requestId);
      resolve(false);
    }, 1200);
    navigationRequests.set(requestId, (accepted) => {
      window.clearTimeout(timer);
      navigationRequests.delete(requestId);
      resolve(accepted);
    });
    postObserverCommand("navigate", { requestId, messageId });
  });
}

export function startDeepSeekNativeObserver(listener: () => void): void {
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
            const updated = deepSeekNativeIndex.ingest(data.payload.body);
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
