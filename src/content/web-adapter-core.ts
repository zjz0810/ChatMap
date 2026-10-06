import type { ConversationSite } from "./adapter-registry";
import type { SourceAnchor, Turn } from "../shared/types";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";

export type ConversationBlock = {
  role: "user" | "assistant";
  text: string;
  elementId?: string;
  element?: HTMLElement;
};

export type RoleTextCandidate = {
  role: ConversationBlock["role"];
  text: string;
  top: number;
  elementId?: string;
  element?: HTMLElement;
  excluded?: boolean;
};

export type RoleExtractionOptions = {
  excludeAncestorSelectors?: string[];
  actionTextPatterns?: RegExp[];
  sameRoleStrategy?: "merge" | "first" | "last";
  skipAssistantEchoText?: boolean;
};

export type RoleMessageSelector = {
  role: ConversationBlock["role"];
  selector: string;
  rootSelector?: string;
  contentSelectors?: string[];
};

export type RoleMessageRootSelector = {
  selector: string;
  userMarkerSelectors?: string[];
  assistantMarkerSelectors?: string[];
  userContentSelectors?: string[];
  assistantContentSelectors?: string[];
  rolePriority?: ConversationBlock["role"][];
};

export type TurnPairRootSelector = {
  selector: string;
  userContentSelectors: string[];
  assistantContentSelectors: string[];
};

export type WebExtractionDiagnostics = {
  selectorBlocks: number;
  selectorTurns: number;
  fallbackSelectorCandidates: number;
  fallbackTextCandidates: number;
  fallbackBlocks: number;
  fallbackTurns: number;
};

export type WebConversationProfile = {
  site: ConversationSite;
  conversationRootSelector?: string;
  messageIdAttributes?: string[];
  messageIdAncestorSelector?: string;
  titleSuffixPattern?: RegExp;
  userSelectors: string[];
  assistantSelectors: string[];
  messageRootSelector?: string;
  textSelectors?: string[];
  excludeSelectors?: string[];
  roleMessageSelectors?: RoleMessageSelector[];
  roleMessageRootSelectors?: RoleMessageRootSelector[];
  turnPairRootSelectors?: TurnPairRootSelector[];
  scrollContainerSelectors?: string[];
  titleSelectors?: string[];
  titleBlocklistPatterns?: RegExp[];
  titleFromFirstUserMessage?: boolean;
  suppressEmptyObserverRefresh?: boolean;
  roleExtraction?: RoleExtractionOptions;
  cleanText?: (text: string, role: ConversationBlock["role"]) => string;
};

const EMPTY_ASSISTANT_REPLY = "No text response";

const DEFAULT_EXCLUDE_SELECTORS = [
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
  "[role='button']"
];

const DEFAULT_FALLBACK_ACTION_TEXT_PATTERNS = [
  /^\u5df2\u601d\u8003/,
  /^\u601d\u8003/,
  /^Thinking/i,
  /^\u590d\u5236$/,
  /^\u70b9\u8d5e$/,
  /^\u70b9\u8e29$/,
  /^\u5206\u4eab$/,
  /^Copy$/i,
  /^Like$/i,
  /^Dislike$/i,
  /^Share$/i,
  /\u590d\u5236|\u70b9\u8d5e|\u70b9\u8e29|\u5206\u4eab/
];

const DEFAULT_FALLBACK_EXCLUDE_ANCESTOR_SELECTORS = [
  ...DEFAULT_EXCLUDE_SELECTORS,
  "aside",
  "nav",
  "header",
  "footer",
  "[role='navigation']",
  "[contenteditable='true']",
  "[class*='sidebar' i]",
  "[class*='history' i]",
  "[class*='composer' i]",
  "[class*='input' i]",
  "[class*='toolbar' i]",
  "[class*='actions' i]"
];

const TITLE_CHROME_TEXT_PATTERNS = [
  /\bNew Chat\b/i,
  /\bAgents\b/i,
  /\bIntelligence\b/i,
  /\bProjects\b/i,
  /\bChats\b/i,
  /\bUpgrade\b/i,
  /\bLogin\b/i,
  /\bLeaderboard\b/i,
  /\bSearch\b/i,
  /\bSettings\b/i,
  /\bSources\b/i,
  /新对话/,
  /最近对话/,
  /学习搭子/,
  /AI画图/,
  /AI阅读/,
  /AI生视频/,
  /云知识库/,
  /智能体/,
  /升级/,
  /登录/
];

