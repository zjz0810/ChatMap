import { hashText } from "../shared/hash.ts";
import { mergeChatGptWindows } from "../shared/chatgpt-turn-order.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import type { SourceAnchor, Turn } from "../shared/types";

type MessageBlock = {
  role: "user" | "assistant";
  element: HTMLElement;
  text: string;
  messageId?: string;
  createdAt?: number;
  attachmentNames?: string[];
};

const USER_SELECTORS = [
  '[data-message-author-role="user"]',
  '[data-message-author-role="user"] [class*="whitespace-pre-wrap"]',
  ".whitespace-pre-wrap"
];

const ASSISTANT_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-message-author-role="assistant"] .markdown',
  ".markdown"
];

const CHATGPT_MODERN_USER_SELECTOR =
  '[class~="group/user-message"], [data-user-message-bubble], [data-conversation-role="user"]';
const CHATGPT_VIRTUALIZED_TURN_SELECTOR = "[data-virtualized-turn-content]";
const CHATGPT_ORDER_ATTRIBUTES = [
  "aria-posinset",
  "data-turn-index",
  "data-virtualized-index",
  "data-item-index",
  "data-index"
];

const EMPTY_ASSISTANT_REPLY = "无文字回复";

const NON_MESSAGE_TEXT_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "button",
  "input",
  "textarea",
  "select",
  "nav",
  "menu",
  "form",
  "[hidden]",
  "[aria-hidden='true']",
  "[role='button']",
  "[data-testid*='copy' i]",
  "[data-testid*='feedback' i]",
  "[data-testid*='composer' i]",
  "[data-testid*='sources' i]",
  "[data-testid*='share' i]",
  "[class~='turn-action-controls']",
  "[contenteditable='true']"
].join(",");

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function preview(text: string): string {
  return normalizeText(text).slice(0, 120);
}

function normalizeAttachmentName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractAttachmentNamesFromText(text: string): string[] {
  const names = new Set<string>();
  const pattern =
    /[^\s\\/:*?"<>|]{1,120}\.(?:pdf|docx?|pptx?|xlsx?|csv|tsv|txt|md|png|jpe?g|gif|webp|zip|json|py|js|ts|tsx|html|css)\b/gi;

  for (const match of text.matchAll(pattern)) {
    const name = normalizeAttachmentName(match[0]);
    if (name) names.add(name);
  }

  return [...names].slice(0, 8);
}

function extractAttachmentNames(element: HTMLElement): string[] {
  const names = new Set<string>();
  const selectors = [
    "[data-testid*='file' i]",
    "[data-testid*='attachment' i]",
    "[data-testid*='image' i]",
    "[aria-label*='file' i]",
    "[aria-label*='attachment' i]",
    "[aria-label*='image' i]",
    "img[alt]",
    "img[src]",
    "a[href*='file']",
    "a[download]"
  ];

  for (const candidate of element.querySelectorAll<HTMLElement>(selectors.join(","))) {
    for (const value of [
      candidate.getAttribute("download"),
      candidate.getAttribute("title"),
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("alt"),
      candidate.getAttribute("src"),
      candidate.innerText
    ]) {
      if (!value) continue;
      for (const name of extractAttachmentNamesFromText(value)) names.add(name);
    }
  }

  for (const name of extractAttachmentNamesFromText(readCleanText(element))) names.add(name);
  return [...names].slice(0, 8);
}

function textFromAttachmentNames(role: "user" | "assistant", attachmentNames: string[]): string {
  if (attachmentNames.length === 0) return "";
  const label = role === "assistant" ? "Assistant returned attachment" : "User sent attachment";
  return `${label}: ${attachmentNames.join(", ")}`;
}

function readCleanText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NON_MESSAGE_TEXT_SELECTORS).forEach((child) => child.remove());
  return normalizeText(clone.textContent ?? "");
}

function getMessageContentElements(root: HTMLElement, role: "user" | "assistant"): HTMLElement[] {
  if (role === "assistant") {
    const markdownBlocks = Array.from(root.querySelectorAll<HTMLElement>(".markdown")).filter(
      (element, _index, elements) => !elements.some((candidate) => candidate !== element && candidate.contains(element))
    );
    return markdownBlocks.length > 0 ? markdownBlocks : [root];
  }

  return [root.querySelector<HTMLElement>('[class*="whitespace-pre-wrap"]') ?? root];
}

