import type { Turn, TurnNavigation } from "../shared/types.ts";
import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import { normalizeWebText } from "./web-adapter-core.ts";

const GEMINI_HISTORY_RPC_ID = "hNvQHb";
const EMPTY_ASSISTANT_REPLY = "No text response";
const OBSERVER_SOURCE = "turnmap-gemini-observer";
const OBSERVER_COMMAND_SOURCE = "turnmap-gemini-observer-command";

type GeminiRpcTurn = {
  conversationId: string;
  requestId: string;
  responseId: string;
  userText: string;
  assistantText: string;
  timestampMs?: number;
  payloadOrder: number;
};

export type GeminiNativeSnapshot = {
  conversationId: string;
  turns: Turn[];
};

export type GeminiNativeBinding = {
  complete: boolean;
  turns: Turn[];
};

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function stringsWithin(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!isArray(value)) return [];
  return value.flatMap(stringsWithin);
}

function timestampFromTurn(node: unknown[]): number | undefined {
  for (let index = node.length - 1; index >= 0; index -= 1) {
    const candidate = node[index];
    if (!isArray(candidate) || candidate.length < 2) continue;
    const [seconds, nanos] = candidate;
    if (!Number.isInteger(seconds) || typeof nanos !== "number") continue;
    if ((seconds as number) < 1_420_000_000 || (seconds as number) > 4_000_000_000) continue;
    if (nanos < 0 || nanos >= 1_000_000_000) continue;
    return (seconds as number) * 1000 + Math.round(nanos / 1_000_000);
  }
  return undefined;
}

function responseContentForId(value: unknown, responseId: string): string {
  if (!isArray(value)) return "";
  if (value[0] === responseId && isArray(value[1])) {
    return normalizeWebText(stringsWithin(value[1]).join("\n"));
  }
  for (const child of value) {
    const result = responseContentForId(child, responseId);
    if (result) return result;
  }
  return "";
}

function readRpcTurn(value: unknown, payloadOrder: number): GeminiRpcTurn | null {
  if (!isArray(value)) return null;
  const primaryIds = value[0];
  const branchIds = value[1];
  const prompt = value[2];
  if (!isArray(primaryIds) || !isArray(branchIds) || !isArray(prompt)) return null;

  const conversationId = primaryIds[0];
  const requestId = primaryIds[1];
  const responseId = branchIds[2];
  const promptEnvelope = prompt[0];
  const userText = isArray(promptEnvelope) ? promptEnvelope[0] : undefined;
  if (
    typeof conversationId !== "string" ||
    !conversationId.startsWith("c_") ||
    typeof requestId !== "string" ||
    !requestId ||
    typeof responseId !== "string" ||
    !responseId ||
    typeof userText !== "string" ||
    !userText.trim()
  ) {
    return null;
  }

  return {
    conversationId,
    requestId,
    responseId,
    userText: normalizeWebText(userText),
    assistantText: responseContentForId(value[3], responseId) || EMPTY_ASSISTANT_REPLY,
    timestampMs: timestampFromTurn(value),
    payloadOrder
  };
}

function collectRpcTurns(payload: unknown): GeminiRpcTurn[] {
  const turns: GeminiRpcTurn[] = [];
  let payloadOrder = 0;
  const visit = (value: unknown) => {
    const turn = readRpcTurn(value, payloadOrder);
    if (turn) {
      turns.push(turn);
      payloadOrder += 1;
      return;
    }
    if (isArray(value)) value.forEach(visit);
  };
  visit(payload);
  return turns;
}

function decodeJsonLines(body: string): unknown[] {
  const values: unknown[] = [];
  for (const line of body.replace(/^\)\]\}'\s*/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;
    try {
      values.push(JSON.parse(trimmed));
    } catch {
      // Length lines and unrelated malformed frames are ignored.
    }
  }
  return values;
}

function collectHistoryPayloads(value: unknown, payloads: unknown[]): void {
  if (!isArray(value)) return;
  if (value[0] === "wrb.fr" && value[1] === GEMINI_HISTORY_RPC_ID && typeof value[2] === "string") {
    try {
      payloads.push(JSON.parse(value[2]));
    } catch {
      // A changed or truncated Gemini frame must fail closed.
    }
    return;
  }
  value.forEach((child) => collectHistoryPayloads(child, payloads));
}

function navigationFor(record: GeminiRpcTurn, turnIndex: number): TurnNavigation {
  return {
    kind: "ophel_notSourceAnchor",
    site: "gemini",
    navigationId: `gemini-turn:${record.conversationId}:${record.requestId}:${record.responseId}`,
    identitySource: "native-message-id",
    messageId: record.requestId,
    turnId: record.responseId,
    nativeTocIndex: turnIndex,
    turnIndex,
    textHash: hashText(record.userText),
    userPreview: record.userText.slice(0, 120)
  };
}

