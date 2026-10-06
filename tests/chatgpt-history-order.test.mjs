import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeChatGptWindows } from "../src/shared/chatgpt-turn-order.ts";
import { scanChatGptHistory } from "../src/content/chatgpt-history-scan.ts";
import { normalizeTurnIndexes } from "../src/content/turn-extractor.ts";
import { mergeTurnUpdates } from "../src/side-panel/turn-merge.ts";

function turn(number, localIndex = 0, assistantText = "answer") {
  return {
    id: `turn-${number}`, turnIndex: localIndex, userText: `question ${number}`,
    assistantText, extractedAt: 1,
    sourceAnchor: { turnIndex: localIndex, userHash: `u${number}`, assistantHash: "a",
      userPreview: `question ${number}`, assistantPreview: assistantText },
    navigation: { kind: "ophel_notSourceAnchor", site: "chatgpt", turnIndex: localIndex,
      nativeTocIndex: localIndex, userPreview: `question ${number}` }
  };
}
const windowOf = (...numbers) => numbers.map((number, index) => turn(number, index));
const prompts = (turns) => turns.map((entry) => entry.userText);

test("scroll-triggered ChatGPT loads bypass API/storage snapshots and merge the mounted DOM window by direction", () => {
  const source = readFileSync(new URL("../src/content/chatgpt-observer.ts", import.meta.url), "utf8");
  const mountedReaderStart = source.indexOf("function readMountedChatGptTurns");
  const mountedReaderEnd = source.indexOf("export async function getNonDisruptiveTurns", mountedReaderStart);
  const mountedReader = source.slice(mountedReaderStart, mountedReaderEnd);
  const emitStart = source.indexOf("function emitTurns");
  const emitEnd = source.indexOf("export function getConversationTitle", emitStart);
  const emit = source.slice(emitStart, emitEnd);
  const refreshStart = source.indexOf("export async function refreshLatestTurns");
  const refreshEnd = source.indexOf("export async function refreshCompleteTurns", refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);

  assert.match(mountedReader, /extractTurns\(\)/);
  assert.match(mountedReader, /setSourceMeta\("dom", turns\)/);
  assert.match(emit, /windowPlacement\s*\?\s*Promise\.resolve\(readMountedChatGptTurns\(\)\)\s*:\s*getNonDisruptiveTurns\(\)/);
  assert.match(emit, /!windowPlacement && lastHarvestMeta && shouldReplaceLatestTurns/);
  assert.match(refresh, /windowPlacement\s*\?\s*readMountedChatGptTurns\(\)\s*:\s*await getNonDisruptiveTurns\(\)/);
  assert.match(refresh, /!windowPlacement && lastHarvestMeta && shouldReplaceLatestTurns/);
});

test("late ChatGPT reads cannot overwrite a newer mounted-window update", () => {
  const source = readFileSync(new URL("../src/content/chatgpt-observer.ts", import.meta.url), "utf8");
  const emitStart = source.indexOf("function emitTurns");
  const emitEnd = source.indexOf("export function getConversationTitle", emitStart);
  const emit = source.slice(emitStart, emitEnd);
  const refreshStart = source.indexOf("export async function refreshLatestTurns");
  const refreshEnd = source.indexOf("export async function refreshCompleteTurns", refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);

  assert.match(source, /let latestReadGeneration = 0/);
  assert.match(emit, /const readGeneration = \+\+latestReadGeneration/);
  assert.match(emit, /readGeneration !== latestReadGeneration/);
  assert.match(refresh, /const readGeneration = \+\+latestReadGeneration/);
  assert.match(refresh, /readGeneration !== latestReadGeneration/);
  assert.match(source, /scanGeneration \+= 1;\s*latestReadGeneration \+= 1;/);
});

test("a mounted older window is prepended by overlap instead of appended as new turns", () => {
  const result = mergeChatGptWindows(windowOf(3, 4, 5), windowOf(1, 2, 3));
  assert.deepEqual(prompts(result), prompts(windowOf(1, 2, 3, 4, 5)));
  assert.deepEqual(result.map((entry) => entry.turnIndex), [0, 1, 2, 3, 4]);
  assert.equal(result[2].id, "turn-3");
});