function getMessageText(root: HTMLElement, role: "user" | "assistant"): string {
  const text = getMessageContentElements(root, role).map(readCleanText).filter(Boolean).join("\n\n");
  if (role === "user") return text;

  return normalizeText(
    text
      .replace(/\bThought for \d+s\b/gi, "")
      .replace(/已思考\s*\d+\s*秒?/g, "")
      .replace(/^思考中[.。…]*$/g, "")
  );
}

function uniqueElements(selectors: string[], doc: Document): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const elements: HTMLElement[] = [];

  for (const selector of selectors) {
    doc.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (!seen.has(element)) {
        seen.add(element);
        elements.push(element);
      }
    });
  }

  return elements;
}

function closestMessageRoot(element: HTMLElement): HTMLElement {
  return (
    element.closest<HTMLElement>('[data-message-author-role="user"]') ??
    element.closest<HTMLElement>('[data-message-author-role="assistant"]') ??
    element
  );
}

function hasMessageRole(element: HTMLElement, role: "user" | "assistant"): boolean {
  return element.getAttribute("data-message-author-role") === role;
}

function getMessageId(element: HTMLElement): string | undefined {
  // Modern ChatGPT often puts the stable identity on the surrounding turn
  // shell instead of on the user bubble. Without it, attachment-only bubbles
  // all look like the same "Open image" prompt and virtualized windows can
  // be appended as duplicate turns.
  const withIdentity =
    element.closest<HTMLElement>("[data-message-id], [data-turn-id], [data-turn-id-container], [data-turn-key], [data-testid^='conversation-turn']") ??
    element.querySelector<HTMLElement>("[data-message-id], [data-turn-id], [data-turn-id-container], [data-turn-key], [data-testid^='conversation-turn']");
  if (withIdentity) {
    for (const attribute of ["data-message-id", "data-turn-id", "data-turn-id-container", "data-turn-key", "data-testid"] as const) {
      const value = withIdentity.getAttribute(attribute)?.trim();
      if (value) return value;
    }
  }

  const testId = element.getAttribute("data-testid")?.trim();
  if (testId?.includes("message") || testId?.startsWith("conversation-turn")) return testId;

  return undefined;
}

