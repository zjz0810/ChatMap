import type { JumpToTurnResult, Turn, TurnNavigation } from "../shared/types.ts";
import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import { normalizeWebText } from "./web-adapter-core.ts";

const EMPTY_ASSISTANT_REPLY = "No text response";
const MESSAGE_ID_ATTRIBUTE = "data-turnmap-kimi-message-id";
const OBSERVER_SOURCE = "turnmap-kimi-observer";
const OBSERVER_COMMAND_SOURCE = "turnmap-kimi-observer-command";

type JsonObject = Record<string, unknown>;

type KimiMessageRecord = {
  id: string;
  parentId: string;
  childrenMessageIds: string[];
  role: "user" | "assistant";
  textParts: string[];
  payloadOrder: number;
};

type KimiPage = {
  messages: KimiMessageRecord[];
  nextPageToken: string;
};

type KimiConversationCache = {
  messages: Map<string, KimiMessageRecord>;
  pages: Map<string, string>;
  currentMessageId: string;
};

export type KimiNativeSnapshot = {
  conversationId: string;
  complete: boolean;
  turns: Turn[];
};

export type KimiCapture = {
  conversationId: string;
  pageToken: string;
  body: string;
};

type MessageElement = {
  getAttribute(name: string): string | null;
};

export type KimiNavigationEnvironment<T extends MessageElement> = {
  findMounted(messageId: string): T | null;
  requestNativeTarget(messageId: string): Promise<boolean>;
  waitForMounted(messageId: string): Promise<T | null>;
  reveal(element: T): void;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function field(value: JsonObject, snakeName: string, camelName: string): unknown {
  return value[snakeName] ?? value[camelName];
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function roleValue(value: unknown): KimiMessageRecord["role"] | null {
  const normalized = String(value).trim().toLowerCase();
  if (value === 2 || normalized === "user" || normalized.endsWith("_user")) return "user";
  if (value === 3 || normalized === "assistant" || normalized.endsWith("_assistant")) return "assistant";
  return null;
}

function uniqueTextParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const normalized = normalizeWebText(part);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function firstString(object: JsonObject | undefined, names: string[]): string {
  if (!object) return "";
  for (const name of names) {
    const value = stringValue(object[name]);
    if (value) return value;
  }
  return "";
}

function attachmentName(value: unknown): string {
  if (!isObject(value)) return "";
  const direct = firstString(value, ["name", "title", "file_name", "fileName"]);
  if (direct) return direct;
  return isObject(value.meta)
    ? firstString(value.meta, ["name", "title", "file_name", "fileName"])
    : "";
}

function blockTextParts(value: unknown): string[] {
  if (!isObject(value)) return [];
  const parts: string[] = [];
  const text = isObject(value.text) ? stringValue(value.text.content) : "";
  if (text) parts.push(text);

  const fileName = attachmentName(value.file);
  if (fileName) parts.push(fileName);

  for (const key of ["artifact", "resource_link", "resourceLink", "websites_template", "websitesTemplate"]) {
    if (!isObject(value[key])) continue;
    const title = firstString(value[key] as JsonObject, ["title", "name", "path"]);
    if (title) parts.push(title);
  }
  return parts;
}

function referenceTextParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const title = firstString(entry, ["title", "name"])
      || (isObject(entry.base) ? firstString(entry.base, ["title", "name"]) : "");
    return title ? [title] : [];
  });
}

function parseMessage(value: unknown, payloadOrder: number): KimiMessageRecord | null {
  if (!isObject(value)) return null;
  const id = stringValue(value.id);
  const role = roleValue(value.role);
  if (!id || !role) return null;
  const blocks = Array.isArray(value.blocks) ? value.blocks : [];
  return {
    id,
    parentId: stringValue(field(value, "parent_id", "parentId")),
    childrenMessageIds: stringList(field(value, "children_message_ids", "childrenMessageIds")),
    role,
    textParts: uniqueTextParts([
      ...blocks.flatMap(blockTextParts),
      ...referenceTextParts(value.references)
    ]),
    payloadOrder
  };
}

function parsePage(body: string): KimiPage | null {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(root) || !Array.isArray(root.messages)) return null;
  return {
    messages: root.messages.flatMap((value, index) => {
      const parsed = parseMessage(value, index);
      return parsed ? [parsed] : [];
    }),
    nextPageToken: stringValue(field(root, "next_page_token", "nextPageToken"))
  };
}

function pageChainComplete(pages: Map<string, string>): boolean {
  if (!pages.has("")) return false;
  const seen = new Set<string>();
  let token = "";
  for (;;) {
    if (seen.has(token) || !pages.has(token)) return false;
    seen.add(token);
    const next = pages.get(token) ?? "";
    if (!next) return true;
    token = next;
  }
}

