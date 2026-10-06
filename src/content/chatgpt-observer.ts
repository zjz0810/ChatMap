import type { ExtractedTurnsMessage, Turn } from "../shared/types";
import {
  attachOphelNavigationToTurns,
  extractChatGptOphelNavigationTurns,
  mergeOphelNavigationTurns
} from "./chatgpt-ophel-navigation.ts";
import { extractConversationApiTurns, getChatGptConversationIdFromUrl } from "./conversation-api-extractor.ts";
import { extractStructuredTurns } from "./structured-extractor.ts";
import { extractModernChatGptTurns, extractTurns, mergeTurns, normalizeTurnIndexes } from "./turn-extractor.ts";
import { getChatGptScrollElement, getChatScrollRange, describeScrollElement } from "./scroll-container.ts";
import { scanChatGptHistory } from "./chatgpt-history-scan.ts";

type TurnsListener = (turns: Turn[]) => void;

type HarvestMeta = NonNullable<ExtractedTurnsMessage["harvestMeta"]>;

let latestTurns: Turn[] = [];
let observer: MutationObserver | null = null;
let debounceTimer: number | null = null;
let lastHarvestMeta: HarvestMeta | undefined;
let latestTurnsConversationId = "";
let activeScan: Promise<Turn[]> | null = null;
let scanGeneration = 0;
let latestReadGeneration = 0;
let pendingScrollDirection: "older" | "newer" | null = null;
let pendingScrollDirectionAt = 0;
let observerPauseCount = 0;
let observerSuppressedUntil = 0;

function observerUpdatesSuppressed(): boolean {
  return observerPauseCount > 0 || Date.now() < observerSuppressedUntil;
}

/**
 * Navigation remounts ChatGPT's virtual list but does not change the
 * conversation. Ignore those mutations so a jump can never create turns.
 */
export function pauseChatGptObserverForNavigation(): () => void {
  observerPauseCount += 1;
  if (debounceTimer) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    observerPauseCount = Math.max(0, observerPauseCount - 1);
    observerSuppressedUntil = Math.max(observerSuppressedUntil, Date.now() + 2_000);
  };
}

function takeWindowPlacement(): boolean | "prepend" {
  const stillFresh = Date.now() - pendingScrollDirectionAt < 4_000;
  const placement = stillFresh && pendingScrollDirection === "older"
    ? "prepend"
    : stillFresh && pendingScrollDirection === "newer";
  pendingScrollDirection = null;
  pendingScrollDirectionAt = 0;
  return placement;
}

function currentWindowPlacement(): boolean | "prepend" {
  if (Date.now() - pendingScrollDirectionAt >= 4_000) return false;
  return pendingScrollDirection === "older" ? "prepend" : pendingScrollDirection === "newer";
}

function isFullConversationSource(source: HarvestMeta["source"]): boolean {
  return (
    source === "conversation-api" ||
    source === "structured" ||
    source === "web-storage" ||
    source === "indexeddb"
  );
}

function shouldReplaceLatestTurns(source: HarvestMeta["source"]): boolean {
  return isFullConversationSource(source) || source === "native-navigation";
}

function turnSequenceChanged(previous: Turn[], next: Turn[]): boolean {
  return previous.length !== next.length || next.some((turn, index) => previous[index]?.id !== turn.id);
}

function emitTurns(listener: TurnsListener): void {
  if (activeScan || observerUpdatesSuppressed()) return;
  const generation = scanGeneration;
  const readGeneration = ++latestReadGeneration;
  const windowPlacement = currentWindowPlacement();
  const conversationId = resetLatestTurnsForConversation();
  const pendingTurns = windowPlacement
    ? Promise.resolve(readMountedChatGptTurns())
    : getNonDisruptiveTurns();
  void pendingTurns.then((turns) => {
    if (
      conversationId !== getConversationId() ||
      generation !== scanGeneration ||
      readGeneration !== latestReadGeneration ||
      activeScan
    ) return;
    const previousTurns = latestTurns;
    latestTurns = !windowPlacement && lastHarvestMeta && shouldReplaceLatestTurns(lastHarvestMeta.source)
      ? turns
      : mergeTurns(latestTurns, turns, windowPlacement);
    if (windowPlacement && turnSequenceChanged(previousTurns, latestTurns)) takeWindowPlacement();
    listener(latestTurns);
  });
}

export function getConversationTitle(): string {
  const title = document.title.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim();
  return title || "Current conversation";
}

export function getConversationId(): string {
  return getChatGptConversationIdFromUrl() ?? window.location.href;
}

function resetLatestTurnsForConversation(): string {
  const conversationId = getConversationId();
  if (conversationId === latestTurnsConversationId) return conversationId;
  latestTurnsConversationId = conversationId;
  latestTurns = [];
  lastHarvestMeta = undefined;
  return conversationId;
}

function setSourceMeta(source: HarvestMeta["source"], turns: Turn[]): void {
  lastHarvestMeta = {
    attempted: source !== "dom",
    source,
    scrollContainer: "none",
    scrollHeight: 0,
    clientHeight: 0,
    scannedSteps: 0
  };

  if (source === "dom" && turns.length === 0) {
    lastHarvestMeta = undefined;
  }
}

function applyOphelNavigationIndex(
  turns: Turn[],
  allowNativeExpansion = false
): { turns: Turn[]; source: HarvestMeta["source"] | null } {
  const navigableTurns = attachOphelNavigationToTurns(turns);
  const nativeTurns = extractChatGptOphelNavigationTurns();
  if (nativeTurns.length === 0) return { turns: navigableTurns, source: null };

  const merged = mergeOphelNavigationTurns(navigableTurns, nativeTurns, allowNativeExpansion);
  return {
    turns: merged,
    source: turns.length === 0 || merged.length > turns.length ? "native-navigation" : null
  };
}

