import { hashText } from "../shared/hash.ts";
import { stableTurnIdAssigner } from "../shared/turn-id.ts";
import type { SourceAnchor, Turn, TurnNavigation } from "../shared/types";
import { getChatGptScrollElement, getChatScrollRange } from "./scroll-container.ts";

const EMPTY_ASSISTANT_REPLY = "No assistant text captured";
const HIDDEN_PROMPT_LABEL = /^Prompt\s+(\d+)$/i;
const NATIVE_NAVIGATION_PREFIX = "chatgpt-native-user-query";
const USER_MESSAGE_SELECTOR =
  '[data-message-author-role="user"], [class~="group/user-message"], [data-user-message-bubble], [data-conversation-role="user"]';

type OphelNavigationSeed = {
  index: number;
  text: string;
  messageId?: string;
  turnId?: string;
};

type NativeUserEntry = OphelNavigationSeed & {
  button?: HTMLElement;
  element?: HTMLElement;
};

export type OphelNavigationResolveResult =
  | {
      ok: true;
      source: "message-id" | "turn-shell" | "native-toc" | "visible-user" | "history-scroll";
      element: HTMLElement;
    }
  | {
      ok: false;
      reason:
        | "navigation-target-missing"
        | "native-toc-missing"
        | "native-toc-entry-missing"
        | "native-target-timeout";
      detail: string;
    };

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function preview(text: string): string {
  return normalizeText(text).slice(0, 120);
}

function isHiddenPromptLabel(text: string): boolean {
  return HIDDEN_PROMPT_LABEL.test(normalizeText(text));
}

function promptTextsCompatible(leftText: string, rightText: string): boolean {
  const left = normalizeText(leftText);
  const right = normalizeText(rightText);
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 24 && longer.startsWith(shorter);
}

function promptTextMatchesNavigation(text: string, navigation: TurnNavigation): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (navigation.textHash && hashText(normalized) === navigation.textHash) return true;

  const wantedPreview = normalizeText(navigation.userPreview ?? "");
  if (!wantedPreview) return false;
  if (normalized.includes(wantedPreview)) return true;
  return wantedPreview.length >= 100 && normalized.length >= 32 && wantedPreview.includes(normalized);
}

function entryMatchesNavigation(
  entry: Pick<NativeUserEntry, "text" | "messageId" | "turnId">,
  navigation: TurnNavigation
): boolean {
  const hasExpectedText = Boolean(navigation.textHash || navigation.userPreview);
  if (hasExpectedText) return promptTextMatchesNavigation(entry.text, navigation);
  return Boolean(
    (navigation.messageId && entry.messageId === navigation.messageId) ||
      (navigation.turnId && entry.turnId === navigation.turnId)
  );
}