const TITLE_CHROME_LABEL_PATTERNS = [
  /^New Chat$/i,
  /^Agents$/i,
  /^Intelligence$/i,
  /^Projects$/i,
  /^Chats$/i,
  /^Upgrade(?: to Pro)?$/i,
  /^Login$/i,
  /^Leaderboard$/i,
  /^Search$/i,
  /^Settings$/i,
  /^Sources$/i,
  /^新对话/,
  /^最近对话/,
  /^批量操作$/,
  /^重命名/,
  /^删除对话$/
];

const TITLE_ACTION_TEXT_PATTERN =
  /\s+(?:批量操作|重命名|删除对话|删除|置顶|取消置顶|Rename|Delete conversation|Delete|Pin|Unpin)(?:\s+.*)?$/i;

const lastDiagnostics = new Map<string, WebExtractionDiagnostics>();
const WEB_HIGHLIGHT_CLASS = "turnmap-source-highlight";

function ensureWebHighlightStyle(): void {
  if (document.getElementById("turnmap-highlight-style")) return;

  const style = document.createElement("style");
  style.id = "turnmap-highlight-style";
  style.textContent = `
    .${WEB_HIGHLIGHT_CLASS} {
      outline: 3px solid #10a37f !important;
      outline-offset: 6px !important;
      border-radius: 8px !important;
      transition: outline-color 200ms ease;
    }
  `;
  document.documentElement.append(style);
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

export function normalizeWebText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function joinUniqueWebTextParts(parts: string[]): string {
  const normalizedParts = parts.map(normalizeWebText).filter(Boolean);
  const selected: string[] = [];

  for (const part of normalizedParts.sort((left, right) => right.length - left.length)) {
    if (selected.some((existing) => existing === part || existing.includes(part))) continue;
    selected.push(part);
  }

  return normalizeWebText(selected.join("\n"));
}

function preview(text: string): string {
  return normalizeWebText(text).slice(0, 120);
}

function textIsAction(text: string, patterns: RegExp[]): boolean {
  const normalized = normalizeWebText(text);
  return patterns.some((pattern) => pattern.test(normalized));
}

function blockId(block: ConversationBlock, fallback: string): string {
  return block.elementId || fallback;
}

export function blocksToTurns(blocks: ConversationBlock[]): Turn[] {
  const turns: Turn[] = [];
  let pendingUser: ConversationBlock | null = null;
  const assignTurnId = stableTurnIdAssigner();

  const pushTurn = (user: ConversationBlock, assistant?: ConversationBlock) => {
    const userText = normalizeWebText(user.text);
    const assistantText = assistant?.text || EMPTY_ASSISTANT_REPLY;
    const turnIndex = turns.length;
    const userId = blockId(user, `user-${turnIndex}-${hashText(userText)}`);
    const assistantId = assistant ? blockId(assistant, `assistant-${turnIndex}-${hashText(assistantText)}`) : undefined;
    const sourceAnchor: SourceAnchor = {
      turnIndex,
      userMessageId: userId,
      assistantMessageId: assistantId,
      userHash: hashText(userText),
      assistantHash: hashText(assistantText),
      userPreview: preview(userText),
      assistantPreview: preview(assistantText)
    };

    turns.push({
      id: assignTurnId(sourceAnchor),
      turnIndex,
      userText,
      assistantText,
      sourceAnchor,
      extractedAt: Date.now()
    });
  };

  for (const block of blocks) {
    const text = normalizeWebText(block.text);
    if (!text) continue;
    const normalizedBlock = { ...block, text };

    if (normalizedBlock.role === "user") {
      if (pendingUser) pushTurn(pendingUser);
      pendingUser = normalizedBlock;
      continue;
    }

    if (pendingUser) {
      pushTurn(pendingUser, normalizedBlock);
      pendingUser = null;
    }
  }

  if (pendingUser) pushTurn(pendingUser);
  return turns;
}

export function normalizeWebTurnIndexes(turns: Turn[]): Turn[] {
  const assignTurnId = stableTurnIdAssigner();
  return turns.map((turn, turnIndex) => {
    const sourceAnchor: SourceAnchor = {
      ...turn.sourceAnchor,
      turnIndex
    };

    return {
      ...turn,
      id: assignTurnId(sourceAnchor),
      turnIndex,
      sourceAnchor
    };
  });
}

function isFallbackAssistantText(text: string): boolean {
  return text.trim() === EMPTY_ASSISTANT_REPLY;
}

function mergeUserKey(turn: Turn): string {
  return `hash:${turn.sourceAnchor.userHash}:${(turn.sourceAnchor.userAttachmentNames ?? []).join("|")}`;
}

function shouldReplaceMergedTurn(existing: Turn, next: Turn): boolean {
  if (isFallbackAssistantText(existing.assistantText) && !isFallbackAssistantText(next.assistantText)) return true;
  if (!existing.sourceAnchor.assistantMessageId && next.sourceAnchor.assistantMessageId) return true;
  if (next.assistantText.length > existing.assistantText.length + 16) return true;
  return false;
}

export function mergeWebTurns(existingTurns: Turn[], newTurns: Turn[]): Turn[] {
  const merged = new Map<string, Turn>();
  const byUser = new Map<string, string>();

  for (const turn of [...existingTurns, ...newTurns]) {
    const key =
      turn.sourceAnchor.userMessageId || turn.sourceAnchor.assistantMessageId
        ? `${turn.sourceAnchor.userMessageId ?? ""}:${turn.sourceAnchor.assistantMessageId ?? ""}`
        : `${turn.sourceAnchor.userHash}:${turn.sourceAnchor.assistantHash}`;
    const userKey = mergeUserKey(turn);
    const existingKey = byUser.get(userKey);
    const existing = existingKey ? merged.get(existingKey) : undefined;

    if (existingKey && existing) {
      if (shouldReplaceMergedTurn(existing, turn)) {
        merged.delete(existingKey);
        merged.set(key, turn);
        byUser.set(userKey, key);
      }
      continue;
    }

    if (!merged.has(key)) {
      merged.set(key, turn);
      byUser.set(userKey, key);
    }
  }

  return normalizeWebTurnIndexes([...merged.values()]);
}

export function roleCandidatesToBlocks(
  candidates: RoleTextCandidate[],
  options: RoleExtractionOptions = {}
): ConversationBlock[] {
  const actionTextPatterns = options.actionTextPatterns ?? DEFAULT_FALLBACK_ACTION_TEXT_PATTERNS;
  const sameRoleStrategy = options.sameRoleStrategy ?? "merge";
  const blocks: ConversationBlock[] = [];

  for (const candidate of [...candidates].sort((left, right) => left.top - right.top)) {
    const text = normalizeWebText(candidate.text);
    if (!text || candidate.excluded || textIsAction(text, actionTextPatterns)) continue;

    const previous = blocks.at(-1);
    if (options.skipAssistantEchoText && candidate.role === "assistant" && previous?.role === "user") {
      if (normalizeWebText(previous.text) === text) continue;
    }

    if (previous?.role === candidate.role) {
      if (sameRoleStrategy === "first") continue;
      if (sameRoleStrategy === "last") {
        previous.text = text;
        previous.element = candidate.element;
        previous.elementId = candidate.elementId;
        continue;
      }
      previous.text = `${previous.text}\n${text}`;
      continue;
    }

    blocks.push({
      role: candidate.role,
      text,
      element: candidate.element,
      elementId: candidate.elementId
    });
  }

  return blocks;
}

export function dropAssistantEchoBlocks(blocks: ConversationBlock[]): ConversationBlock[] {
  const filtered: ConversationBlock[] = [];
  let previousUserText = "";

  for (const block of blocks) {
    const text = normalizeWebText(block.text);

    if (block.role === "user") {
      previousUserText = text;
      filtered.push(block);
      continue;
    }

    if (previousUserText && text === previousUserText) continue;

    filtered.push(block);
  }

  return filtered;
}

function uniqueElements(selectors: string[], root: ParentNode = document): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const elements: HTMLElement[] = [];

  for (const selector of selectors) {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (!seen.has(element)) {
        seen.add(element);
        elements.push(element);
      }
    });
  }

  return elements;
}