function timestampValue(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createdAtFromElement(element: HTMLElement): number | undefined {
  const candidates = [
    element.matches("time[datetime]") ? element : null,
    element.querySelector<HTMLElement>("time[datetime]"),
    element.matches("[data-created-at], [data-timestamp]") ? element : null,
    element.querySelector<HTMLElement>("[data-created-at], [data-timestamp]")
  ].filter((candidate): candidate is HTMLElement => candidate !== null);

  for (const candidate of candidates) {
    const parsed = timestampValue(
      candidate.getAttribute("datetime") ??
      candidate.getAttribute("data-created-at") ??
      candidate.getAttribute("data-timestamp")
    );
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function virtualizedOrderFromElement(element: HTMLElement): number | undefined {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth <= 3; depth += 1, current = current.parentElement) {
    for (const attribute of CHATGPT_ORDER_ATTRIBUTES) {
      const value = current.getAttribute(attribute);
      if (value && /^\d+$/.test(value)) return Number(value);
    }
  }
  return undefined;
}

function elementContainsExistingBlock(blocks: MessageBlock[], element: HTMLElement): boolean {
  return blocks.some((block) => block.element.contains(element) || element.contains(block.element));
}

function getLegacyMessageBlocks(doc: Document): MessageBlock[] {
  const blocks: MessageBlock[] = [];

  for (const element of uniqueElements(USER_SELECTORS, doc)) {
    const root = closestMessageRoot(element);
    if (!hasMessageRole(root, "user")) continue;
    const attachmentNames = extractAttachmentNames(root);
    const text = getMessageText(root, "user") || textFromAttachmentNames("user", attachmentNames);
    if (text && !elementContainsExistingBlock(blocks, root)) {
      blocks.push({
        role: "user",
        element: root,
        text,
        messageId: getMessageId(root),
        createdAt: createdAtFromElement(root),
        attachmentNames
      });
    }
  }

  for (const element of uniqueElements(ASSISTANT_SELECTORS, doc)) {
    const root = closestMessageRoot(element);
    if (!hasMessageRole(root, "assistant")) continue;
    const attachmentNames = extractAttachmentNames(root);
    const text = getMessageText(root, "assistant") || textFromAttachmentNames("assistant", attachmentNames);
    if (text && !elementContainsExistingBlock(blocks, root)) {
      blocks.push({
        role: "assistant",
        element: root,
        text,
        messageId: getMessageId(root),
        createdAt: createdAtFromElement(root),
        attachmentNames
      });
    }
  }

  return blocks.sort((left, right) => {
    const position = left.element.compareDocumentPosition(right.element);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

type ModernChatGptEvent = {
  role: "user" | "assistant";
  text: string;
  element: HTMLElement;
  createdAt?: number;
};

function outermostElements(elements: HTMLElement[]): HTMLElement[] {
  return elements.filter((element) => !elements.some((candidate) => candidate !== element && candidate.contains(element)));
}

function modernChatGptEvents(doc: Document): ModernChatGptEvent[] {
  const virtualizedRoots = outermostElements(
    Array.from(doc.querySelectorAll<HTMLElement>(CHATGPT_VIRTUALIZED_TURN_SELECTOR))
  );
  const userMarkers = Array.from(doc.querySelectorAll<HTMLElement>(CHATGPT_MODERN_USER_SELECTOR));
  const roots = virtualizedRoots.length > 0
    ? virtualizedRoots
    : [doc.querySelector<HTMLElement>("main") ?? doc.body].filter((root): root is HTMLElement => Boolean(root));
  if (userMarkers.length === 0 || roots.length === 0) return [];

  if (virtualizedRoots.length > 1) {
    // ChatGPT can recycle virtualized DOM slots, so querySelectorAll order is
    // not necessarily chronological. Use actual conversation order on screen;
    // explicit per-turn timestamps take precedence when every root has one.
    const timestamps = roots.map(createdAtFromElement);
    const allHaveTimestamps = timestamps.every((value) => value !== undefined);
    if (allHaveTimestamps) {
      roots.splice(0, roots.length, ...roots
        .map((root, originalIndex) => ({ root, originalIndex, createdAt: timestamps[originalIndex]! }))
        .sort((left, right) => left.createdAt - right.createdAt || left.originalIndex - right.originalIndex)
        .map(({ root }) => root));
    } else {
      const virtualizedIndexes = roots.map(virtualizedOrderFromElement);
      const allHaveUniqueIndexes = virtualizedIndexes.every((value) => value !== undefined) &&
        new Set(virtualizedIndexes).size === roots.length;
      if (allHaveUniqueIndexes) {
        roots.splice(0, roots.length, ...roots
          .map((root, originalIndex) => ({ root, originalIndex, order: virtualizedIndexes[originalIndex]! }))
          .sort((left, right) => left.order - right.order || left.originalIndex - right.originalIndex)
          .map(({ root }) => root));
      } else {
        roots.splice(0, roots.length, ...roots
          .map((root, originalIndex) => ({ root, originalIndex, top: root.getBoundingClientRect().top }))
          .sort((left, right) => left.top - right.top || left.originalIndex - right.originalIndex)
          .map(({ root }) => root));
      }
    }
  }

  const events: ModernChatGptEvent[] = [];
  const assistantParts: string[] = [];
  let hasSeenUser = false;
  let assistantElement: HTMLElement | null = null;

  const flushAssistant = () => {
    const text = normalizeText(assistantParts.join(" "));
    if (hasSeenUser && text && assistantElement) {
      events.push({ role: "assistant", text, element: assistantElement, createdAt: createdAtFromElement(assistantElement) });
    }
    assistantParts.length = 0;
    assistantElement = null;
  };

  const walk = (node: Node, root: HTMLElement) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      if (hasSeenUser && text.trim()) {
        assistantElement ??= root;
        assistantParts.push(text);
      }
      return;
    }

    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches(NON_MESSAGE_TEXT_SELECTORS)) return;
    if (element.matches(CHATGPT_MODERN_USER_SELECTOR)) {
      flushAssistant();
      const userElement = element as HTMLElement;
      const text = readCleanText(userElement);
      if (text) {
        events.push({ role: "user", text, element: userElement, createdAt: createdAtFromElement(userElement) });
        hasSeenUser = true;
      }
      return;
    }

    element.childNodes.forEach((child) => walk(child, root));
  };

  for (const root of roots) {
    walk(root, root);
  }
  flushAssistant();
  return events;
}

function modernEventsToBlocks(events: ModernChatGptEvent[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  for (const event of events) {
    if (event.role === "user") {
      const attachmentNames = extractAttachmentNames(event.element);
      const text = event.text || textFromAttachmentNames("user", attachmentNames);
      if (text) {
        blocks.push({
          role: "user",
          element: event.element,
          text,
          messageId: getMessageId(event.element),
          createdAt: event.createdAt,
          attachmentNames
        });
      }
      continue;
    }

    const precedingUser = [...blocks].reverse().find((block) => block.role === "user");
    if (!precedingUser) continue;
    const lastBlock = blocks.at(-1);
    const attachmentNames = extractAttachmentNames(event.element);
    const text = event.text || textFromAttachmentNames("assistant", attachmentNames);
    if (!text) continue;
    if (lastBlock?.role === "assistant") {
      lastBlock.text = normalizeText(`${lastBlock.text} ${text}`);
      lastBlock.attachmentNames = [...new Set([...(lastBlock.attachmentNames ?? []), ...attachmentNames])];
    } else {
      blocks.push({
        role: "assistant",
        element: event.element,
        text,
        messageId: getMessageId(event.element),
        createdAt: event.createdAt,
        attachmentNames
      });
    }
  }
  return blocks;
}

function turnsFromMessageBlocks(blocks: MessageBlock[]): Turn[] {
  const turns: Turn[] = [];
  let pendingUser: MessageBlock | null = null;
  const assignTurnId = stableTurnIdAssigner();

  const pushTurn = (user: MessageBlock, assistant?: MessageBlock) => {
    const assistantText = assistant?.text || EMPTY_ASSISTANT_REPLY;
    const turnIndex = turns.length;
    const sourceAnchor: SourceAnchor = {
      turnIndex,
      userMessageId: user.messageId,
      assistantMessageId: assistant?.messageId,
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
      createdAt: user.createdAt,
      extractedAt: Date.now()
    });
  };

  for (const block of blocks) {
    if (block.role === "user") {
      if (pendingUser) {
        pushTurn(pendingUser);
      }
      pendingUser = block;
      continue;
    }

    if (block.role === "assistant" && pendingUser) {
      pushTurn(pendingUser, block);
      pendingUser = null;
    }
  }

  if (pendingUser) {
    pushTurn(pendingUser);
  }

  return turns;
}

export function extractModernChatGptTurns(doc: Document = document): Turn[] {
  return turnsFromMessageBlocks(modernEventsToBlocks(modernChatGptEvents(doc)));
}

function getMessageBlocks(doc: Document = document): MessageBlock[] {
  const modernBlocks = modernEventsToBlocks(modernChatGptEvents(doc));
  return modernBlocks.length > 0 ? modernBlocks : getLegacyMessageBlocks(doc);
}

export function extractTurns(doc: Document = document): Turn[] {
  return turnsFromMessageBlocks(getMessageBlocks(doc));
}

export function normalizeTurnIndexes(turns: Turn[]): Turn[] {
  const hasCompleteTimestamps = turns.length > 1 && turns.every(
    (turn) => typeof turn.createdAt === "number" && Number.isFinite(turn.createdAt)
  );
  const orderedTurns = hasCompleteTimestamps
    ? turns.map((turn, originalIndex) => ({ turn, originalIndex }))
        .sort((left, right) =>
          (left.turn.createdAt ?? 0) - (right.turn.createdAt ?? 0) ||
          left.turn.turnIndex - right.turn.turnIndex ||
          left.originalIndex - right.originalIndex
        )
        .map(({ turn }) => turn)
    : turns;

  return orderedTurns.map((turn, turnIndex) => {
    const sourceAnchor: SourceAnchor = {
      ...turn.sourceAnchor,
      turnIndex
    };

    return {
      ...turn,
      id: turn.id,
      turnIndex,
      sourceAnchor,
      navigation: turn.navigation
        ? {
            ...turn.navigation,
            turnIndex,
            nativeTocIndex: hasCompleteTimestamps
              ? turnIndex
              : turn.navigation.nativeTocIndex ?? turn.navigation.turnIndex ?? turnIndex
          }
        : undefined
    };
  });
}

function isFallbackAssistantText(text: string): boolean {
  return text.trim() === EMPTY_ASSISTANT_REPLY;
}

function mergeUserKey(turn: Turn): string {
  return turn.sourceAnchor.userMessageId
    ? `id:${turn.sourceAnchor.userMessageId}`
    : `hash:${turn.sourceAnchor.userHash}:${(turn.sourceAnchor.userAttachmentNames ?? []).join("|")}`;
}

function mergeTurnKey(turn: Turn): string {
  return turn.sourceAnchor.userMessageId || turn.sourceAnchor.assistantMessageId
    ? `${turn.sourceAnchor.userMessageId ?? ""}:${turn.sourceAnchor.assistantMessageId ?? ""}`
    : `${turn.sourceAnchor.userHash}:${turn.sourceAnchor.assistantHash}`;
}

function shouldReplaceMergedTurn(existing: Turn, next: Turn): boolean {
  if (isFallbackAssistantText(existing.assistantText) && !isFallbackAssistantText(next.assistantText)) return true;
  if (!existing.sourceAnchor.assistantMessageId && next.sourceAnchor.assistantMessageId) return true;
  return false;
}

export function mergeTurns(
  existingTurns: Turn[],
  newTurns: Turn[],
  chatGptDisjointPlacement: boolean | "prepend" = false
): Turn[] {
  if (newTurns.some((turn) => turn.navigation?.site === "chatgpt") &&
      [...existingTurns, ...newTurns].every((turn) => turn.navigation?.site === "chatgpt")) {
    return mergeChatGptWindows(existingTurns, newTurns, chatGptDisjointPlacement);
  }
  const merged = existingTurns.map((turn) => turn);
  const genericByUser = new Map<string, number>();
  merged.forEach((turn, index) => {
    if (turn.navigation?.site !== "chatgpt") genericByUser.set(mergeUserKey(turn), index);
  });

  for (const incoming of newTurns) {
    if (incoming.navigation?.site !== "chatgpt") {
      const userKey = mergeUserKey(incoming);
      const existingIndex = genericByUser.get(userKey);
      if (existingIndex !== undefined) {
        if (shouldReplaceMergedTurn(merged[existingIndex], incoming)) merged[existingIndex] = incoming;
        continue;
      }
      const exactDuplicate = merged.some((turn) =>
        turn.navigation?.site !== "chatgpt" && mergeTurnKey(turn) === mergeTurnKey(incoming)
      );
      if (exactDuplicate) continue;
      genericByUser.set(userKey, merged.length);
      merged.push(incoming);
      continue;
    }

    const matchingIndex = merged.findIndex((existing) => sameExtractedTurn(existing, incoming));
    if (matchingIndex === -1) {
      merged.push(incoming);
      continue;
    }
    const existing = merged[matchingIndex];
    if (existing.navigation?.site === "chatgpt") {
      merged[matchingIndex] = mergeChatGptStreamUpdate(existing, incoming);
    }
  }

  return normalizeTurnIndexes(merged);
}

function sameExtractedTurn(left: Turn, right: Turn): boolean {
  if (
    left.navigation?.site === "chatgpt" &&
    right.navigation?.site === "chatgpt" &&
    left.navigation.navigationId === right.navigation.navigationId
  ) return true;

  // The API and mounted ChatGPT DOM can expose different message ids for the
  // same active turn. A shared turn position plus the exact user prompt is a
  // stronger cross-source match than comparing those source-specific ids.
  if (
    left.navigation?.site === "chatgpt" &&
    right.navigation?.site === "chatgpt" &&
    left.turnIndex === right.turnIndex &&
    left.sourceAnchor.userHash === right.sourceAnchor.userHash
  ) return true;

  if (left.sourceAnchor.userMessageId && right.sourceAnchor.userMessageId) {
    return left.sourceAnchor.userMessageId === right.sourceAnchor.userMessageId;
  }

  if (left.navigation?.site === "chatgpt" && right.navigation?.site === "chatgpt") {
    return left.turnIndex === right.turnIndex && left.sourceAnchor.userHash === right.sourceAnchor.userHash;
  }

  const sameUser = mergeUserKey(left) === mergeUserKey(right);
  return sameUser && left.sourceAnchor.assistantHash === right.sourceAnchor.assistantHash;
}

function mergeChatGptStreamUpdate(existing: Turn, incoming: Turn): Turn {
  const sameChatGptTurn =
    existing.navigation?.site === "chatgpt" &&
    incoming.navigation?.site === "chatgpt" &&
    (existing.navigation.navigationId === incoming.navigation.navigationId ||
      (existing.turnIndex === incoming.turnIndex &&
        existing.sourceAnchor.userHash === incoming.sourceAnchor.userHash));
  const existingAssistantIsPlaceholder = isFallbackAssistantText(existing.assistantText);
  const assistantChanged =
    incoming.assistantText.trim() !== existing.assistantText.trim() &&
    (incoming.assistantText.length >= existing.assistantText.length || existingAssistantIsPlaceholder);
  const userChanged = incoming.userText.length > existing.userText.length;
  if (!sameChatGptTurn) return existing;
  const identityChanged =
    incoming.navigation?.navigationId !== existing.navigation?.navigationId ||
    incoming.sourceAnchor.userMessageId !== existing.sourceAnchor.userMessageId ||
    incoming.sourceAnchor.assistantMessageId !== existing.sourceAnchor.assistantMessageId;
  if (!assistantChanged && !userChanged && !identityChanged) return existing;

  return {
    ...incoming,
    id: existing.id,
    userText: userChanged ? incoming.userText : existing.userText,
    assistantText: assistantChanged ? incoming.assistantText : existing.assistantText,
    sourceAnchor: {
      ...incoming.sourceAnchor,
      userHash: userChanged ? incoming.sourceAnchor.userHash : existing.sourceAnchor.userHash,
      userPreview: userChanged ? incoming.sourceAnchor.userPreview : existing.sourceAnchor.userPreview,
      assistantHash: assistantChanged ? incoming.sourceAnchor.assistantHash : existing.sourceAnchor.assistantHash,
      assistantPreview: assistantChanged ? incoming.sourceAnchor.assistantPreview : existing.sourceAnchor.assistantPreview,
      userMessageId: incoming.sourceAnchor.userMessageId ?? existing.sourceAnchor.userMessageId,
      assistantMessageId: assistantChanged
        ? incoming.sourceAnchor.assistantMessageId ?? existing.sourceAnchor.assistantMessageId
        : existing.sourceAnchor.assistantMessageId ?? incoming.sourceAnchor.assistantMessageId
    },
    navigation: incoming.navigation ?? existing.navigation
  };
}

type TurnCandidate = {
  index: number;
  user: MessageBlock;
  assistant: MessageBlock;
  userHash: string;
  assistantHash: string;
};

type UserTurnMarker = {
  index: number;
  user: MessageBlock;
  userHash: string;
};

function getTurnCandidates(): TurnCandidate[] {
  const blocks = getMessageBlocks();
  const turnCandidates: TurnCandidate[] = [];
  let currentTurn = -1;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.role !== "user") continue;

    const next = blocks[index + 1];
    if (!next || next.role !== "assistant") continue;

    currentTurn += 1;
    const userHash = hashText(block.text);
    const assistantHash = hashText(next.text);
    turnCandidates.push({
      index: currentTurn,
      user: block,
      assistant: next,
      userHash,
      assistantHash
    });
  }

  return turnCandidates;
}