test("a reversed virtualized window is corrected from its overlap anchors", () => {
  const result = mergeChatGptWindows(windowOf(1, 2, 3, 4), windowOf(4, 3, 2, 1));
  assert.deepEqual(prompts(result), prompts(windowOf(1, 2, 3, 4)));
  assert.deepEqual(result.map((entry) => entry.turnIndex), [0, 1, 2, 3]);
});

test("new replies enrich the matching prompt and append only the overlapping tail", () => {
  const result = mergeChatGptWindows(windowOf(1, 2), [turn(2, 0, "a longer streamed reply"), turn(3, 1)]);
  assert.deepEqual(prompts(result), prompts(windowOf(1, 2, 3)));
  assert.equal(result[1].assistantText, "a longer streamed reply");
  assert.equal(result[1].id, "turn-2");
});

test("an edited prompt in an otherwise aligned virtualized window updates its existing turn", () => {
  const existing = windowOf(1, 2, 3, 4, 5);
  const incoming = windowOf(1, 2, 3, 4, 5);
  incoming[4] = {
    ...incoming[4],
    id: "edited-turn-5",
    userText: "revised question five",
    assistantText: "a fuller revised answer",
    sourceAnchor: { ...incoming[4].sourceAnchor, userHash: "revised-u5", assistantHash: "revised-a5" }
  };

  const result = mergeChatGptWindows(existing, incoming);

  assert.equal(result.length, 5);
  assert.equal(result[4].id, existing[4].id);
  assert.equal(result[4].userText, "revised question five");
  assert.equal(result[4].assistantText, "a fuller revised answer");
});

test("ChatGPT stable message and turn identities match repeated prompts across updates", () => {
  const existing = windowOf(1, 1).map((entry, index) => ({
    ...entry,
    id: `original-${index + 1}`,
    navigation: { site: "chatgpt", messageId: `user-${index + 1}` }
  }));
  const incoming = windowOf(1, 1).map((entry, index) => ({
    ...entry,
    id: `updated-${index + 1}`,
    assistantText: `updated answer ${index + 1}`,
    navigation: { site: "chatgpt", messageId: `user-${index + 1}` }
  }));

  const result = mergeChatGptWindows(existing, incoming);

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((entry) => entry.id), existing.map((entry) => entry.id));
  assert.deepEqual(result.map((entry) => entry.assistantText), ["updated answer 1", "updated answer 2"]);
});

test("a disjoint history window cannot silently become the latest messages", () => {
  assert.deepEqual(prompts(mergeChatGptWindows(windowOf(40, 41), windowOf(1, 2))), prompts(windowOf(40, 41)));
});

test("a user scroll that loads an older disjoint turn prepends and reindexes the map", () => {
  const result = mergeChatGptWindows(windowOf(2, 3), windowOf(1), "prepend");
  assert.deepEqual(prompts(result), prompts(windowOf(1, 2, 3)));
  assert.deepEqual(result.map((entry) => entry.turnIndex), [0, 1, 2]);
  assert.equal(result[1].id, "turn-2");
});

test("a disjoint window loaded while scrolling toward the latest turn appends", () => {
  const result = mergeChatGptWindows(windowOf(2, 3), windowOf(4), true);
  assert.deepEqual(prompts(result), prompts(windowOf(2, 3, 4)));
});

test("replace repairs corrupted cache order and removes stale duplicate nodes", () => {
  const cached = [...windowOf(2, 3, 1), { ...turn(1), id: "stale-duplicate" }];
  const result = mergeTurnUpdates(cached, windowOf(1, 2, 3), "replace");
  assert.deepEqual(prompts(result.turns), prompts(windowOf(1, 2, 3)));
  assert.deepEqual(result.turns.map((entry) => entry.turnIndex), [0, 1, 2]);
});

test("identical prompts within one window remain separate messages", () => {
  const result = mergeChatGptWindows([], [turn(1), { ...turn(1), id: "repeat" }]);
  assert.equal(result.length, 2);
  assert.equal(new Set(result.map((entry) => entry.id)).size, 2);
});