function countVisibleTextNodes(
  profile: WebConversationProfile,
  options: RoleExtractionOptions,
  root: ParentNode = document
): number {
  const excludeSelectors = [
    ...DEFAULT_FALLBACK_EXCLUDE_ANCESTOR_SELECTORS,
    ...(profile.excludeSelectors ?? []),
    ...(options.excludeAncestorSelectors ?? [])
  ].join(",");
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = normalizeWebText(node.nodeValue ?? "");
    if (text.length < 2) continue;

    const element = node.parentElement;
    if (!element || element.closest(excludeSelectors) || !elementIsVisible(element)) continue;

    count += 1;
  }

  return count;
}

function closestMessageRoot(element: HTMLElement, profile: WebConversationProfile): HTMLElement {
  return profile.messageRootSelector ? element.closest<HTMLElement>(profile.messageRootSelector) ?? element : element;
}

function readElementText(element: HTMLElement, profile: WebConversationProfile): string {
  const root = element.cloneNode(true) as HTMLElement;
  const excludeSelectors = [...DEFAULT_EXCLUDE_SELECTORS, ...(profile.excludeSelectors ?? [])].join(",");
  root.querySelectorAll(excludeSelectors).forEach((child) => child.remove());

  if (profile.textSelectors?.length) {
    const parts = profile.textSelectors
      .flatMap((selector) => [...root.querySelectorAll<HTMLElement>(selector)])
      .map((candidate) => normalizeWebText(candidate.textContent ?? ""))
      .filter(Boolean);
    if (parts.length > 0) return joinUniqueWebTextParts(parts);
  }

  return normalizeWebText(root.textContent ?? "");
}