function recordsToTurns(records: GeminiRpcTurn[]): Turn[] {
  const sorted = [...records].sort((left, right) => {
    if (left.timestampMs != null && right.timestampMs != null && left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    return left.payloadOrder - right.payloadOrder;
  });
  const assignTurnId = stableTurnIdAssigner();
  return sorted.map((record, turnIndex) => {
    const sourceAnchor = {
      turnIndex,
      userMessageId: record.requestId,
      assistantMessageId: record.responseId,
      userHash: hashText(record.userText),
      assistantHash: hashText(record.assistantText),
      userPreview: record.userText.slice(0, 120),
      assistantPreview: record.assistantText.slice(0, 120)
    };
    return {
      id: assignTurnId(sourceAnchor),
      turnIndex,
      userText: record.userText,
      assistantText: record.assistantText,
      sourceAnchor,
      navigation: navigationFor(record, turnIndex),
      extractedAt: Date.now()
    };
  });
}

export function parseGeminiBatchExecute(body: string): GeminiNativeSnapshot[] {
  const payloads: unknown[] = [];
  decodeJsonLines(body).forEach((frame) => collectHistoryPayloads(frame, payloads));
  const byConversation = new Map<string, GeminiRpcTurn[]>();
  payloads.flatMap(collectRpcTurns).forEach((record) => {
    const existing = byConversation.get(record.conversationId);
    if (existing) existing.push(record);
    else byConversation.set(record.conversationId, [record]);
  });

  return [...byConversation].map(([conversationId, records]) => ({
    conversationId,
    turns: recordsToTurns(records)
  }));
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
      navigation: turn.navigation ? { ...turn.navigation, turnIndex, nativeTocIndex: turnIndex } : undefined
    };
  });
}

export class GeminiNativeIndex {
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
    for (const snapshot of parseGeminiBatchExecute(body)) {
      if (this.activeConversationId && snapshot.conversationId !== this.activeConversationId) continue;
      const merged = this.turnsByConversation.get(snapshot.conversationId) ?? new Map<string, Turn>();
      let changed = false;
      for (const turn of snapshot.turns) {
        const key = turn.navigation?.navigationId;
        if (!key) continue;
        const existing = merged.get(key);
        if (!existing || incomingTurnIsRicher(existing, turn)) {
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

function exactOrderedUserMatch(nativeTurns: Turn[], mountedTurns: Turn[]): boolean {
  return nativeTurns.every(
    (turn, index) => normalizeWebText(turn.userText) === normalizeWebText(mountedTurns[index]?.userText ?? "")
  );
}

export function bindGeminiNativeTurns(nativeTurns: Turn[], mountedTurns: Turn[]): GeminiNativeBinding {
  const nativePrefixIsMounted =
    nativeTurns.length > 0 &&
    mountedTurns.length >= nativeTurns.length &&
    exactOrderedUserMatch(nativeTurns, mountedTurns.slice(0, nativeTurns.length));
  if (!nativePrefixIsMounted) {
    return {
      complete: false,
      turns: mountedTurns.map((turn) => ({ ...turn, navigation: undefined }))
    };
  }

  const boundNativeTurns = nativeTurns.map((nativeTurn, index) => {
      const mountedTurn = mountedTurns[index];
      const mountedAnswer = mountedTurn.assistantText;
      const assistantText =
        nativeTurn.assistantText === EMPTY_ASSISTANT_REPLY || mountedAnswer.length > nativeTurn.assistantText.length
          ? mountedAnswer
          : nativeTurn.assistantText;
      return {
        ...nativeTurn,
        assistantText,
        sourceAnchor: {
          ...nativeTurn.sourceAnchor,
          assistantHash: hashText(assistantText),
          assistantPreview: assistantText.slice(0, 120)
        },
        extractedAt: Date.now()
      };
    });
  return {
    complete: nativeTurns.length === mountedTurns.length,
    turns: [
      ...boundNativeTurns,
      ...mountedTurns.slice(nativeTurns.length).map((turn) => ({ ...turn, navigation: undefined }))
    ]
  };
}

export function findGeminiMountedTurnIndex(
  target: TurnNavigation,
  nativeTurns: Turn[],
  mountedTurns: Turn[]
): number | null {
  const binding = bindGeminiNativeTurns(nativeTurns, mountedTurns);
  if (!binding.complete) return null;
  const index = binding.turns.findIndex((turn) => turn.navigation?.navigationId === target.navigationId);
  return index >= 0 ? index : null;
}

export function geminiConversationIdFromUrl(input: string): string {
  try {
    const match = new URL(input).pathname.match(/\/app\/([^/?#]+)/);
    if (!match?.[1]) return "";
    return match[1].startsWith("c_") ? match[1] : `c_${match[1]}`;
  } catch {
    return "";
  }
}

export const geminiNativeIndex = new GeminiNativeIndex();

let observerStarted = false;
let observerListener: (() => void) | null = null;

function postObserverCommand(type: "flush" | "ack", payload?: unknown): void {
  window.postMessage({ source: OBSERVER_COMMAND_SOURCE, type, payload }, window.location.origin);
}

export function startGeminiNativeObserver(listener: () => void): void {
  observerListener = listener;
  if (!observerStarted) {
    observerStarted = true;
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; payload?: { id?: string; body?: string } } | null;
      if (!data || data.source !== OBSERVER_SOURCE || data.type !== "capture") return;
      const id = data.payload?.id;
      try {
        if (typeof data.payload?.body === "string") {
          const updated = geminiNativeIndex.ingest(data.payload.body);
          if (updated.length > 0) observerListener?.();
        }
      } finally {
        if (typeof id === "string") postObserverCommand("ack", { id });
      }
    });
  }
  postObserverCommand("flush");
}