function getUserTurnMarkers(): UserTurnMarker[] {
  const blocks = getMessageBlocks();
  const markers: UserTurnMarker[] = [];
  let currentTurn = -1;

  for (const block of blocks) {
    if (block.role !== "user") continue;
    currentTurn += 1;
    markers.push({
      index: currentTurn,
      user: block,
      userHash: hashText(block.text)
    });
  }

  return markers;
}

function attachmentNamesMatch(candidateNames: string[] | undefined, anchor: SourceAnchor): boolean {
  const anchorNames = anchor.userAttachmentNames ?? [];
  if (anchorNames.length === 0) return true;
  const candidateNameSet = new Set((candidateNames ?? []).map((name) => name.toLowerCase()));
  return anchorNames.every((name) => candidateNameSet.has(name.toLowerCase()));
}

function hasSameMessageIds(candidate: TurnCandidate, anchor: SourceAnchor): boolean {
  return (
    Boolean(anchor.userMessageId || anchor.assistantMessageId) &&
    (!anchor.userMessageId || candidate.user.messageId === anchor.userMessageId) &&
    (!anchor.assistantMessageId || candidate.assistant.messageId === anchor.assistantMessageId)
  );
}

function hasSameHashes(candidate: TurnCandidate, anchor: SourceAnchor): boolean {
  return candidate.userHash === anchor.userHash && candidate.assistantHash === anchor.assistantHash;
}

