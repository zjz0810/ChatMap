import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import type { SourceAnchor, Turn } from "../shared/types";
import { createChatGptTurnNavigation } from "./chatgpt-ophel-navigation.ts";
import { normalizeTurnIndexes } from "./turn-extractor.ts";

type ChatGptRole = "user" | "assistant" | "system" | "tool";

type ChatGptMessage = {
  id?: string;
  author?: {
    role?: ChatGptRole;
  };
  content?: {
    parts?: unknown[];
    text?: unknown;
    content_type?: unknown;
  };
  metadata?: {
    is_visually_hidden_from_conversation?: unknown;
    message_type?: unknown;
    [key: string]: unknown;
  };
  create_time?: number;
};

type MappingNode = {
  id?: string;
  parent?: string;
  children?: string[];
  message?: ChatGptMessage | null;
};

type ConversationCandidate = {
  mapping: Record<string, MappingNode>;
  currentNode?: string;
};

type FlatMessage = {
  role: "user" | "assistant";
  id?: string;
  text: string;
  createdAt?: number;
  attachmentNames?: string[];
  order: number;
};

const MAX_SCRIPT_CHARS = 12_000_000;
const MAX_STORAGE_CHARS = 12_000_000;
const MAX_IDB_RECORDS_PER_STORE = 250;
const MAX_OBJECT_VISITS = 30_000;
const EMPTY_ASSISTANT_REPLY = "无文字回复";

export type StructuredExtractionResult = {
  turns: Turn[];
  source: "structured" | "web-storage" | "indexeddb";
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function preview(text: string): string {
  return normalizeText(text).slice(0, 120);
}

function epochMilliseconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value < 100_000_000_000 ? value * 1000 : value;
}

function extractAttachmentNamesFromText(text: string): string[] {
  const names = new Set<string>();
  const pattern =
    /[^\s\\/:*?"<>|]{1,120}\.(?:pdf|docx?|pptx?|xlsx?|csv|tsv|txt|md|png|jpe?g|gif|webp|zip|json|py|js|ts|tsx|html|css)\b/gi;

  for (const match of text.matchAll(pattern)) {
    const name = match[0].replace(/\s+/g, " ").trim();
    if (name) names.add(name);
  }

  return [...names].slice(0, 8);
}

function normalizeAttachmentName(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const basename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    return basename.replace(/\s+/g, " ").trim();
  } catch {
    return trimmed.split(/[\\/]/).pop()?.replace(/\s+/g, " ").trim() ?? "";
  }
}

function isUsefulAttachmentName(value: string): boolean {
  if (!value || value.length > 160) return false;
  if (/^(image|file|attachment|download)$/i.test(value)) return false;
  return true;
}

function addAttachmentName(names: Set<string>, value: string): void {
  const normalized = normalizeAttachmentName(value);
  if (isUsefulAttachmentName(normalized)) names.add(normalized);
}

function extractAttachmentNamesFromUnknown(value: unknown): string[] {
  const names = new Set<string>();
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  let visits = 0;

  while (stack.length > 0 && visits < 500) {
    const current = stack.pop();
    visits += 1;

    if (typeof current === "string") {
      for (const name of extractAttachmentNamesFromText(current)) names.add(name);
      continue;
    }

    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string" && /^(file_name|filename|fileName|original_filename|originalFileName)$/i.test(key)) {
        addAttachmentName(names, child);
      }
      if (typeof child === "string" && /^(name|image_name|imageName|display_name|displayName|title|download_url|url)$/i.test(key)) {
        for (const name of extractAttachmentNamesFromText(child)) names.add(name);
      }
      if (child && typeof child === "object") stack.push(child);
    }
  }

  return [...names].slice(0, 8);
}

function textFromAttachmentNames(role: "user" | "assistant", attachmentNames: string[]): string {
  if (attachmentNames.length === 0) return "";
  const label = role === "assistant" ? "Assistant returned attachment" : "User sent attachment";
  return `${label}: ${attachmentNames.join(", ")}`;
}

function fallbackTextForMessage(role: "user" | "assistant", attachmentNames: string[]): string {
  return textFromAttachmentNames(role, attachmentNames) || (role === "assistant" ? EMPTY_ASSISTANT_REPLY : "");
}

function textFromContentValue(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((part) => textFromContentValue(part, depth + 1)).filter(Boolean).join("\n");
  }

  if (typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  const direct = [
    textFromContentValue(record.text, depth + 1),
    textFromContentValue(record.markdown, depth + 1),
    textFromContentValue(record.content, depth + 1),
    textFromContentValue(record.value, depth + 1),
    textFromContentValue(record.parts, depth + 1)
  ];

  return direct.filter(Boolean).join("\n");
}

function textFromMessage(message: ChatGptMessage): string {
  return normalizeText(textFromContentValue(message.content));
}

