import type { JumpToTurnResult, Turn, TurnNavigation } from "../shared/types.ts";
import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import { normalizeWebText } from "./web-adapter-core.ts";

const EMPTY_ASSISTANT_REPLY = "No text response";
const OBSERVER_SOURCE = "turnmap-grok-observer";
const OBSERVER_COMMAND_SOURCE = "turnmap-grok-observer-command";

type GrokResponseRecord = {
  responseId: string;
  sender: "user" | "assistant";
  message: string;
  parentResponseId?: string;
  createTime?: string;
  payloadOrder: number;
};

export type GrokConversationContext = {
  origin: string;
  conversationId: string;
};

export type GrokNativeSnapshot = GrokConversationContext & {
  turns: Turn[];
};

type ParsedGrokSnapshot = GrokConversationContext & {
  records: GrokResponseRecord[];
};

export type GrokMountedTarget = Pick<HTMLElement, "id" | "getAttribute">;

export type GrokNavigationDependencies = {
  findMounted(responseId: string): GrokMountedTarget | null;
  reveal(element: GrokMountedTarget): void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function senderFromValue(value: unknown): GrokResponseRecord["sender"] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "human" || normalized === "user") return "user";
  if (normalized === "assistant" || normalized === "model" || normalized === "grok") return "assistant";
  return null;
}

function parseJsonFrames(body: string): unknown[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    const frames: unknown[] = [];
    for (const rawLine of trimmed.split(/\r?\n/)) {
      const line = rawLine.replace(/^data:\s*/i, "").trim();
      if (!line || line === "[DONE]") continue;
      try {
        frames.push(JSON.parse(line));
      } catch {
        // Incomplete streaming frames fail closed until the observer publishes more bytes.
      }
    }
    return frames;
  }
}

function collectConversationIds(value: unknown, result: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectConversationIds(child, result));
    return;
  }
  if (!isObject(value)) return;
  const conversationId = stringField(value, ["conversationId", "conversation_id"]);
  if (conversationId) result.push(conversationId);
  Object.values(value).forEach((child) => collectConversationIds(child, result));
}

function collectResponseRecords(value: unknown, records: GrokResponseRecord[], order: { value: number }): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectResponseRecords(child, records, order));
    return;
  }
  if (!isObject(value)) return;

  const responseId = stringField(value, ["responseId", "response_id"]);
  const sender = senderFromValue(value.sender ?? value.role ?? value.author);
  if (responseId && sender) {
    records.push({
      responseId,
      sender,
      message: normalizeWebText(stringField(value, ["message", "text", "content"])),
      parentResponseId: stringField(value, ["parentResponseId", "parent_response_id"]) || undefined,
      createTime: stringField(value, ["createTime", "create_time", "createdAt", "created_at"]) || undefined,
      payloadOrder: order.value++
    });
  }

  Object.values(value).forEach((child) => collectResponseRecords(child, records, order));
}

function requestMessageFromPayload(value: unknown): { message: string; parentResponseId?: string } | null {
  if (!isObject(value)) return null;
  const requestBody = value.turnmapRequestBody;
  if (typeof requestBody !== "string") return null;
  for (const frame of parseJsonFrames(requestBody)) {
    if (!isObject(frame)) continue;
    const message = normalizeWebText(stringField(frame, ["message", "text", "prompt"]));
    if (!message) continue;
    return {
      message,
      parentResponseId: stringField(frame, ["parentResponseId", "parent_response_id"]) || undefined
    };
  }
  return null;
}

function responsePayloads(value: unknown): unknown[] {
  if (!isObject(value) || typeof value.turnmapResponseBody !== "string") return [value];
  return parseJsonFrames(value.turnmapResponseBody);
}

function conversationContextFromEndpoint(input: string): GrokConversationContext | null {
  try {
    const url = new URL(input);
    const endpoint = url.pathname.match(/\/rest\/app-chat\/conversations\/([^/]+)\/responses\/?$/i);
    if (!endpoint?.[1]) return null;
    return { origin: url.origin, conversationId: decodeURIComponent(endpoint[1]) };
  } catch {
    return null;
  }
}