function hasSamePreviews(candidate: TurnCandidate, anchor: SourceAnchor): boolean {
  return (
    candidate.user.text.includes(anchor.userPreview) &&
    candidate.assistant.text.includes(anchor.assistantPreview)
  );
}

function hasSameUserPreview(candidate: TurnCandidate, anchor: SourceAnchor): boolean {
  return candidate.user.text.includes(anchor.userPreview);
}

function hasSameAttachments(candidate: TurnCandidate, anchor: SourceAnchor): boolean {
  return attachmentNamesMatch(candidate.user.attachmentNames, anchor);
}

function candidateMatchesTurn(candidate: TurnCandidate, turn: Turn): boolean {
  const anchor = turn.sourceAnchor;
  if (hasSameMessageIds(candidate, anchor)) return true;
  if (hasSameHashes(candidate, anchor) && hasSameAttachments(candidate, anchor)) return true;
  return hasSamePreviews(candidate, anchor) && hasSameAttachments(candidate, anchor);
}

function getCandidateGlobalIndex(candidate: TurnCandidate, knownTurns: Turn[]): number | null {
  if (knownTurns.length === 0) return null;

  const match = knownTurns.find((turn) => candidateMatchesTurn(candidate, turn));
  return match?.turnIndex ?? null;
}

function markerMatchesTurn(marker: UserTurnMarker, turn: Turn): boolean {
  const anchor = turn.sourceAnchor;
  if (anchor.userMessageId && marker.user.messageId === anchor.userMessageId) return true;
  if (marker.userHash === anchor.userHash && attachmentNamesMatch(marker.user.attachmentNames, anchor)) return true;
  return Boolean(
    anchor.userPreview &&
      marker.user.text.includes(anchor.userPreview) &&
      attachmentNamesMatch(marker.user.attachmentNames, anchor)
  );
}