function activePath(
  messages: Map<string, KimiMessageRecord>,
  currentMessageId: string
): { complete: boolean; messages: KimiMessageRecord[] } {
  const path: KimiMessageRecord[] = [];
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
    messageId = message.parentId;
  }
  return { complete, messages: path.reverse() };
}

function navigationFor(
  conversationId: string,
  userMessageId: string,
  turnIndex: number,
  userText: string
): TurnNavigation {
  return {
    kind: "ophel_notSourceAnchor",
    site: "kimi",
    navigationId: `kimi-turn:${conversationId}:${userMessageId}`,
    identitySource: "native-message-id",
    messageId: userMessageId,
    nativeTocIndex: turnIndex,
    turnIndex,
    textHash: hashText(userText),
    userPreview: userText.slice(0, 120)
  };
}

function pathToTurns(conversationId: string, path: KimiMessageRecord[]): Turn[] {
  const assignTurnId = stableTurnIdAssigner();
  const turns: Turn[] = [];
  for (let index = 0; index < path.length;) {
    const user = path[index];
    if (user.role !== "user") {
      index += 1;
      continue;
    }
    const assistants: KimiMessageRecord[] = [];
    let nextIndex = index + 1;
    while (nextIndex < path.length && path[nextIndex].role === "assistant") {
      assistants.push(path[nextIndex]);
      nextIndex += 1;
    }
    const userText = uniqueTextParts(user.textParts).join("\n");
    if (userText) {
      const assistantText = uniqueTextParts(assistants.flatMap(message => message.textParts)).join("\n")
        || EMPTY_ASSISTANT_REPLY;
      const turnIndex = turns.length;
      const sourceAnchor = {
        turnIndex,
        userMessageId: user.id,
        assistantMessageId: assistants[0]?.id,
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
        navigation: navigationFor(conversationId, user.id, turnIndex, userText),
        extractedAt: Date.now()
      });
    }
    index = nextIndex;
  }
  return turns;
}

function snapshotFromCache(conversationId: string, cache: KimiConversationCache): KimiNativeSnapshot {
  const path = activePath(cache.messages, cache.currentMessageId);
  return {
    conversationId,
    complete: pageChainComplete(cache.pages) && path.complete,
    turns: pathToTurns(conversationId, path.messages)
  };
}

export function parseKimiMessagesResponse(body: string, conversationId: string): KimiNativeSnapshot | null {
  const page = parsePage(body);
  if (!page || !conversationId) return null;
  const cache: KimiConversationCache = {
    messages: new Map(page.messages.map(message => [message.id, message])),
    pages: new Map([["", page.nextPageToken]]),
    currentMessageId: page.messages[0]?.id ?? ""
  };
  return snapshotFromCache(conversationId, cache);
}

function messageRichness(message: KimiMessageRecord): number {
  return message.textParts.join("\n").length + message.childrenMessageIds.length * 8;
}

function richerMessage(existing: KimiMessageRecord | undefined, incoming: KimiMessageRecord): KimiMessageRecord {
  if (!existing) return incoming;
  return messageRichness(incoming) >= messageRichness(existing) ? incoming : existing;
}

export class KimiNativeIndex {
  private activeConversationId = "";
  private caches = new Map<string, KimiConversationCache>();

  activate(conversationId: string): void {
    if (conversationId === this.activeConversationId) return;
    this.activeConversationId = conversationId;
    for (const cachedId of this.caches.keys()) {
      if (cachedId !== conversationId) this.caches.delete(cachedId);
    }
  }

  ingest(capture: KimiCapture): string[] {
    if (!capture.conversationId || (this.activeConversationId && capture.conversationId !== this.activeConversationId)) {
      return [];
    }
    const page = parsePage(capture.body);
    if (!page) return [];
    const cache = this.caches.get(capture.conversationId) ?? {
      messages: new Map<string, KimiMessageRecord>(),
      pages: new Map<string, string>(),
      currentMessageId: ""
    };
    let changed = false;
    for (const message of page.messages) {
      const current = cache.messages.get(message.id);
      const next = richerMessage(current, message);
      if (next !== current) {
        cache.messages.set(message.id, next);
        changed = true;
      }
    }
    if (capture.pageToken === "" && page.messages[0]?.id && page.messages[0].id !== cache.currentMessageId) {
      cache.currentMessageId = page.messages[0].id;
      changed = true;
    }
    if (cache.pages.get(capture.pageToken) !== page.nextPageToken) {
      cache.pages.set(capture.pageToken, page.nextPageToken);
      changed = true;
    }
    this.caches.set(capture.conversationId, cache);
    return changed ? [capture.conversationId] : [];
  }

  getActiveTurns(): Turn[] {
    const cache = this.caches.get(this.activeConversationId);
    return cache ? snapshotFromCache(this.activeConversationId, cache).turns : [];
  }