function cleanProfileText(
  profile: WebConversationProfile,
  text: string,
  role: ConversationBlock["role"]
): string {
  return profile.cleanText ? normalizeWebText(profile.cleanText(text, role)) : text;
}

function firstMatchingElement(root: HTMLElement, selectors: string[] = []): HTMLElement | null {
  for (const selector of selectors) {
    if (root.matches(selector)) return root;
    const element = root.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

function hasSelector(root: HTMLElement, selectors: string[] = []): boolean {
  return selectors.some((selector) => root.matches(selector) || Boolean(root.querySelector(selector)));
}

function textIsBlockedTitle(profile: WebConversationProfile, text: string): boolean {
  const normalized = normalizeWebText(text);
  if (!normalized) return true;
  if (TITLE_CHROME_LABEL_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (normalized.length > 160) return true;
  const chromeHits = TITLE_CHROME_TEXT_PATTERNS.filter((pattern) => pattern.test(normalized)).length;
  if (chromeHits >= 2 || (chromeHits >= 1 && normalized.length > 80)) return true;
  return (profile.titleBlocklistPatterns ?? []).some((pattern) => pattern.test(normalized));
}

function cleanTitleCandidate(text: string): string {
  return normalizeWebText(text).replace(TITLE_ACTION_TEXT_PATTERN, "").trim();
}

function textTokensForTitle(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []) {
    tokens.add(word);
  }
  for (const segment of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (segment.length === 1) {
      tokens.add(segment);
      continue;
    }
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.add(segment.slice(index, index + 2));
    }
  }
  return tokens;
}

function titleRelatesToFirstUser(candidate: string, blocks: ConversationBlock[]): boolean {
  const firstUser = normalizeWebText(blocks.find((block) => block.role === "user")?.text ?? "");
  if (!firstUser) return false;
  const candidateTokens = textTokensForTitle(candidate);
  const userTokens = textTokensForTitle(firstUser);
  if (candidateTokens.size === 0 || userTokens.size === 0) return false;

  let overlap = 0;
  candidateTokens.forEach((token) => {
    if (userTokens.has(token)) overlap += 1;
  });

  return overlap >= 2 || (overlap >= 1 && candidate.length <= 24);
}

function extractTitleCandidates(profile: WebConversationProfile): string[] {
  const candidates: string[] = [];

  for (const selector of profile.titleSelectors ?? []) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (!elementIsVisible(element)) return;
      candidates.push(
        element.getAttribute("title") ??
          element.getAttribute("aria-label") ??
          element.textContent ??
          ""
      );
    });
  }

  return candidates;
}