function markerMatchesAnchor(marker: UserTurnMarker, anchor: SourceAnchor): boolean {
  if (anchor.userMessageId && marker.user.messageId === anchor.userMessageId) return true;
  if (marker.userHash === anchor.userHash && attachmentNamesMatch(marker.user.attachmentNames, anchor)) return true;
  return Boolean(
    anchor.userPreview &&
      marker.user.text.includes(anchor.userPreview) &&
      attachmentNamesMatch(marker.user.attachmentNames, anchor)
  );
}

function getMarkerGlobalIndex(marker: UserTurnMarker, knownTurns: Turn[]): number | null {
  if (knownTurns.length === 0) return null;

  const match = knownTurns.find((turn) => markerMatchesTurn(marker, turn));
  return match?.turnIndex ?? null;
}

function pickBestUserMarker(
  markers: UserTurnMarker[],
  anchor: SourceAnchor,
  knownTurns: Turn[]
): UserTurnMarker | null {
  if (markers.length === 0) return null;

  const indexed = markers
    .map((marker) => ({
      marker,
      globalIndex: getMarkerGlobalIndex(marker, knownTurns)
    }))
    .filter((entry) => entry.globalIndex !== null);

  const exactIndex = indexed.find((entry) => entry.globalIndex === anchor.turnIndex);
  if (exactIndex) return exactIndex.marker;
  if (knownTurns.length > 0) return null;
  return markers.length === 1 ? markers[0] : null;
}