export function resolveNativeTocText(
  button: { ariaLabel?: string; text?: string; title?: string },
  scopedTitles: string[],
  fallbackIndex: number
): string {
  const label = normalizeText(button.ariaLabel ?? "");
  if (label && !isHiddenPromptLabel(label)) return label;

  const title = normalizeText(button.title ?? "");
  if (title && !isHiddenPromptLabel(title)) return title;

  const text = normalizeText(button.text ?? "");
  if (text && !isHiddenPromptLabel(text)) return text;

  return normalizeText(scopedTitles[fallbackIndex] ?? "");
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function navigationIdForSeed(seed: OphelNavigationSeed): string {
  if (seed.messageId) return `chatgpt-message:${seed.messageId}`;
  if (seed.turnId) return `chatgpt-turn:${seed.turnId}`;
  return `${NATIVE_NAVIGATION_PREFIX}:${seed.index}:${hashText(normalizeText(seed.text))}`;
}

export function createChatGptTurnNavigation(seed: OphelNavigationSeed): TurnNavigation {
  return {
    kind: "ophel_notSourceAnchor",
    site: "chatgpt",
    navigationId: navigationIdForSeed(seed),
    messageId: seed.messageId,
    turnId: seed.turnId,
    nativeTocIndex: seed.index,
    turnIndex: seed.index,
    textHash: hashText(normalizeText(seed.text)),
    userPreview: preview(seed.text)
  };
}

function sourceAnchorFromSeed(seed: OphelNavigationSeed): SourceAnchor {
  return {
    turnIndex: seed.index,
    userMessageId: seed.messageId,
    userHash: hashText(seed.text),
    assistantHash: hashText(EMPTY_ASSISTANT_REPLY),
    userPreview: preview(seed.text),
    assistantPreview: preview(EMPTY_ASSISTANT_REPLY)
  };
}

export function turnsFromOphelNavigationSeeds(seeds: OphelNavigationSeed[]): Turn[] {
  const assignTurnId = stableTurnIdAssigner();
  return seeds.map((seed, index) => {
    const normalizedSeed = { ...seed, index };
    const sourceAnchor = sourceAnchorFromSeed(normalizedSeed);
    return {
      id: assignTurnId(sourceAnchor),
      turnIndex: index,
      userText: normalizedSeed.text,
      assistantText: EMPTY_ASSISTANT_REPLY,
      sourceAnchor,
      navigation: createChatGptTurnNavigation(normalizedSeed),
      extractedAt: Date.now()
    };
  });
}

function navigationMatches(left?: TurnNavigation, right?: TurnNavigation): boolean {
  if (!left || !right) return false;
  if (left.navigationId && left.navigationId === right.navigationId) return true;
  if (left.messageId && right.messageId && left.messageId === right.messageId) return true;
  if (left.turnId && right.turnId && left.turnId === right.turnId) return true;
  return false;
}

export function visibleEntryMatchesNavigation(
  entry: Pick<NativeUserEntry, "index" | "text" | "messageId" | "turnId">,
  navigation: TurnNavigation
): boolean {
  if (entryMatchesNavigation(entry, navigation)) return true;

  const index = navigation.nativeTocIndex ?? navigation.turnIndex;
  if (typeof index !== "number" || entry.index !== index) return false;
  return promptTextMatchesNavigation(entry.text, navigation);
}

export function nativeTocActivatedEntryMatchesNavigation(
  entry: Pick<NativeUserEntry, "index" | "text" | "messageId" | "turnId">,
  navigation: TurnNavigation
): boolean {
  return entryMatchesNavigation(entry, navigation);
}

function mergedNavigation(existing: Turn, nativeTurn: Turn, turnIndex: number): TurnNavigation | undefined {
  if (!nativeTurn.navigation && !existing.navigation) return undefined;
  if (!nativeTurn.navigation) {
    return {
      ...existing.navigation!,
      turnIndex
    };
  }

  return {
    ...nativeTurn.navigation,
    messageId: nativeTurn.navigation.messageId ?? existing.navigation?.messageId,
    turnId: nativeTurn.navigation.turnId ?? existing.navigation?.turnId,
    turnIndex
  };
}

function enrichTurnByNavigation(
  existing: Turn,
  nativeTurn: Turn,
  turnIndex: number,
  options: { updateUserText: boolean }
): Turn {
  const userText =
    options.updateUserText && nativeTurn.userText.length >= existing.userText.length
      ? nativeTurn.userText
      : existing.userText;
  return {
    ...existing,
    turnIndex,
    userText,
    navigation: mergedNavigation(existing, nativeTurn, turnIndex),
    sourceAnchor: {
      ...existing.sourceAnchor,
      turnIndex,
      userMessageId:
        nativeTurn.navigation?.messageId ??
        nativeTurn.sourceAnchor.userMessageId ??
        existing.sourceAnchor.userMessageId,
      userHash: hashText(userText),
      userPreview: preview(userText)
    }
  };
}

function reindexTurns(turns: Turn[]): Turn[] {
  return turns.map((turn, turnIndex) => ({
    ...turn,
    turnIndex,
    navigation: turn.navigation
      ? {
          ...turn.navigation,
          turnIndex,
          nativeTocIndex: turn.navigation.nativeTocIndex ?? turnIndex
        }
      : undefined,
    sourceAnchor: {
      ...turn.sourceAnchor,
      turnIndex
    }
  }));
}

export function mergeOphelNavigationTurns(
  existingTurns: Turn[],
  nativeTurns: Turn[],
  allowNativeExpansion = true
): Turn[] {
  if (nativeTurns.length === 0) return existingTurns;
  if (existingTurns.length === 0) return allowNativeExpansion ? reindexTurns(nativeTurns) : [];
  if (nativeTurns.length < existingTurns.length) return existingTurns;

  const usedExisting = new Set<number>();
  const matchByNativeIndex = new Map<number, number>();

  nativeTurns.forEach((nativeTurn, nativeIndex) => {
    const matchingIndex = existingTurns.findIndex(
      (candidate, candidateIndex) =>
        !usedExisting.has(candidateIndex) && navigationMatches(candidate.navigation, nativeTurn.navigation)
    );
    if (matchingIndex < 0) return;
    usedExisting.add(matchingIndex);
    matchByNativeIndex.set(nativeIndex, matchingIndex);
  });

  nativeTurns.forEach((nativeTurn, nativeIndex) => {
    if (matchByNativeIndex.has(nativeIndex)) return;
    const matchingIndexes = existingTurns
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(
        ({ candidate, candidateIndex }) =>
          !usedExisting.has(candidateIndex) && promptTextsCompatible(candidate.userText, nativeTurn.userText)
      )
      .map(({ candidateIndex }) => candidateIndex);
    if (matchingIndexes.length !== 1) return;
    usedExisting.add(matchingIndexes[0]);
    matchByNativeIndex.set(nativeIndex, matchingIndexes[0]);
  });

  const merged = nativeTurns.flatMap((nativeTurn, index) => {
    const matchingIndex = matchByNativeIndex.get(index);
    if (matchingIndex !== undefined) {
      return [enrichTurnByNavigation(existingTurns[matchingIndex], nativeTurn, index, { updateUserText: true })];
    }

    const sameIndex = existingTurns[index];
    if (sameIndex && !usedExisting.has(index)) {
      usedExisting.add(index);
      // Keep the existing turn and its navigation metadata when the prompt texts
      // or stable identities disagree. Array position alone is not a safe join.
      return [sameIndex];
    }

    if (index >= existingTurns.length && allowNativeExpansion) {
      return [{
        ...nativeTurn,
        turnIndex: index,
        navigation: nativeTurn.navigation
          ? {
              ...nativeTurn.navigation,
              turnIndex: index,
              nativeTocIndex: nativeTurn.navigation.nativeTocIndex ?? index
            }
          : undefined,
        sourceAnchor: {
          ...nativeTurn.sourceAnchor,
          turnIndex: index
        }
      }];
    }

    return [];
  });

  existingTurns.forEach((turn, index) => {
    if (!usedExisting.has(index)) merged.push(turn);
  });

  return reindexTurns(merged);
}

export function attachOphelNavigationToTurns(turns: Turn[]): Turn[] {
  const visibleEntries = visibleUserEntries();
  return turns.map((turn) => {
    if (turn.navigation?.kind === "ophel_notSourceAnchor") return turn;
    const userHash = hashText(normalizeText(turn.userText));
    const textMatches = visibleEntries.filter((entry) => hashText(normalizeText(entry.text)) === userHash);
    const matchingVisible =
      textMatches.find((entry) => entry.index === turn.turnIndex) ??
      (textMatches.length === 1 ? textMatches[0] : undefined);
    return {
      ...turn,
      navigation: createChatGptTurnNavigation({
        index: turn.turnIndex,
        text: turn.userText,
        messageId: turn.sourceAnchor.userMessageId ?? matchingVisible?.messageId,
        turnId: matchingVisible?.turnId
      })
    };
  });
}

function readElementText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("script, style, button, svg, [aria-hidden='true']").forEach((child) => child.remove());
  return normalizeText(clone.textContent ?? "");
}

function isElementVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function closestUserRoot(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>(USER_MESSAGE_SELECTOR) ?? element;
}

function getMessageId(element: HTMLElement): string | undefined {
  const holder =
    element.closest<HTMLElement>("[data-message-id]") ?? element.querySelector<HTMLElement>("[data-message-id]");
  return holder?.getAttribute("data-message-id")?.trim() || undefined;
}

function getTurnId(element: HTMLElement): string | undefined {
  const holder =
    element.closest<HTMLElement>("[data-turn-id], [data-turn-id-container], [data-turn-key]") ??
    element.closest<HTMLElement>("[data-testid^='conversation-turn']");
  return (
    holder?.getAttribute("data-turn-id") ??
    holder?.getAttribute("data-turn-id-container") ??
    holder?.getAttribute("data-turn-key") ??
    holder?.getAttribute("data-testid") ??
    undefined
  );
}

function visibleUserEntries(doc: Document = document): NativeUserEntry[] {
  const seen = new Set<HTMLElement>();
  return Array.from(doc.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR))
    .map(closestUserRoot)
    .filter((element) => {
      if (seen.has(element)) return false;
      seen.add(element);
      return isElementVisible(element);
    })
    .map((element, index) => ({
      index,
      text: readElementText(element),
      element,
      messageId: getMessageId(element),
      turnId: getTurnId(element)
    }))
    .filter((entry) => entry.text);
}