function roleForRoot(root: HTMLElement, rule: RoleMessageRootSelector): ConversationBlock["role"] | null {
  const priority = rule.rolePriority ?? ["user", "assistant"];

  for (const role of priority) {
    const selectors = role === "user" ? rule.userMarkerSelectors : rule.assistantMarkerSelectors;
    if (hasSelector(root, selectors)) return role;
  }

  return null;
}

function contentSelectorsForRole(
  role: ConversationBlock["role"],
  rule: RoleMessageRootSelector
): string[] {
  if (role === "user") return rule.userContentSelectors ?? rule.userMarkerSelectors ?? [];
  return rule.assistantContentSelectors ?? rule.assistantMarkerSelectors ?? [];
}

function candidateFromElement(
  role: ConversationBlock["role"],
  element: HTMLElement,
  profile: WebConversationProfile,
  index: number,
  contentSelectors: string[] = []
): RoleTextCandidate | null {
  if (!elementIsVisible(element)) return null;
  const contentElement = firstMatchingElement(element, contentSelectors) ?? element;
  const rawText = readElementText(contentElement, profile);
  const text = cleanProfileText(profile, rawText, role);
  if (!text) return null;
  const rect = element.getBoundingClientRect();
  return {
    role,
    text,
    top: rect.top + window.scrollY,
    element,
    elementId: elementId(element, role, index, profile),
    excluded: false
  };
}

function elementId(element: HTMLElement, role: ConversationBlock["role"], index: number, profile: WebConversationProfile): string {
  const attributes = profile.messageIdAttributes ?? ["data-message-id", "data-turn-id", "data-id", "id"];
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    if (value) return value;
  }
  if (profile.messageIdAncestorSelector) {
    const ancestor = element.closest(profile.messageIdAncestorSelector);
    for (const attribute of attributes) {
      const value = ancestor?.getAttribute(attribute);
      if (value) return value;
    }
  }
  return `${role}-${index}-${hashText(normalizeWebText(element.textContent ?? ""))}`;
}

function elementIsVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") !== 0;
}

function extractRoleBlocksFromDocument(
  profile: WebConversationProfile,
  root: ParentNode = document,
  diagnostics?: WebExtractionDiagnostics
): ConversationBlock[] {
  const options = profile.roleExtraction ?? {};
  const candidates: RoleTextCandidate[] = [];
  const seen = new Set<HTMLElement>();
  const excludeSelectors = [
    ...DEFAULT_FALLBACK_EXCLUDE_ANCESTOR_SELECTORS,
    ...(profile.excludeSelectors ?? []),
    ...(options.excludeAncestorSelectors ?? [])
  ].join(",");

  for (const rule of profile.turnPairRootSelectors ?? []) {
    root.querySelectorAll<HTMLElement>(rule.selector).forEach((element) => {
      if (element.closest(excludeSelectors)) return;
      const userCandidate = candidateFromElement("user", element, profile, candidates.length, rule.userContentSelectors);
      if (userCandidate) candidates.push(userCandidate);
      const assistantCandidate = candidateFromElement(
        "assistant",
        element,
        profile,
        candidates.length,
        rule.assistantContentSelectors
      );
      if (assistantCandidate) candidates.push(assistantCandidate);
    });
  }

  if (candidates.length > 0) {
    const blocks = roleCandidatesToBlocks(candidates, options);
    if (diagnostics) {
      diagnostics.fallbackSelectorCandidates = candidates.length;
      diagnostics.fallbackTextCandidates = countVisibleTextNodes(profile, options, root);
      diagnostics.fallbackBlocks = blocks.length;
      diagnostics.fallbackTurns = blocksToTurns(blocks).length;
    }
    return blocks;
  }

  for (const rule of profile.roleMessageRootSelectors ?? []) {
    root.querySelectorAll<HTMLElement>(rule.selector).forEach((element) => {
      if (seen.has(element) || [...seen].some((existing) => existing.contains(element)) || element.closest(excludeSelectors)) return;

      const role = roleForRoot(element, rule);
      if (!role) return;

      const contentSelectors = contentSelectorsForRole(role, rule);
      const candidate = candidateFromElement(role, element, profile, candidates.length, contentSelectors);
      if (!candidate) return;
      candidates.push(candidate);
      seen.add(element);
    });
  }

  for (const rule of profile.roleMessageSelectors ?? []) {
    root.querySelectorAll<HTMLElement>(rule.selector).forEach((element) => {
      const messageRoot = rule.rootSelector ? element.closest<HTMLElement>(rule.rootSelector) ?? element : element;
      if (
        seen.has(messageRoot) ||
        [...seen].some((existing) => existing.contains(messageRoot)) ||
        messageRoot.closest(excludeSelectors)
      ) {
        return;
      }
      const candidate = candidateFromElement(rule.role, messageRoot, profile, candidates.length, rule.contentSelectors ?? [rule.selector]);
      if (!candidate) return;
      candidates.push(candidate);
      seen.add(messageRoot);
    });
  }

  const blocks = roleCandidatesToBlocks(candidates, options);
  if (diagnostics) {
    diagnostics.fallbackSelectorCandidates = candidates.length;
    diagnostics.fallbackTextCandidates = countVisibleTextNodes(profile, options, root);
    diagnostics.fallbackBlocks = blocks.length;
    diagnostics.fallbackTurns = blocksToTurns(blocks).length;
  }
  return blocks;
}