function pickBestCandidate(
  candidates: TurnCandidate[],
  anchor: SourceAnchor,
  knownTurns: Turn[]
): TurnCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const indexed = candidates
    .map((candidate) => ({
      candidate,
      globalIndex: getCandidateGlobalIndex(candidate, knownTurns)
    }))
    .filter((entry) => entry.globalIndex !== null);

  const exactIndex = indexed.find((entry) => entry.globalIndex === anchor.turnIndex);
  if (exactIndex) return exactIndex.candidate;

  if (knownTurns.length > 0) return null;
  return null;
}

export function findTurnElement(anchor: SourceAnchor, knownTurns: Turn[] = []): HTMLElement | null {
  const turnCandidates = getTurnCandidates();
  const userMarkers = getUserTurnMarkers();

  const idMatch = pickBestCandidate(turnCandidates.filter((candidate) => hasSameMessageIds(candidate, anchor)), anchor, knownTurns);
  if (idMatch) return idMatch.user.element;

  const exactMatch = pickBestCandidate(
    turnCandidates.filter((candidate) => hasSameHashes(candidate, anchor) && hasSameAttachments(candidate, anchor)),
    anchor,
    knownTurns
  );
  if (exactMatch) return exactMatch.user.element;

  const previewMatch = pickBestCandidate(
    turnCandidates.filter((candidate) => hasSamePreviews(candidate, anchor) && hasSameAttachments(candidate, anchor)),
    anchor,
    knownTurns
  );
  if (previewMatch) return previewMatch.user.element;

  const userPreviewMatch = pickBestCandidate(
    turnCandidates.filter((candidate) => hasSameUserPreview(candidate, anchor) && hasSameAttachments(candidate, anchor)),
    anchor,
    knownTurns
  );
  if (userPreviewMatch) return userPreviewMatch.user.element;

  const userMarkerMatch = pickBestUserMarker(
    userMarkers.filter((marker) => markerMatchesAnchor(marker, anchor)),
    anchor,
    knownTurns
  );
  if (userMarkerMatch) return userMarkerMatch.user.element;

  return null;
}