for (const reverse of [false, true]) {
  test(`full scan starts at oldest messages and restores viewport (reverse=${reverse})`, async () => {
    const minimum = reverse ? -800 : 0;
    const scroller = { scrollTop: minimum + 600, scrollHeight: 1200, clientHeight: 400,
      scrollTo({ top }) { this.scrollTop = top; } };
    const originalTop = scroller.scrollTop;
    const result = await scanChatGptHistory({
      scroller, range: () => ({ min: minimum, max: minimum + 800 }),
      read: () => {
        const start = Math.min(4, Math.floor((scroller.scrollTop - minimum) / 200));
        return windowOf(start + 1, start + 2, start + 3);
      },
      pause: async () => {}, isCurrent: () => true
    });
    assert.equal(result.complete, true);
    assert.deepEqual(prompts(result.turns), prompts(windowOf(1, 2, 3, 4, 5, 6, 7)));
    assert.equal(scroller.scrollTop, originalTop);
  });
}

test("bounded scans do not claim completeness", async () => {
  const scroller = { scrollTop: 500, scrollHeight: 20000, clientHeight: 400,
    scrollTo({ top }) { this.scrollTop = top; } };
  const result = await scanChatGptHistory({ scroller, range: () => ({ min: 0, max: 19600 }),
    read: () => windowOf(1, 2), pause: async () => {}, isCurrent: () => true, maxSteps: 1 });
  assert.equal(result.complete, false);
  assert.equal(scroller.scrollTop, 500);
});

test("ChatGPT full-scan results use message timestamps to restore oldest-to-newest order", () => {
  const latest = { ...turn(2), createdAt: 2000 };
  const oldest = { ...turn(1), createdAt: 1000 };
  const ordered = normalizeTurnIndexes([latest, oldest]);

  assert.deepEqual(prompts(ordered), ["question 1", "question 2"]);
  assert.deepEqual(ordered.map((entry) => entry.turnIndex), [0, 1]);
});

test("ChatGPT complete refresh normalizes the full-scan order before returning turns", () => {
  const source = readFileSync(new URL("../src/content/chatgpt-observer.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function refreshCompleteTurns");
  const end = source.indexOf("export function startChatGptObserver", start);
  const refreshBody = source.slice(start, end);

  assert.match(refreshBody, /normalizeTurnIndexes\(scan\.turns\)/);
  assert.doesNotMatch(refreshBody, /getNonDisruptiveTurns\(/);
  assert.ok(refreshBody.indexOf("scanChatGptHistory(") < refreshBody.indexOf("latestTurns = normalizeTurnIndexes"));
});

test("ChatGPT observer uses native navigation only to enrich real extracted turns", () => {
  const source = readFileSync(new URL("../src/content/chatgpt-observer.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function getNonDisruptiveTurns");
  const end = source.indexOf("export async function harvestTurnsByScrolling", start);
  const body = source.slice(start, end);

  assert.match(body, /applyOphelNavigationIndex\(modernDomTurns, false\)/);
  assert.doesNotMatch(body, /applyOphelNavigationIndex\(\[\]\)/);
  assert.doesNotMatch(body, /setSourceMeta\("native-navigation"/);
});

test("failed full scans return diagnostics instead of a silent stale-turn fallback", () => {
  const source = readFileSync(new URL("../src/content/index.ts", import.meta.url), "utf8");

  assert.match(source, /scanError\s*}/);
  assert.match(source, /complete: false,\s*scanError/);
});

test("switching conversations aborts the scan without scrolling the new conversation", async () => {
  let current = true;
  const scroller = { scrollTop: 500, scrollHeight: 1000, clientHeight: 400,
    scrollTo({ top }) { this.scrollTop = top; } };
  await assert.rejects(scanChatGptHistory({ scroller, range: () => ({ min: 0, max: 600 }),
    read: () => windowOf(1), pause: async () => { current = false; }, isCurrent: () => current }), /Conversation changed/);
  assert.equal(scroller.scrollTop, 0);
});