function parseSnapshotRecords(url: string, body: string): ParsedGrokSnapshot[] {
  let outerFrames = parseJsonFrames(body);
  if (outerFrames.length === 0) return [];
  const endpointContext = conversationContextFromEndpoint(url);
  const origin = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  })();
  if (!origin) return [];

  const records: GrokResponseRecord[] = [];
  const conversationIds: string[] = [];
  const order = { value: 0 };
  let requestMessage: { message: string; parentResponseId?: string } | null = null;
  for (const outer of outerFrames) {
    requestMessage ??= requestMessageFromPayload(outer);
    for (const payload of responsePayloads(outer)) {
      collectConversationIds(payload, conversationIds);
      collectResponseRecords(payload, records, order);
    }
  }

  const conversationId = endpointContext?.conversationId ?? conversationIds.find(Boolean) ?? "";
  if (!conversationId) return [];

  if (requestMessage && !records.some((record) => record.sender === "user" && record.message === requestMessage?.message)) {
    const firstAssistant = records.find((record) => record.sender === "assistant" && record.parentResponseId);
    if (firstAssistant?.parentResponseId) {
      records.push({
        responseId: firstAssistant.parentResponseId,
        sender: "user",
        message: requestMessage.message,
        parentResponseId: requestMessage.parentResponseId,
        createTime: firstAssistant.createTime,
        payloadOrder: firstAssistant.payloadOrder - 1
      });
    }
  }

  return [{ origin, conversationId, records }];
}

function richestRecords(records: GrokResponseRecord[]): GrokResponseRecord[] {
  const byId = new Map<string, GrokResponseRecord>();
  for (const record of records) {
    const existing = byId.get(record.responseId);
    if (!existing || record.message.length > existing.message.length) byId.set(record.responseId, record);
  }
  return [...byId.values()];
}

function recordTime(record: GrokResponseRecord): number {
  const parsed = record.createTime ? Date.parse(record.createTime) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : record.payloadOrder;
}

function recordsToTurns(origin: string, conversationId: string, records: GrokResponseRecord[]): Turn[] {
  const unique = richestRecords(records);
  const users = unique
    .filter((record) => record.sender === "user" && record.message)
    .sort((left, right) => recordTime(left) - recordTime(right) || left.payloadOrder - right.payloadOrder);
  const assistants = unique.filter((record) => record.sender === "assistant");
  const assignTurnId = stableTurnIdAssigner();

  return users.map((user, turnIndex) => {
    const assistant = assistants
      .filter((candidate) => candidate.parentResponseId === user.responseId)
      .sort((left, right) => recordTime(left) - recordTime(right) || left.payloadOrder - right.payloadOrder)
      .at(-1);
    const assistantText = assistant?.message || EMPTY_ASSISTANT_REPLY;
    const sourceAnchor = {
      turnIndex,
      userMessageId: user.responseId,
      assistantMessageId: assistant?.responseId,
      userHash: hashText(user.message),
      assistantHash: hashText(assistantText),
      userPreview: user.message.slice(0, 120),
      assistantPreview: assistantText.slice(0, 120)
    };
    const navigation: TurnNavigation = {
      kind: "ophel_notSourceAnchor",
      site: "grok",
      navigationId: `grok-turn:${encodeURIComponent(origin)}:${conversationId}:${user.responseId}`,
      identitySource: "native-message-id",
      messageId: user.responseId,
      turnId: assistant?.responseId,
      parentMessageId: user.parentResponseId,
      nativeTocIndex: turnIndex,
      turnIndex,
      textHash: hashText(user.message),
      userPreview: user.message.slice(0, 120)
    };
    return {
      id: assignTurnId(sourceAnchor),
      turnIndex,
      userText: user.message,
      assistantText,
      sourceAnchor,
      navigation,
      extractedAt: Date.now()
    };
  });
}

export function parseGrokConversationResponse(url: string, body: string): GrokNativeSnapshot[] {
  return parseSnapshotRecords(url, body).map((snapshot) => ({
    origin: snapshot.origin,
    conversationId: snapshot.conversationId,
    turns: recordsToTurns(snapshot.origin, snapshot.conversationId, snapshot.records)
  }));
}

function cacheKey(origin: string, conversationId: string): string {
  return `${origin}|${conversationId}`;
}

export class GrokNativeIndex {
  private activeOrigin = "";
  private activeConversationId = "";
  private recordsByConversation = new Map<string, Map<string, GrokResponseRecord>>();