  hasCompleteActiveIndex(): boolean {
    const cache = this.caches.get(this.activeConversationId);
    return cache ? snapshotFromCache(this.activeConversationId, cache).complete : false;
  }
}

function isSyntheticMountedId(messageId: string): boolean {
  return /^(?:user|assistant)-\d+-[a-z0-9]+$/i.test(messageId);
}

function conversationIdFromTurns(turns: Turn[]): string {
  const navigationId = turns.find(turn => turn.navigation?.navigationId.startsWith("kimi-turn:"))
    ?.navigation?.navigationId;
  if (!navigationId) return "";
  return navigationId.slice("kimi-turn:".length, navigationId.lastIndexOf(":"));
}

export function bindKimiNativeTurns(nativeTurns: Turn[], mountedTurns: Turn[]): Turn[] {
  const mountedByMessageId = new Map(
    mountedTurns
      .filter(turn => turn.sourceAnchor.userMessageId && !isSyntheticMountedId(turn.sourceAnchor.userMessageId))
      .map(turn => [turn.sourceAnchor.userMessageId as string, turn] as const)
  );
  const nativeIds = new Set(nativeTurns.map(turn => turn.navigation?.messageId).filter(Boolean));
  const conversationId = conversationIdFromTurns(nativeTurns);
  const enriched = nativeTurns.map(turn => {
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
    .filter(turn => {
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
  return element?.getAttribute(MESSAGE_ID_ATTRIBUTE) === messageId;
}

export async function navigateKimiTarget<T extends MessageElement>(
  target: TurnNavigation,
  environment: KimiNavigationEnvironment<T>
): Promise<JumpToTurnResult> {
  const messageId = target.messageId;
  if (!messageId) return { ok: false, reason: "This Kimi turn has no stable message ID." };
  const mounted = environment.findMounted(messageId);
  if (elementHasMessageId(mounted, messageId)) {
    environment.reveal(mounted as T);
    return { ok: true };
  }
  if (!await environment.requestNativeTarget(messageId)) {
    return { ok: false, reason: "Kimi did not expose an exact message ID in its native client state." };
  }
  const remounted = await environment.waitForMounted(messageId);
  if (!elementHasMessageId(remounted, messageId)) {
    return { ok: false, reason: "Kimi did not remount the exact message ID before the navigation timeout." };
  }
  environment.reveal(remounted as T);
  return { ok: true };
}

export function kimiConversationIdFromUrl(input: string): string {
  try {
    return new URL(input).pathname.match(/^\/chat\/([^/?#]+)/)?.[1] ?? "";
  } catch {
    return "";
  }
}

function escapeAttribute(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

export function findMountedKimiMessageElement(messageId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    `[${MESSAGE_ID_ATTRIBUTE}="${escapeAttribute(messageId)}"]`
  );
}

export function waitForMountedKimiMessageElement(messageId: string, timeoutMs = 3200): Promise<HTMLElement | null> {
  const existing = findMountedKimiMessageElement(messageId);
  if (existing || typeof document === "undefined") return Promise.resolve(existing);
  return new Promise(resolve => {
    let settled = false;
    const finish = (element: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(element);
    };
    const observer = new MutationObserver(() => {
      const element = findMountedKimiMessageElement(messageId);
      if (element) finish(element);
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

export const kimiNativeIndex = new KimiNativeIndex();

let observerStarted = false;
let observerListener: (() => void) | null = null;
let requestSequence = 0;
const navigationRequests = new Map<string, (accepted: boolean) => void>();

function postObserverCommand(type: "flush" | "ack" | "navigate", payload?: unknown): void {
  window.postMessage({ source: OBSERVER_COMMAND_SOURCE, type, payload }, window.location.origin);
}

export function requestKimiNativeTarget(messageId: string): Promise<boolean> {
  const requestId = `${Date.now()}:${++requestSequence}`;
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      navigationRequests.delete(requestId);
      resolve(false);
    }, 1800);
    navigationRequests.set(requestId, accepted => {
      window.clearTimeout(timer);
      navigationRequests.delete(requestId);
      resolve(accepted);
    });
    postObserverCommand("navigate", { requestId, messageId });
  });
}

export function startKimiNativeObserver(listener: () => void): void {
  observerListener = listener;
  if (!observerStarted) {
    observerStarted = true;
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: {
          id?: string;
          body?: string;
          conversationId?: string;
          pageToken?: string;
          requestId?: string;
          accepted?: boolean;
        };
      } | null;
      if (!data || data.source !== OBSERVER_SOURCE) return;
      if (data.type === "capture") {
        const id = data.payload?.id;
        try {
          if (
            typeof data.payload?.body === "string"
            && typeof data.payload.conversationId === "string"
          ) {
            const updated = kimiNativeIndex.ingest({
              conversationId: data.payload.conversationId,
              pageToken: data.payload.pageToken ?? "",
              body: data.payload.body
            });
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