function isAllowedContentType(message: ChatGptMessage): boolean {
  const contentType = message.content?.content_type;
  if (typeof contentType !== "string" || !contentType) return true;
  return !/tool|system|reason|analysis|thought|debug|execution|code|error/i.test(contentType);
}

function isVisibleConversationMessage(message: ChatGptMessage): boolean {
  if (message.metadata?.is_visually_hidden_from_conversation === true) return false;
  if (!isAllowedContentType(message)) return false;

  const messageType = message.metadata?.message_type;
  if (typeof messageType === "string" && /tool|system|reason|analysis|thought|debug/i.test(messageType)) {
    return false;
  }

  return true;
}

function isMapping(value: unknown): value is Record<string, MappingNode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const entries = Object.values(value as Record<string, unknown>);
  if (entries.length === 0) return false;

  let messageLikeCount = 0;
  for (const entry of entries.slice(0, 80)) {
    if (
      entry &&
      typeof entry === "object" &&
      "message" in entry &&
      ((entry as MappingNode).message === null || typeof (entry as MappingNode).message === "object")
    ) {
      messageLikeCount += 1;
    }
  }

  return messageLikeCount >= 2;
}

function findConversationCandidates(root: unknown): ConversationCandidate[] {
  const candidates: ConversationCandidate[] = [];
  const stack: unknown[] = [root];
  const seen = new WeakSet<object>();
  let visits = 0;

  while (stack.length > 0 && visits < MAX_OBJECT_VISITS) {
    const value = stack.pop();
    visits += 1;

    if (!value || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);

    const record = value as Record<string, unknown>;
    if (isMapping(record.mapping)) {
      candidates.push({
        mapping: record.mapping,
        currentNode: typeof record.current_node === "string" ? record.current_node : undefined
      });
    }

    for (const child of Object.values(record)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }

  return candidates;
}

function getOrderedMappingNodes(candidate: ConversationCandidate): MappingNode[] {
  const nodes = candidate.mapping;
  const ordered: MappingNode[] = [];

  if (candidate.currentNode && nodes[candidate.currentNode]) {
    const reversed: MappingNode[] = [];
    let current: MappingNode | undefined = nodes[candidate.currentNode];
    const seen = new Set<string>();

    while (current) {
      const id = current.id;
      if (id && seen.has(id)) break;
      if (id) seen.add(id);
      reversed.push(current);
      current = current.parent ? nodes[current.parent] : undefined;
    }

    ordered.push(...reversed.reverse());
  }

  if (ordered.length === 0) {
    ordered.push(
      ...Object.values(nodes)
        .map((node, originalIndex) => ({ node, originalIndex }))
        .sort((left, right) => {
          const leftTime = left.node.message?.create_time;
          const rightTime = right.node.message?.create_time;
          const leftHasTime = typeof leftTime === "number" && Number.isFinite(leftTime);
          const rightHasTime = typeof rightTime === "number" && Number.isFinite(rightTime);
          if (leftHasTime && rightHasTime) return leftTime - rightTime || left.originalIndex - right.originalIndex;
          if (leftHasTime) return -1;
          if (rightHasTime) return 1;
          return left.originalIndex - right.originalIndex;
        })
        .map(({ node }) => node)
    );
  }

  const hasCompleteMessageTimes = ordered.length > 1 && ordered.every(
    (node) => typeof node.message?.create_time === "number" && Number.isFinite(node.message.create_time)
  );
  if (hasCompleteMessageTimes) {
    return ordered
      .map((node, originalIndex) => ({ node, originalIndex }))
      .sort((left, right) =>
        (left.node.message?.create_time ?? 0) - (right.node.message?.create_time ?? 0) ||
        left.originalIndex - right.originalIndex
      )
      .map(({ node }) => node);
  }

  return ordered;
}

function extractMessages(candidate: ConversationCandidate): FlatMessage[] {
  const messages: FlatMessage[] = [];

  for (const node of getOrderedMappingNodes(candidate)) {
    const message = node.message;
    const role = message?.author?.role;
    if (role !== "user" && role !== "assistant") continue;

    if (!message) continue;
    if (!isVisibleConversationMessage(message)) continue;

    const attachmentNames = extractAttachmentNamesFromUnknown(message);
    const text = textFromMessage(message) || textFromAttachmentNames(role, attachmentNames);
    if (!text) continue;

    messages.push({
      role,
      id: message.id ?? node.id,
      text,
      createdAt: epochMilliseconds(message.create_time),
      attachmentNames,
      order: messages.length
    });
  }

  return messages;
}

function turnsFromMessages(messages: FlatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let pendingUser: FlatMessage | null = null;
  const assignTurnId = stableTurnIdAssigner();

  const pushTurn = (user: FlatMessage, assistant?: FlatMessage) => {
    const assistantText = assistant?.text || EMPTY_ASSISTANT_REPLY;
    const turnIndex = turns.length;
    const sourceAnchor: SourceAnchor = {
      turnIndex,
      userMessageId: user.id,
      assistantMessageId: assistant?.id,
      userAttachmentNames: user.attachmentNames,
      userHash: hashText(user.text),
      assistantHash: hashText(assistantText),
      userPreview: preview(user.text),
      assistantPreview: preview(assistantText)
    };

    turns.push({
      id: assignTurnId(sourceAnchor),
      turnIndex,
      userText: user.text,
      assistantText,
      sourceAnchor,
      navigation: createChatGptTurnNavigation({
        index: turnIndex,
        text: user.text,
        messageId: user.id
      }),
      createdAt: user.createdAt,
      extractedAt: Date.now()
    });
  };

  for (const message of messages) {
    if (message.role === "user") {
      if (pendingUser) {
        pushTurn(pendingUser);
      }
      pendingUser = message;
      continue;
    }

    if (message.role === "assistant" && pendingUser) {
      pushTurn(pendingUser, message);
      pendingUser = null;
    }
  }

  if (pendingUser) {
    pushTurn(pendingUser);
  }

  return normalizeTurnIndexes(turns);
}

function parseJsonSafely(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_SCRIPT_CHARS) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function getStructuredRoots(): unknown[] {
  const roots: unknown[] = [];

  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent ?? "";
    if (!text.includes("mapping") && !text.includes("current_node")) continue;

    const parsed = parseJsonSafely(text);
    if (parsed) roots.push(parsed);
  }

  const nextData = document.getElementById("__NEXT_DATA__")?.textContent;
  if (nextData) {
    const parsed = parseJsonSafely(nextData);
    if (parsed) roots.push(parsed);
  }

  return roots;
}

