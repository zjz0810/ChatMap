import type { JumpToTurnResult, Turn, TurnNavigation } from "../shared/types.ts";
import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import { normalizeWebText } from "./web-adapter-core.ts";

const EMPTY_ASSISTANT_REPLY = "No text response";
const OBSERVER_SOURCE = "turnmap-glm-observer";
const OBSERVER_COMMAND_SOURCE = "turnmap-glm-observer-command";

export type GlmVariant = "chatglm" | "z-ai";

type GlmMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  parentId: string | null;
};

export type GlmNativeScope = {
  variant: GlmVariant;
  host: string;
  conversationId: string;
};

export type GlmNativeSnapshot = GlmNativeScope & {
  turns: Turn[];
};

type MessageElement = {
  id: string;
};

export type GlmNavigationEnvironment<T extends MessageElement = HTMLElement> = {
  currentVariant: GlmVariant;
  currentHost: string;
  currentConversationId: string;
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

function contentParts(value: unknown, depth = 0): string[] {
  if (value == null || depth > 8) return [];
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((entry) => contentParts(entry, depth + 1));
  if (!isObject(value)) return [];
  const segmentType = String(value.type ?? value.kind ?? value.role ?? "").toLowerCase();
  if (value.hidden === true || /reason|think|analysis|plan|tool|mcp|function/.test(segmentType)) return [];
  return ["text", "content", "markdown", "answer", "output", "value"].flatMap((key) =>
    key in value ? contentParts(value[key], depth + 1) : []
  );
}

function messageText(value: Record<string, unknown>): string {
  const parts = contentParts(value.content ?? value.text ?? value.message)
    .map(normalizeWebText)
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (unique.some((existing) => existing === part || existing.includes(part))) continue;
    unique.push(part);
  }
  return normalizeWebText(unique.join("\n"));
}

function roleForMessage(value: Record<string, unknown>): GlmMessage["role"] | null {
  const role = String(value.role ?? value.author ?? value.sender ?? "").toLowerCase();
  if (role === "user" || role === "human") return "user";
  if (role === "assistant" || role === "bot") return "assistant";
  return null;
}

function parentIdForMessage(value: Record<string, unknown>): string | null {
  return stringField(value, ["parentId", "parent_id", "parentMessageId", "parent_message_id"]) || null;
}

