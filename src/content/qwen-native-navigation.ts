import type { JumpToTurnResult, Turn, TurnNavigation } from "../shared/types.ts";
import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import { normalizeWebText } from "./web-adapter-core.ts";

const EMPTY_ASSISTANT_REPLY = "No text response";
const OBSERVER_SOURCE = "turnmap-qwen-observer";
const OBSERVER_COMMAND_SOURCE = "turnmap-qwen-observer-command";

type QwenMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  parentId: string | null;
};

export type QwenNativeSnapshot = {
  conversationId: string;
  turns: Turn[];
};

type MessageElement = {
  getAttribute(name: string): string | null;
};

export type QwenNavigationEnvironment<T extends MessageElement = HTMLElement> = {
  findMounted(messageId: string): T | null;
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

function textParts(value: unknown, depth = 0): string[] {
  if (depth > 8 || value == null) return [];
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((entry) => textParts(entry, depth + 1));
  if (!isObject(value)) return [];

  const preferredKeys = ["text", "content", "markdown", "answer", "output", "value"];
  return preferredKeys.flatMap((key) => key in value ? textParts(value[key], depth + 1) : []);
}

function messageText(value: Record<string, unknown>): string {
  const direct = typeof value.content === "string" ? normalizeWebText(value.content) : "";
  if (direct) return direct;

  const parts = textParts(value.content_list ?? value.contentList ?? value)
    .map(normalizeWebText)
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (unique.some((existing) => existing === part || existing.includes(part))) continue;
    unique.push(part);
  }
  return normalizeWebText(unique.join("\n"));
}

function roleForMessage(value: Record<string, unknown>): QwenMessage["role"] | null {
  const role = String(value.role ?? value.author ?? value.sender ?? "").toLowerCase();
  if (role === "user" || role === "human") return "user";
  if (role === "assistant" || role === "bot") return "assistant";
  return null;
}

function parentIdForMessage(value: Record<string, unknown>): string | null {
  const parentId = stringField(value, ["parentId", "parent_id", "parentMessageId", "parent_message_id"]);
  return parentId || null;
}