function nativeButtonIndex(button: HTMLElement, fallbackIndex: number): number {
  const match = HIDDEN_PROMPT_LABEL.exec(button.getAttribute("aria-label")?.trim() ?? "");
  if (!match?.[1]) return fallbackIndex;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed - 1) : fallbackIndex;
}

function isNativeTocButton(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.tagName.toLowerCase() !== "button") return false;
  const label = normalizeText(element.getAttribute("aria-label") ?? "");
  if (!label) return false;
  return HIDDEN_PROMPT_LABEL.test(label) || element.hasAttribute("data-toc-active");
}

function nativeTocEntries(doc: Document = document): NativeUserEntry[] {
  const buttons = Array.from(
    doc.querySelectorAll(".no-scrollbar button[aria-label], nav button[aria-label], aside button[aria-label], [role='navigation'] button[aria-label]")
  )
    .filter(isNativeTocButton)
    .map((button, fallbackIndex) => ({
      index: nativeButtonIndex(button, fallbackIndex),
      button
    }))
    .sort((left, right) => left.index - right.index);

  const scope =
    buttons[0]?.button.closest(".no-scrollbar")?.parentElement ??
    buttons[0]?.button.closest("nav, aside, [role='navigation']") ??
    buttons[0]?.button.parentElement;
  const scopedTitles = scope
    ? Array.from(scope.querySelectorAll<HTMLElement>("[title]"))
        .map((element) => normalizeText(element.getAttribute("title") ?? element.textContent ?? ""))
        .filter((text) => text && !isHiddenPromptLabel(text))
    : [];

  const visible = visibleUserEntries(doc);
  return buttons.map((entry, sortedIndex) => {
    const text = resolveNativeTocText(
      {
        ariaLabel: entry.button.getAttribute("aria-label") ?? "",
        text: entry.button.textContent ?? "",
        title: entry.button.getAttribute("title") ?? ""
      },
      scopedTitles,
      entry.index
    ) || resolveNativeTocText(
      {
        ariaLabel: entry.button.getAttribute("aria-label") ?? "",
        text: entry.button.textContent ?? "",
        title: entry.button.getAttribute("title") ?? ""
      },
      scopedTitles,
      sortedIndex
    );
    const matchingVisibleEntries = visible.filter((candidate) => promptTextsCompatible(candidate.text, text));
    const visibleMatch = matchingVisibleEntries.length === 1 ? matchingVisibleEntries[0] : undefined;
    return visibleMatch
      ? {
          ...entry,
          text: visibleMatch.text || text,
          element: visibleMatch.element,
          messageId: visibleMatch.messageId,
          turnId: visibleMatch.turnId
        }
      : {
          ...entry,
          text
        };
  });
}

export function extractChatGptOphelNavigationTurns(doc: Document = document): Turn[] {
  const nativeEntries = nativeTocEntries(doc).filter((entry) => entry.text);
  if (nativeEntries.length > 0) {
    return turnsFromOphelNavigationSeeds(nativeEntries);
  }
  return turnsFromOphelNavigationSeeds(visibleUserEntries(doc));
}