function getWebStorageRoots(): unknown[] {
  const roots: unknown[] = [];
  const storages = [window.localStorage, window.sessionStorage];

  for (const storage of storages) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;

      const value = storage.getItem(key);
      if (!value || value.length > MAX_STORAGE_CHARS) continue;
      if (!value.includes("mapping") && !value.includes("current_node")) continue;

      const parsed = parseJsonSafely(value);
      if (parsed) roots.push(parsed);
    }
  }

  return roots;
}

export function getBestTurnsFromRoots(roots: unknown[]): Turn[] {
  let bestTurns: Turn[] = [];
  let bestScore = -1;

  for (const root of roots) {
    for (const candidate of findConversationCandidates(root)) {
      const turns = turnsFromMessages(extractMessages(candidate));
      const qualityScore =
        turns.length * 100_000 +
        turns.filter((turn) => turn.assistantText !== EMPTY_ASSISTANT_REPLY).length * 1_000 +
        turns.reduce((total, turn) => total + Math.min(turn.assistantText.length, 500), 0);

      if (qualityScore > bestScore) {
        bestTurns = turns;
        bestScore = qualityScore;
      }
    }
  }

  return bestTurns;
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB open blocked for ${name}`));
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(new Error(`Refusing to upgrade IndexedDB ${name}`));
    };
  });
}

async function readStoreSamples(database: IDBDatabase, storeName: string): Promise<unknown[]> {
  const transaction = database.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const roots: unknown[] = [];

  if ("getAll" in store) {
    const records = await readRequest(store.getAll(undefined, MAX_IDB_RECORDS_PER_STORE));
    roots.push(...records);
  }

  return roots;
}

async function getIndexedDbRoots(): Promise<unknown[]> {
  if (!indexedDB.databases) return [];

  const roots: unknown[] = [];
  const databases = await indexedDB.databases();

  for (const info of databases) {
    if (!info.name) continue;

    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase(info.name);
      for (const storeName of Array.from(database.objectStoreNames)) {
        const samples = await readStoreSamples(database, storeName);
        roots.push(...samples);
      }
    } catch {
      // Ignore stores that are unavailable or blocked.
    } finally {
      database?.close();
    }
  }

  return roots;
}

export async function extractStructuredTurns(): Promise<StructuredExtractionResult | null> {
  const scriptTurns = getBestTurnsFromRoots(getStructuredRoots());
  if (scriptTurns.length > 0) {
    return { turns: scriptTurns, source: "structured" };
  }

  const storageTurns = getBestTurnsFromRoots(getWebStorageRoots());
  if (storageTurns.length > 0) {
    return { turns: storageTurns, source: "web-storage" };
  }

  const idbTurns = getBestTurnsFromRoots(await getIndexedDbRoots());
  if (idbTurns.length > 0) {
    return { turns: idbTurns, source: "indexeddb" };
  }

  return null;
}