export function getVisibleTurnIndexRange(knownTurns: Turn[] = []): { first: number; last: number; count: number } | null {
  const candidates = getTurnCandidates();
  const userMarkers = getUserTurnMarkers();
  if (candidates.length === 0 && userMarkers.length === 0) return null;

  if (knownTurns.length > 0) {
    const completeIndexes = candidates
      .map((candidate) => getCandidateGlobalIndex(candidate, knownTurns))
      .filter((index): index is number => index !== null)
      .sort((left, right) => left - right);
    const markerIndexes = userMarkers
      .map((marker) => getMarkerGlobalIndex(marker, knownTurns))
      .filter((index): index is number => index !== null)
      .sort((left, right) => left - right);
    const indexes = [...new Set([...completeIndexes, ...markerIndexes])].sort((left, right) => left - right);

    if (indexes.length > 0) {
      return {
        first: indexes[0],
        last: indexes[indexes.length - 1],
        count: indexes.length
      };
    }

    if (candidates.length === knownTurns.length) {
      return {
        first: 0,
        last: knownTurns.length - 1,
        count: candidates.length
      };
    }

    return null;
  }

  if (candidates.length === 0) {
    return {
      first: userMarkers[0].index,
      last: userMarkers[userMarkers.length - 1].index,
      count: userMarkers.length
    };
  }

  return {
    first: candidates[0].index,
    last: candidates[candidates.length - 1].index,
    count: candidates.length
  };
}