function targetFromMessageId(messageId: string, doc: Document = document): HTMLElement | null {
  const escaped = cssEscape(messageId);
  const element = doc.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`);
  return element?.closest<HTMLElement>(USER_MESSAGE_SELECTOR) ?? element;
}

function targetFromTurnId(turnId: string, doc: Document = document): HTMLElement | null {
  const escaped = cssEscape(turnId);
  return doc.querySelector<HTMLElement>(
    `[data-turn-id="${escaped}"], [data-turn-id-container="${escaped}"], [data-turn-key="${escaped}"], [data-testid="${escaped}"]`
  );
}

function targetFromVisibleEntries(
  navigation: TurnNavigation,
  activatedNativeToc = false,
  doc: Document = document
): HTMLElement | null {
  const entries = visibleUserEntries(doc);
  const matches = activatedNativeToc ? nativeTocActivatedEntryMatchesNavigation : visibleEntryMatchesNavigation;
  const strictMatch = entries.find((entry) => matches(entry, navigation));
  if (strictMatch?.element) return strictMatch.element;

  const textMatches = entries.filter((entry) =>
    navigation.textHash && hashText(normalizeText(entry.text)) === navigation.textHash
  );
  if (textMatches.length === 1) return textMatches[0].element ?? null;

  const wantedPreview = normalizeText(navigation.userPreview ?? "");
  if (wantedPreview.length < 8) return null;
  const previewMatches = entries.filter((entry) => {
    const candidateText = normalizeText(entry.text);
    return candidateText.includes(wantedPreview) || (wantedPreview.length >= 100 && wantedPreview.includes(candidateText));
  });
  if (previewMatches.length === 1) return previewMatches[0].element ?? null;

  return null;
}

function targetMatchesPrompt(element: HTMLElement, navigation: TurnNavigation): boolean {
  if (!navigation.textHash && !navigation.userPreview) return true;

  const userMessages = element.matches(USER_MESSAGE_SELECTOR)
    ? [element]
    : Array.from(element.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR));
  const candidates = userMessages.length > 0 ? userMessages : [element];
  const texts = candidates.map(readElementText).filter(Boolean);
  if (texts.length === 0) return true;
  return texts.some((text) => promptTextMatchesNavigation(text, navigation));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForTarget(
  navigation: TurnNavigation,
  timeoutMs: number,
  activatedNativeToc = false,
  doc: Document = document
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const byMessage = navigation.messageId ? targetFromMessageId(navigation.messageId, doc) : null;
    const byTurn = navigation.turnId ? targetFromTurnId(navigation.turnId, doc) : null;
    const target =
      (byMessage && targetMatchesPrompt(byMessage, navigation) ? byMessage : null) ??
      (byTurn && targetMatchesPrompt(byTurn, navigation) ? byTurn : null) ??
      targetFromVisibleEntries(navigation, activatedNativeToc, doc);
    if (target) return target;
    await sleep(80);
  }
  return null;
}

async function findPromptByScrolling(
  navigation: TurnNavigation,
  doc: Document,
  scrollElementOverride?: HTMLElement
): Promise<HTMLElement | null> {
  const scrollElement = scrollElementOverride ?? getChatGptScrollElement(doc);
  if (typeof scrollElement.scrollTo !== "function" || scrollElement.clientHeight <= 0) return null;

  const originalScrollTop = scrollElement.scrollTop;
  const maxSteps = 160;
  let direction: -1 | 1 = -1;
  let stalledAtBoundary = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    const target =
      targetFromVisibleEntries(navigation, false, doc) ??
      targetFromVirtualizedTurnContent(navigation, doc);
    if (target) return target;

    const currentTop = scrollElement.scrollTop;
    const range = getChatScrollRange(scrollElement);
    const boundary = direction === -1 ? range.min : range.max;
    const atBoundary = Math.abs(currentTop - boundary) <= 1;
    if (atBoundary) {
      const previousHeight = scrollElement.scrollHeight;
      await sleep(180);
      const targetAfterLoad =
        targetFromVisibleEntries(navigation, false, doc) ??
        targetFromVirtualizedTurnContent(navigation, doc);
      if (targetAfterLoad) return targetAfterLoad;
      if (Math.abs(scrollElement.scrollTop - boundary) <= 1 && scrollElement.scrollHeight === previousHeight) {
        stalledAtBoundary += 1;
        if (stalledAtBoundary >= 2) {
          if (direction === 1) break;
          // The target can be below the current viewport. Search the whole
          // conversation after reaching the oldest loaded message.
          direction = 1;
          stalledAtBoundary = 0;
        }
      } else {
        stalledAtBoundary = 0;
      }
      continue;
    }

    stalledAtBoundary = 0;
    const stepDistance = Math.max(160, Math.floor(scrollElement.clientHeight * 0.72));
    scrollElement.scrollTo({ top: Math.min(range.max, Math.max(range.min, currentTop + direction * stepDistance)), behavior: "instant" });
    await sleep(120);
  }

  scrollElement.scrollTo({ top: originalScrollTop, behavior: "instant" });
  return null;
}

export async function resolveChatGptOphelTarget(
  navigation: TurnNavigation,
  timeoutMs = 1400,
  doc: Document = document,
  scrollElementOverride?: HTMLElement
): Promise<OphelNavigationResolveResult> {
  if (navigation.messageId) {
    const byMessage = targetFromMessageId(navigation.messageId, doc);
    if (byMessage && targetMatchesPrompt(byMessage, navigation)) {
      return { ok: true, source: "message-id", element: byMessage };
    }
  }

  if (navigation.turnId) {
    const shell = targetFromTurnId(navigation.turnId, doc);
    if (shell && targetMatchesPrompt(shell, navigation)) {
      shell.scrollIntoView({ block: "center", inline: "nearest" });
      const revived = await waitForTarget(navigation, Math.min(timeoutMs, 700), false, doc);
      return { ok: true, source: "turn-shell", element: revived ?? shell };
    }
  }

  const visible = targetFromVisibleEntries(navigation, false, doc);
  if (visible) return { ok: true, source: "visible-user", element: visible };

  const virtualizedMatch = targetFromVirtualizedTurnContent(navigation, doc);
  if (virtualizedMatch) return { ok: true, source: "visible-user", element: virtualizedMatch };

  const entries = nativeTocEntries(doc);
  if (entries.length === 0) {
    const scrolledTarget = await findPromptByScrolling(navigation, doc, scrollElementOverride);
    if (scrolledTarget) return { ok: true, source: "history-scroll", element: scrolledTarget };
    return {
      ok: false,
      reason: "native-toc-missing",
      detail: "ChatGPT has no prompt index, and the target prompt was not found while searching the loaded conversation history."
    };
  }

  const targetIndex = navigation.nativeTocIndex ?? navigation.turnIndex;
  const indexedEntry = typeof targetIndex === "number"
    ? entries.find((candidate) => candidate.index === targetIndex)
    : undefined;
  const indexedEntryMatches = indexedEntry && nativeTocActivatedEntryMatchesNavigation(indexedEntry, navigation);
  const textMatches = entries.filter((candidate) => nativeTocActivatedEntryMatchesNavigation(candidate, navigation));
  const entry = indexedEntryMatches ? indexedEntry : textMatches.length === 1 ? textMatches[0] : undefined;
  if (!entry?.button) {
    const scrolledTarget = await findPromptByScrolling(navigation, doc, scrollElementOverride);
    if (scrolledTarget) return { ok: true, source: "history-scroll", element: scrolledTarget };
    return {
      ok: false,
      reason: "native-toc-entry-missing",
      detail: "No ChatGPT native prompt navigation entry matches this turn navigation id."
    };
  }

  entry.button.click();
  const mounted = await waitForTarget(navigation, timeoutMs, true, doc);
  if (!mounted) {
    return {
      ok: false,
      reason: "native-target-timeout",
      detail: "ChatGPT native prompt navigation did not mount the requested turn in time."
    };
  }

  return { ok: true, source: "native-toc", element: mounted };
}

function targetFromVirtualizedTurnContent(navigation: TurnNavigation, doc: Document): HTMLElement | null {
  const wantedPreview = normalizeText(navigation.userPreview ?? "");
  if (wantedPreview.length < 8) return null;

  const matches: HTMLElement[] = [];
  for (const turnContent of doc.querySelectorAll<HTMLElement>("[data-virtualized-turn-content]")) {
    if (!isElementVisible(turnContent)) continue;
    const userEntries = Array.from(turnContent.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR));
    const candidates = userEntries.length > 0 ? userEntries : [turnContent];
    const matchingElement = candidates.find((candidate) => {
      const text = readElementText(candidate);
      return text.includes(wantedPreview) || (wantedPreview.length >= 100 && wantedPreview.includes(text));
    });
    if (matchingElement) matches.push(matchingElement);
  }

  return matches.length === 1 ? matches[0] : null;
}