export function extractBlocksFromDocument(profile: WebConversationProfile, root: ParentNode = document): ConversationBlock[] {
  const extractionRoot =
    root === document && profile.conversationRootSelector
      ? document.querySelector(profile.conversationRootSelector) ?? document
      : root;
  const roleBlocks = extractRoleBlocksFromDocument(profile, extractionRoot);
  if (blocksToTurns(roleBlocks).length > 0) return roleBlocks;

  const blocks: ConversationBlock[] = [];

  for (const role of ["user", "assistant"] as const) {
    const selectors = role === "user" ? profile.userSelectors : profile.assistantSelectors;
    uniqueElements(selectors, extractionRoot).forEach((element) => {
      const messageRoot = closestMessageRoot(element, profile);
      const rawText = readElementText(messageRoot, profile);
      const text = cleanProfileText(profile, rawText, role);
      if (!text) return;
      if (blocks.some((block) => block.element === messageRoot)) return;
      blocks.push({
        role,
        text,
        element: messageRoot,
        elementId: elementId(messageRoot, role, blocks.length, profile)
      });
    });
  }

  const selectorBlocks = blocks.sort((left, right) => {
    if (!left.element || !right.element) return 0;
    const position = left.element.compareDocumentPosition(right.element);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  return profile.site.id === "grok" && profile.roleExtraction?.skipAssistantEchoText
    ? dropAssistantEchoBlocks(selectorBlocks)
    : selectorBlocks;
}

export function extractTurnsFromDocument(profile: WebConversationProfile, root: ParentNode = document): Turn[] {
  const selectorBlocks = extractBlocksFromDocument(profile, root);
  const turns = blocksToTurns(selectorBlocks);
  const diagnostics: WebExtractionDiagnostics = {
    selectorBlocks: selectorBlocks.length,
    selectorTurns: turns.length,
    fallbackSelectorCandidates: 0,
    fallbackTextCandidates: 0,
    fallbackBlocks: 0,
    fallbackTurns: 0
  };
  if (turns.length > 0) {
    lastDiagnostics.set(profile.site.id, diagnostics);
    return turns;
  }
  const fallbackTurns = blocksToTurns(extractRoleBlocksFromDocument(profile, root, diagnostics));
  lastDiagnostics.set(profile.site.id, diagnostics);
  return fallbackTurns;
}

function isScrollable(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  return (
    (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
    element.scrollHeight > element.clientHeight + 120 &&
    elementIsVisible(element)
  );
}

function getWebChatScrollCandidates(profile: WebConversationProfile): HTMLElement[] {
  const fallback = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  const explicit = profile.scrollContainerSelectors?.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector))
  ) ?? [];
  const candidates = [...explicit, fallback, ...Array.from(document.querySelectorAll<HTMLElement>("body *"))]
    .filter(isScrollable)
    .map((element) => ({
      element,
      blocks: extractBlocksFromDocument(profile, element),
      scrollableHeight: element.scrollHeight - element.clientHeight
    }))
    .map((candidate) => ({
      element: candidate.element,
      turnCount: blocksToTurns(candidate.blocks).length,
      blockCount: candidate.blocks.length,
      scrollableHeight: candidate.scrollableHeight
    }))
    .sort((left, right) => {
      const turnDelta = right.turnCount - left.turnCount;
      if (turnDelta !== 0) return turnDelta;
      const blockDelta = right.blockCount - left.blockCount;
      if (blockDelta !== 0) return blockDelta;
      return right.scrollableHeight - left.scrollableHeight;
    });

  const elements = candidates.map((candidate) => candidate.element);
  return elements.includes(fallback) ? elements : [...elements, fallback];
}