function readMountedChatGptTurns(): Turn[] {
  // A scroll-triggered virtualized load is a window, not an authoritative
  // conversation snapshot. Reading API/storage here can return a stale full
  // list and bypass the prepend/append merge below.
  const turns = attachOphelNavigationToTurns(normalizeTurnIndexes(extractTurns()));
  setSourceMeta("dom", turns);
  return turns;
}

export async function getNonDisruptiveTurns(): Promise<Turn[]> {
  const conversationApiResult = await extractConversationApiTurns();
  if (conversationApiResult && conversationApiResult.turns.length > 0) {
    const navigated = applyOphelNavigationIndex(conversationApiResult.turns, false);
    setSourceMeta(navigated.source ?? conversationApiResult.source, navigated.turns);
    return navigated.turns;
  }

  // The legacy conversation endpoint can now return 404. Read the mounted modern
  // conversation DOM immediately before scanning embedded state or IndexedDB.
  const modernDomTurns = extractModernChatGptTurns();
  if (modernDomTurns.length > 0) {
    const navigated = applyOphelNavigationIndex(modernDomTurns, false);
    setSourceMeta("dom", navigated.turns);
    return navigated.turns;
  }

  const structuredResult = await extractStructuredTurns();
  if (structuredResult && structuredResult.turns.length > 0) {
    const navigated = applyOphelNavigationIndex(structuredResult.turns, false);
    setSourceMeta(navigated.source ?? structuredResult.source, navigated.turns);
    return navigated.turns;
  }

  const domTurns = attachOphelNavigationToTurns(normalizeTurnIndexes(extractTurns()));
  setSourceMeta("dom", domTurns);
  return domTurns;
}

export async function harvestTurnsByScrolling(): Promise<Turn[]> {
  return refreshCompleteTurns();
}

export function getLatestTurns(): Turn[] {
  resetLatestTurnsForConversation();
  if (latestTurns.length === 0) {
    latestTurns = attachOphelNavigationToTurns(normalizeTurnIndexes(extractTurns()));
  }
  return latestTurns;
}

export async function refreshLatestTurns(): Promise<Turn[]> {
  if (activeScan) return activeScan;
  const generation = scanGeneration;
  const readGeneration = ++latestReadGeneration;
  const windowPlacement = currentWindowPlacement();
  const conversationId = resetLatestTurnsForConversation();
  const turns = windowPlacement
    ? readMountedChatGptTurns()
    : await getNonDisruptiveTurns();
  if (generation !== scanGeneration || readGeneration !== latestReadGeneration) return activeScan ?? latestTurns;
  if (conversationId !== getConversationId()) return refreshLatestTurns();
  const previousTurns = latestTurns;
  latestTurns = !windowPlacement && lastHarvestMeta && shouldReplaceLatestTurns(lastHarvestMeta.source)
    ? turns
    : mergeTurns(latestTurns, turns, windowPlacement);
  if (windowPlacement && turnSequenceChanged(previousTurns, latestTurns)) takeWindowPlacement();
  return latestTurns;
}

export async function refreshCompleteTurns(): Promise<Turn[]> {
  if (activeScan) return activeScan;
  const conversationId = resetLatestTurnsForConversation();
  scanGeneration += 1;
  latestReadGeneration += 1;
  activeScan = (async () => {
    // Full refresh is a DOM history scan. Do not wait for the legacy conversation
    // API probe here: its response is discarded, and a stalled request would keep
    // the old graph on screen forever before the actual scan even starts.
    if (conversationId !== getConversationId()) throw new Error("Conversation changed during rebuild.");
    const scroller = getChatGptScrollElement();
    const scan = await scanChatGptHistory({
      scroller,
      range: () => getChatScrollRange(scroller),
      read: () => attachOphelNavigationToTurns(extractTurns()),
      pause: () => new Promise((resolve) => window.setTimeout(resolve, 150)),
      isCurrent: () => conversationId === getConversationId()
    });
    if (!scan.turns.length) throw new Error("No messages found during history scan.");
    // The scan normally walks oldest-to-newest. When ChatGPT exposes message
    // timestamps, use them as the final authority so a reversed/virtualized DOM
    // window cannot make the newest prompt become Turn 1.
    latestTurns = normalizeTurnIndexes(scan.turns);
    lastHarvestMeta = {
      attempted: true, source: "dom", complete: scan.complete,
      scrollContainer: describeScrollElement(scroller),
      scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      scannedSteps: scan.steps
    };
    return latestTurns;
  })().finally(() => { activeScan = null; });
  return activeScan;
}

export function startChatGptObserver(listener: TurnsListener): void {
  if (observer) return;

  const schedule = () => {
    if (activeScan || observerUpdatesSuppressed()) return;
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => emitTurns(listener), 350);
  };

  document.addEventListener("wheel", (event) => {
    if (event.deltaY < 0) pendingScrollDirection = "older";
    else if (event.deltaY > 0) pendingScrollDirection = "newer";
    if (event.deltaY !== 0) pendingScrollDirectionAt = Date.now();
  }, { capture: true, passive: true });

  observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  emitTurns(listener);
}

export function toTurnsMessage(turns: Turn[]): ExtractedTurnsMessage {
  return {
    type: "TURNMAP_TURNS_UPDATED",
    turns,
    conversationTitle: getConversationTitle(),
    conversationId: getConversationId(),
    harvestMeta: lastHarvestMeta
  };
}