function zAiApiConversationId(input: string): string {
  try {
    const match = new URL(input).pathname.match(/^\/api\/v1\/chats\/([^/?#]+)\/?$/i);
    if (!match?.[1] || match[1].toLowerCase() === "new") return "";
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function isZaiConversationRequest(input: string): boolean {
  try {
    const url = new URL(input);
    return glmVariantFromUrl(url.href) === "z-ai" && /^\/api\/v1\/chats\/(?:new|[^/?#]+)\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isZaiNewConversationRequest(input: string): boolean {
  try {
    const url = new URL(input);
    return glmVariantFromUrl(url.href) === "z-ai" && /^\/api\/v1\/chats\/new\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function activeMessageChain(rawMessages: Record<string, unknown>, currentId: string): GlmMessage[] | null {
  const chain: GlmMessage[] = [];
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

function chainToTurns(scope: GlmNativeScope, chain: GlmMessage[]): Turn[] {
  const pairs: Array<{ user: GlmMessage; assistant?: GlmMessage }> = [];
  let pendingUser: GlmMessage | null = null;

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
      site: "glm",
      navigationId: `glm-turn:${scope.variant}:${scope.host}:${scope.conversationId}:${user.id}`,
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

export function glmVariantFromUrl(input: string): GlmVariant | null {
  try {
    const host = new URL(input).hostname.toLowerCase();
    if (host === "chatglm.cn" || host === "www.chatglm.cn") return "chatglm";
    if (host === "chat.z.ai" || host === "z.ai" || host.endsWith(".z.ai")) return "z-ai";
    return null;
  } catch {
    return null;
  }
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function parseGlmConversationResponse(
  body: string,
  requestUrl: string,
  requestBody = ""
): GlmNativeSnapshot[] {
  if (!isZaiConversationRequest(requestUrl)) return [];
  const root = parseJsonObject(body);
  if (!root || ("success" in root && root.success === false)) return [];
  const requestRoot = requestBody ? parseJsonObject(requestBody) : null;

  const payload = isObject(root.data) ? root.data : root;
  const requestPayload = requestRoot && isObject(requestRoot.data) ? requestRoot.data : requestRoot;
  const responseChat = isObject(payload.chat) ? payload.chat : payload;
  const requestChat = requestPayload && isObject(requestPayload.chat) ? requestPayload.chat : requestPayload;
  const chat = isObject(responseChat.history) ? responseChat : requestChat;
  if (!chat) return [];
  const history = isObject(chat.history)
    ? chat.history
    : requestPayload && isObject(requestPayload.history)
      ? requestPayload.history
      : null;
  if (!history || !isObject(history.messages)) return [];

  const conversationId =
    stringField(responseChat, ["id", "chat_id", "chatId"]) ||
    stringField(payload, ["id", "chat_id", "chatId"]) ||
    stringField(chat, ["id", "chat_id", "chatId"]) ||
    (requestPayload ? stringField(requestPayload, ["id", "chat_id", "chatId"]) : "") ||
    zAiApiConversationId(requestUrl);
  const currentId = stringField(history, ["currentId", "current_id"]);
  if (!conversationId || !currentId || Object.keys(history.messages).length === 0) return [];

  const chain = activeMessageChain(history.messages, currentId);
  if (!chain) return [];
  const scope: GlmNativeScope = {
    variant: "z-ai",
    host: new URL(requestUrl).hostname.toLowerCase(),
    conversationId
  };
  const turns = chainToTurns(scope, chain);
  return turns.length > 0 ? [{ ...scope, turns }] : [];
}

function scopeKey(scope: GlmNativeScope): string {
  return `${scope.variant}:${scope.host.toLowerCase()}:${scope.conversationId}`;
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

export class GlmNativeIndex {
  private activeScope: GlmNativeScope | null = null;
  private turnsByScope = new Map<string, Map<string, Turn>>();

  activate(scope: GlmNativeScope): void {
    const normalized = { ...scope, host: scope.host.toLowerCase() };
    const nextKey = scopeKey(normalized);
    if (this.activeScope && scopeKey(this.activeScope) === nextKey) return;
    this.activeScope = normalized;
    for (const cachedKey of this.turnsByScope.keys()) {
      if (cachedKey !== nextKey) this.turnsByScope.delete(cachedKey);
    }
  }

  ingest(body: string, requestUrl: string, requestBody = ""): string[] {
    const updated: string[] = [];
    const isPendingNewConversation = isZaiNewConversationRequest(requestUrl);
    for (const snapshot of parseGlmConversationResponse(body, requestUrl, requestBody)) {
      if (!this.activeScope) continue;
      const sameVariantAndHost =
        snapshot.variant === this.activeScope.variant &&
        snapshot.host.toLowerCase() === this.activeScope.host.toLowerCase();
      if (!sameVariantAndHost) continue;
      if (
        this.activeScope.conversationId &&
        snapshot.conversationId !== this.activeScope.conversationId &&
        !isPendingNewConversation
      ) {
        continue;
      }
      const key = scopeKey(snapshot);
      const previous = this.turnsByScope.get(key) ?? new Map<string, Turn>();
      const next = new Map<string, Turn>();
      for (const incoming of snapshot.turns) {
        const navigationId = incoming.navigation?.navigationId;
        if (!navigationId) continue;
        const existing = previous.get(navigationId);
        const sameBranch = existing?.navigation?.turnId === incoming.navigation?.turnId;
        next.set(navigationId, existing && sameBranch && !incomingTurnIsRicher(existing, incoming) ? existing : incoming);
      }
      this.turnsByScope.set(key, next);
      updated.push(snapshot.conversationId);
    }
    return updated;
  }

  getActiveTurns(): Turn[] {
    if (!this.activeScope) return [];
    const turns = this.turnsByScope.get(scopeKey(this.activeScope));
    return turns ? normalizeTurnIndexes([...turns.values()]) : [];
  }
}

function nativeMessageIdFromMountedId(value: string | undefined): string {
  if (!value?.startsWith("message-")) return value ?? "";
  return value.slice("message-".length).replace(/-start$/, "");
}

export function mergeGlmNativeTurns(nativeTurns: Turn[], mountedTurns: Turn[]): Turn[] {
  const mountedByMessageId = new Map(
    mountedTurns
      .map((turn) => [nativeMessageIdFromMountedId(turn.sourceAnchor.userMessageId), turn] as const)
      .filter(([messageId]) => Boolean(messageId))
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

function navigationScope(target: TurnNavigation): GlmNativeScope | null {
  const match = target.navigationId.match(/^glm-turn:(chatglm|z-ai):([^:]+):([^:]+):(.+)$/);
  if (!match) return null;
  return {
    variant: match[1] as GlmVariant,
    host: match[2].toLowerCase(),
    conversationId: match[3]
  };
}

export async function navigateGlmTarget<T extends MessageElement>(
  target: TurnNavigation,
  environment: GlmNavigationEnvironment<T>
): Promise<JumpToTurnResult> {
  const targetScope = navigationScope(target);
  if (target.site !== "glm" || !targetScope) {
    return { ok: false, reason: "The navigation identity does not belong to GLM / Z.ai." };
  }
  if (
    targetScope.variant !== environment.currentVariant ||
    targetScope.host !== environment.currentHost.toLowerCase() ||
    targetScope.conversationId !== environment.currentConversationId
  ) {
    return { ok: false, reason: "The GLM variant, host, or conversation changed, so TurnMap cleared the target." };
  }
  const messageId = target.messageId;
  if (!messageId) return { ok: false, reason: "The GLM navigation identity has no stable message ID." };

  const element = environment.findMounted(messageId);
  if (!element) {
    return {
      ok: false,
      reason: "The original Z.ai turn is not mounted. TurnMap did not use text matching or scroll search."
    };
  }
  if (element.id !== `message-${messageId}` && element.id !== `message-${messageId}-start`) {
    return { ok: false, reason: "Z.ai mounted a different message, so TurnMap refused to navigate." };
  }
  environment.reveal(element);
  return { ok: true };
}

export function glmConversationIdFromUrl(input: string): string {
  try {
    const url = new URL(input);
    if (glmVariantFromUrl(url.href) !== "z-ai") return "";
    const match = url.pathname.match(/^\/c\/([^/?#]+)\/?$/i);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function cssIdValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

export function findMountedGlmMessageElement(messageId: string): HTMLElement | null {
  if (!messageId) return null;
  const value = cssIdValue(messageId);
  for (const candidate of document.querySelectorAll<HTMLElement>(
    `#message-${value}, #message-${value}-start`
  )) {
    if (candidate.id === `message-${messageId}` || candidate.id === `message-${messageId}-start`) return candidate;
  }
  return null;
}

export const glmNativeIndex = new GlmNativeIndex();

let observerStarted = false;
let observerListener: (() => void) | null = null;

function postObserverCommand(type: "flush" | "ack", payload?: unknown): void {
  window.postMessage({ source: OBSERVER_COMMAND_SOURCE, type, payload }, window.location.origin);
}

export function startGlmNativeObserver(listener: () => void): void {
  observerListener = listener;
  if (!observerStarted) {
    observerStarted = true;
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: { id?: string; url?: string; body?: string; requestBody?: string };
      } | null;
      if (!data || data.source !== OBSERVER_SOURCE || data.type !== "capture") return;
      const id = data.payload?.id;
      try {
        if (typeof data.payload?.body === "string" && typeof data.payload.url === "string") {
          if (glmNativeIndex.ingest(data.payload.body, data.payload.url, data.payload.requestBody).length > 0) {
            observerListener?.();
          }
        }
      } finally {
        if (typeof id === "string") postObserverCommand("ack", { id });
      }
    });
  }
  postObserverCommand("flush");
}