function qwenConversationIdFromApiUrl(input: string): string {
  try {
    const match = new URL(input, "https://www.qianwen.com").pathname.match(
      /\/(?:api\/(?:v\d+\/)?|)chats\/([^/?#]+)\/?$/i
    );
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function activeMessageChain(
  rawMessages: Record<string, unknown>,
  currentId: string
): QwenMessage[] | null {
  const chain: QwenMessage[] = [];
  const seen = new Set<string>();
  let messageId: string | null = currentId;

  while (messageId) {
    if (seen.has(messageId)) return null;
    seen.add(messageId);
    const raw = rawMessages[messageId];
    if (!isObject(raw)) return null;
    const id = stringField(raw, ["id", "message_id", "messageId"]) || messageId;
    const role = roleForMessage(raw);
    const parentId = parentIdForMessage(raw);
    if (role) chain.push({ id, role, text: messageText(raw), parentId });
    messageId = parentId;
  }

  return chain.reverse();
}

function chainToTurns(conversationId: string, chain: QwenMessage[]): Turn[] {
  const pairs: Array<{ user: QwenMessage; assistant?: QwenMessage }> = [];
  let pendingUser: QwenMessage | null = null;

  for (const message of chain) {
    if (message.role === "user") {
      if (pendingUser) pairs.push({ user: pendingUser });
      pendingUser = message;
      continue;
    }
    if (pendingUser) {
      pairs.push({ user: pendingUser, assistant: message });
      pendingUser = null;
    }
  }
  if (pendingUser) pairs.push({ user: pendingUser });

  const assignTurnId = stableTurnIdAssigner();
  return pairs.flatMap(({ user, assistant }, turnIndex) => {
    const userText = normalizeWebText(user.text);
    if (!userText) return [];
    const assistantText = normalizeWebText(assistant?.text ?? "") || EMPTY_ASSISTANT_REPLY;
    const sourceAnchor = {
      turnIndex,
      userMessageId: user.id,
      assistantMessageId: assistant?.id,
      userHash: hashText(userText),
      assistantHash: hashText(assistantText),
      userPreview: userText.slice(0, 120),
      assistantPreview: assistantText.slice(0, 120)
    };
    const navigation: TurnNavigation = {
      kind: "ophel_notSourceAnchor",
      site: "qwen",
      navigationId: `qwen-turn:${conversationId}:${user.id}`,
      identitySource: "native-message-id",
      messageId: user.id,
      turnId: assistant?.id,
      parentMessageId: user.parentId ?? undefined,
      branchId: assistant?.id,
      nativeTocIndex: turnIndex,
      turnIndex,
      textHash: sourceAnchor.userHash,
      userPreview: sourceAnchor.userPreview
    };
    return [{
      id: assignTurnId(sourceAnchor),
      turnIndex,
      userText,
      assistantText,
      sourceAnchor,
      navigation,
      extractedAt: Date.now()
    }];
  });
}

export function parseQwenChatResponse(body: string, requestUrl = ""): QwenNativeSnapshot | null {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(root)) return null;
  if ("success" in root && root.success === false) return null;

  const payload = isObject(root.data) ? root.data : root;
  const chat = isObject(payload.chat) ? payload.chat : payload;
  const history = isObject(chat.history)
    ? chat.history
    : isObject(payload.history)
      ? payload.history
      : null;
  if (!history || !isObject(history.messages)) return null;

  const conversationId =
    stringField(chat, ["id", "chat_id", "chatId"]) ||
    stringField(payload, ["id", "chat_id", "chatId"]) ||
    qwenConversationIdFromApiUrl(requestUrl);
  const currentId = stringField(history, ["currentId", "current_id"]);
  if (!conversationId || !currentId || Object.keys(history.messages).length === 0) return null;

  const chain = activeMessageChain(history.messages, currentId);
  if (!chain) return null;
  const turns = chainToTurns(conversationId, chain);
  return turns.length > 0 ? { conversationId, turns } : null;
}

function incomingTurnIsRicher(existing: Turn, incoming: Turn): boolean {
  if (existing.assistantText === EMPTY_ASSISTANT_REPLY && incoming.assistantText !== EMPTY_ASSISTANT_REPLY) return true;
  return incoming.assistantText.length > existing.assistantText.length;
}

function normalizeTurnIndexes(turns: Turn[]): Turn[] {
  const assignTurnId = stableTurnIdAssigner();
  return turns.map((turn, turnIndex) => {
    const sourceAnchor = { ...turn.sourceAnchor, turnIndex };
    return {
      ...turn,
      id: assignTurnId(sourceAnchor),
      turnIndex,
      sourceAnchor,
      navigation: turn.navigation
        ? { ...turn.navigation, turnIndex, nativeTocIndex: turnIndex }
        : undefined
    };
  });
}

export class QwenNativeIndex {
  private activeConversationId = "";
  private turnsByConversation = new Map<string, Map<string, Turn>>();

  activate(conversationId: string): void {
    if (conversationId === this.activeConversationId) return;
    this.activeConversationId = conversationId;
    for (const cachedId of this.turnsByConversation.keys()) {
      if (cachedId !== conversationId) this.turnsByConversation.delete(cachedId);
    }
  }

  ingest(body: string, requestUrl = ""): boolean {
    const snapshot = parseQwenChatResponse(body, requestUrl);
    if (!snapshot || (this.activeConversationId && snapshot.conversationId !== this.activeConversationId)) return false;

    const previous = this.turnsByConversation.get(snapshot.conversationId) ?? new Map<string, Turn>();
    const next = new Map<string, Turn>();
    for (const incoming of snapshot.turns) {
      const key = incoming.navigation?.navigationId;
      if (!key) continue;
      const existing = previous.get(key);
      const sameBranch = existing?.navigation?.turnId === incoming.navigation?.turnId;
      next.set(key, existing && sameBranch && !incomingTurnIsRicher(existing, incoming) ? existing : incoming);
    }
    this.turnsByConversation.set(snapshot.conversationId, next);
    return true;
  }

  getActiveTurns(): Turn[] {
    const turns = this.turnsByConversation.get(this.activeConversationId);
    return turns ? normalizeTurnIndexes([...turns.values()]) : [];
  }
}

export function mergeQwenNativeTurns(nativeTurns: Turn[], mountedTurns: Turn[]): Turn[] {
  const mountedByMessageId = new Map(
    mountedTurns
      .filter((turn) => turn.sourceAnchor.userMessageId)
      .map((turn) => [turn.sourceAnchor.userMessageId, turn] as const)
  );

  return nativeTurns.map((nativeTurn) => {
    const mounted = mountedByMessageId.get(nativeTurn.navigation?.messageId ?? "");
    if (!mounted) return nativeTurn;
    const userText = mounted.userText.length > nativeTurn.userText.length ? mounted.userText : nativeTurn.userText;
    const assistantText = mounted.assistantText.length > nativeTurn.assistantText.length
      ? mounted.assistantText
      : nativeTurn.assistantText;
    if (userText === nativeTurn.userText && assistantText === nativeTurn.assistantText) return nativeTurn;
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
        ? { ...nativeTurn.navigation, textHash: hashText(userText), userPreview: userText.slice(0, 120) }
        : undefined,
      extractedAt: Date.now()
    };
  });
}

function cssAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export function findMountedQwenTurnElement(messageId: string): HTMLElement | null {
  if (!messageId) return null;
  const value = cssAttributeValue(messageId);
  const candidates = document.querySelectorAll<HTMLElement>(
    `.chat-round[data-chat="${value}"], .chat-message-item[data-chat="${value}"], [data-chat="${value}"], [data-message-id="${value}"]`
  );
  for (const candidate of candidates) {
    if (candidate.getAttribute("data-chat") === messageId || candidate.getAttribute("data-message-id") === messageId) {
      return candidate;
    }
  }
  return null;
}

export async function navigateQwenTarget<T extends MessageElement>(
  target: TurnNavigation,
  environment: QwenNavigationEnvironment<T>
): Promise<JumpToTurnResult> {
  if (target.site !== "qwen" || !target.navigationId.startsWith("qwen-turn:")) {
    return { ok: false, reason: "The navigation identity does not belong to Qwen." };
  }
  const messageId = target.messageId;
  if (!messageId) return { ok: false, reason: "The Qwen navigation identity has no stable message ID." };

  const element = environment.findMounted(messageId);
  if (!element) {
    return {
      ok: false,
      reason: "The original Qwen turn is not mounted. TurnMap did not use text matching or scroll search."
    };
  }
  const exactId = element.getAttribute("data-chat") ?? element.getAttribute("data-message-id");
  if (exactId !== messageId) {
    return { ok: false, reason: "Qwen mounted a different round, so TurnMap refused to navigate." };
  }
  environment.reveal(element);
  return { ok: true };
}

export function qwenConversationIdFromUrl(input: string): string {
  try {
    const match = new URL(input).pathname.match(/\/(?:c|chat)\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

export const qwenNativeIndex = new QwenNativeIndex();

let observerStarted = false;
let observerListener: (() => void) | null = null;

function postObserverCommand(type: "flush" | "ack", payload?: unknown): void {
  window.postMessage({ source: OBSERVER_COMMAND_SOURCE, type, payload }, window.location.origin);
}

export function startQwenNativeObserver(listener: () => void): void {
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
        if (typeof data.payload?.body === "string") {
          if (qwenNativeIndex.ingest(data.payload.body, data.payload.url)) observerListener?.();
        }
      } finally {
        if (typeof id === "string") postObserverCommand("ack", { id });
      }
    });
  }
  postObserverCommand("flush");
}