  activate(origin: string, conversationId: string): void {
    if (origin === this.activeOrigin && conversationId === this.activeConversationId) return;
    this.activeOrigin = origin;
    this.activeConversationId = conversationId;
    const activeKey = cacheKey(origin, conversationId);
    for (const cachedKey of this.recordsByConversation.keys()) {
      if (cachedKey !== activeKey) this.recordsByConversation.delete(cachedKey);
    }
  }

  ingest(url: string, body: string): string[] {
    const updated: string[] = [];
    for (const snapshot of parseSnapshotRecords(url, body)) {
      if (this.activeOrigin && snapshot.origin !== this.activeOrigin) continue;
      if (this.activeConversationId && snapshot.conversationId !== this.activeConversationId) continue;
      const key = cacheKey(snapshot.origin, snapshot.conversationId);
      const merged = this.recordsByConversation.get(key) ?? new Map<string, GrokResponseRecord>();
      let changed = false;
      for (const record of snapshot.records) {
        const existing = merged.get(record.responseId);
        if (!existing || record.message.length > existing.message.length || (!existing.parentResponseId && record.parentResponseId)) {
          merged.set(record.responseId, record);
          changed = true;
        }
      }
      this.recordsByConversation.set(key, merged);
      if (changed) updated.push(key);
    }
    return updated;
  }

  getActiveTurns(): Turn[] {
    if (!this.activeOrigin || !this.activeConversationId) return [];
    const records = this.recordsByConversation.get(cacheKey(this.activeOrigin, this.activeConversationId));
    return records ? recordsToTurns(this.activeOrigin, this.activeConversationId, [...records.values()]) : [];
  }
}

export function grokConversationContextFromUrl(input: string): GrokConversationContext {
  try {
    const url = new URL(input);
    const conversation = url.hostname === "grok.com" || url.hostname.endsWith(".grok.com")
      ? url.pathname.match(/^\/(?:c|chat)\/([^/?#]+)/i)?.[1]
      : undefined;
    return {
      origin: url.origin,
      conversationId: conversation ? decodeURIComponent(conversation) : ""
    };
  } catch {
    return { origin: "", conversationId: "" };
  }
}

function mountedResponseId(element: GrokMountedTarget): string {
  return element.getAttribute("data-response-id")
    || element.getAttribute("data-message-id")
    || element.id.replace(/^response-/, "");
}

export function findMountedGrokResponseElement(responseId: string): HTMLElement | null {
  if (!responseId) return null;
  const byId = document.getElementById(`response-${responseId}`);
  if (byId) return byId;
  for (const element of document.querySelectorAll<HTMLElement>("[data-response-id], [data-message-id]")) {
    if (mountedResponseId(element) === responseId) return element;
  }
  return null;
}

export async function navigateGrokTarget(
  target: TurnNavigation,
  dependencies: GrokNavigationDependencies
): Promise<JumpToTurnResult> {
  if (target.site !== "grok") return { ok: false, reason: "The navigation identity does not belong to Grok." };
  const responseId = target.turnId || target.messageId;
  if (!responseId) return { ok: false, reason: "The Grok turn has no stable backend response identity." };
  const mounted = dependencies.findMounted(responseId);
  if (!mounted || mountedResponseId(mounted) !== responseId) {
    return {
      ok: false,
      reason: "The exact Grok response is not mounted. TurnMap did not jump to a neighboring response or use text matching."
    };
  }
  dependencies.reveal(mounted);
  return { ok: true };
}

export const grokNativeIndex = new GrokNativeIndex();

let observerStarted = false;
let observerListener: (() => void) | null = null;

function postObserverCommand(type: "flush" | "ack", payload?: unknown): void {
  window.postMessage({ source: OBSERVER_COMMAND_SOURCE, type, payload }, window.location.origin);
}

export function startGrokNativeObserver(listener: () => void): void {
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
        if (typeof data.payload?.url === "string" && typeof data.payload?.body === "string") {
          const updated = grokNativeIndex.ingest(data.payload.url, data.payload.body);
          if (updated.length > 0) observerListener?.();
        }
      } finally {
        if (typeof id === "string") postObserverCommand("ack", { id });
      }
    });
  }
  postObserverCommand("flush");
}