export function getWebChatScrollElement(profile: WebConversationProfile): HTMLElement {
  return getWebChatScrollCandidates(profile)[0] ?? ((document.scrollingElement ?? document.documentElement) as HTMLElement);
}

export function extractBlocksWithFallback(profile: WebConversationProfile, root: ParentNode = document): ConversationBlock[] {
  const selectorBlocks = extractBlocksFromDocument(profile, root);
  if (blocksToTurns(selectorBlocks).length > 0) return selectorBlocks;
  return extractRoleBlocksFromDocument(profile, root);
}

export function getLastWebExtractionDiagnostics(profile: WebConversationProfile): WebExtractionDiagnostics | undefined {
  return lastDiagnostics.get(profile.site.id);
}

export function conversationTitleFromBlocks(
  profile: WebConversationProfile,
  blocks: ConversationBlock[],
  documentTitle: string
): string {
  if (profile.titleFromFirstUserMessage) {
    const userTitle = normalizeWebText(blocks.find((block) => block.role === "user")?.text ?? "");
    if (userTitle) return preview(userTitle);
  }

  const title = documentTitle.replace(profile.titleSuffixPattern ?? /\s*[-|]\s*.*$/i, "").trim();
  return title || `${profile.site.displayName} conversation`;
}

export function conversationTitleFromCandidates(
  profile: WebConversationProfile,
  candidates: string[],
  documentTitle: string,
  blocks: ConversationBlock[] = []
): string {
  const titleCandidates = candidates.map(cleanTitleCandidate).filter((candidate) => !textIsBlockedTitle(profile, candidate));
  const relatedTitle = profile.titleFromFirstUserMessage
    ? titleCandidates.find((candidate) => titleRelatesToFirstUser(candidate, blocks))
    : undefined;
  if (relatedTitle) return preview(relatedTitle);

  const title = titleCandidates[0];
  if (title) return preview(title);

  return conversationTitleFromBlocks(profile, blocks, documentTitle);
}

export function getWebConversationTitle(profile: WebConversationProfile): string {
  return conversationTitleFromCandidates(profile, extractTitleCandidates(profile), document.title, extractBlocksWithFallback(profile));
}

export function getWebConversationId(profile: WebConversationProfile): string {
  return `${profile.site.id}:${window.location.pathname || window.location.href}`;
}

function getNearestScrollableAncestor(element: HTMLElement): HTMLElement | null {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (isScrollable(current)) return current;
  }
  return null;
}

function scrollElementToCenter(element: HTMLElement, scrollElement: HTMLElement): void {
  const elementRect = element.getBoundingClientRect();
  const containerRect = scrollElement.getBoundingClientRect();
  const containerTop =
    scrollElement === document.documentElement || scrollElement === document.body ? 0 : containerRect.top;
  const targetTop =
    scrollElement.scrollTop + elementRect.top - containerTop - scrollElement.clientHeight * 0.35;

  scrollElement.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "instant"
  });
}

function resolveRevealScrollElement(element: HTMLElement, scrollElement?: HTMLElement): HTMLElement {
  const fallback = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  if (scrollElement?.contains(element)) return scrollElement;
  return getNearestScrollableAncestor(element) ?? fallback;
}

export function revealWebTurnElement(element: HTMLElement, scrollElement?: HTMLElement): void {
  ensureWebHighlightStyle();
  scrollElementToCenter(element, resolveRevealScrollElement(element, scrollElement));
  element.classList.add(WEB_HIGHLIGHT_CLASS);
  window.setTimeout(() => {
    element.classList.remove(WEB_HIGHLIGHT_CLASS);
  }, 2200);
}
