import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSequentialEdgeRoutes,
  createSequentialLayoutPositions,
  automaticEdgeKindFromId,
  DEFAULT_CONVERSATION_GRAPH_LAYOUT,
  filterRestoredUserEdges,
  normalizeConversationGraphLayoutSettings,
  reconcileAutoEdgeState,
  resolveLayoutPositions,
  sortTurnsByTurnIndex,
  uniqueTurnsByTurnIndex
} from "../src/side-panel/graph/graph-layout.ts";

const defaultLayout = { ...DEFAULT_CONVERSATION_GRAPH_LAYOUT };

function makeTurns(count, extras = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `turn-${index + 1}`,
    turnIndex: index + 1,
    userText: `question ${index + 1}`,
    assistantText: `answer ${index + 1}`,
    ...extras
  }));
}

test("seven turns fit the first row and the root sits directly left of Turn 1", () => {
  const turns = makeTurns(7);
  const positions = createSequentialLayoutPositions(turns, defaultLayout);

  assert.deepEqual(turns.map(({ id }) => positions[id]), [
    { x: 380, y: 0 },
    { x: 700, y: 0 },
    { x: 1020, y: 0 },
    { x: 1340, y: 0 },
    { x: 1660, y: 0 },
    { x: 1980, y: 0 },
    { x: 2300, y: 0 }
  ]);
  assert.deepEqual(positions["conversation-root"], { x: 0, y: 0 });
});

test("Turn 8 begins the second row at the same column as Turn 7 in snake mode", () => {
  const turns = makeTurns(8);
  const positions = createSequentialLayoutPositions(turns, defaultLayout);

  assert.deepEqual(positions["turn-8"], { x: positions["turn-7"].x, y: 220 });
});

test("snake rows alternate direction across turns 1 to 21", () => {
  const turns = makeTurns(21);
  const positions = createSequentialLayoutPositions(turns, defaultLayout);
  const xs = (from, to) => turns.slice(from - 1, to).map(({ id }) => positions[id].x);

  assert.deepEqual(xs(1, 7), [380, 700, 1020, 1340, 1660, 1980, 2300]);
  assert.deepEqual(xs(8, 14), [2300, 1980, 1660, 1340, 1020, 700, 380]);
  assert.deepEqual(xs(15, 21), [380, 700, 1020, 1340, 1660, 1980, 2300]);
  for (let i = 1; i <= 21; i += 1) {
    const expectedRow = Math.floor((i - 1) / 7);
    const expectedColumn = expectedRow % 2 === 0 ? (i - 1) % 7 : 6 - ((i - 1) % 7);
    assert.deepEqual(positions[`turn-${i}`], { x: 380 + expectedColumn * 320, y: expectedRow * 220 });
  }
});

test("layout order is turnIndex only and is independent of assistant text", () => {
  const turns = makeTurns(8);
  const remountedOutOfOrder = [turns[7], turns[1], turns[4], turns[0], turns[6], turns[2], turns[5], turns[3]];
  const changedAnswers = remountedOutOfOrder.map((turn) => ({ ...turn, assistantText: "a completely different answer" }));

  assert.deepEqual(sortTurnsByTurnIndex(remountedOutOfOrder).map(({ id }) => id), turns.map(({ id }) => id));
  assert.deepEqual(
    createSequentialLayoutPositions(remountedOutOfOrder, defaultLayout),
    createSequentialLayoutPositions(changedAnswers, defaultLayout)
  );
});

test("duplicate turn identities produce one grid node and one sequence edge", () => {
  const turns = [makeTurns(3)[0], makeTurns(3)[1], { ...makeTurns(3)[1], assistantText: "updated" }, makeTurns(3)[2]];
  const uniqueTurns = uniqueTurnsByTurnIndex(turns);
  const positions = createSequentialLayoutPositions(turns, defaultLayout);
  const edges = createSequentialEdgeRoutes(turns);

  assert.equal(uniqueTurns.length, 3);
  assert.deepEqual(Object.keys(positions).sort(), ["conversation-root", "turn-1", "turn-2", "turn-3"]);
  assert.equal(edges.length, 3);
});

test("automatic edges are only root-to-first and sequential n-to-n+1 edges", () => {
  const turns = makeTurns(15).reverse();
  const routes = createSequentialEdgeRoutes(turns);

  assert.equal(routes.length, 15);
  assert.deepEqual(routes[0], {
    id: "sequence-conversation-root-turn-1",
    sourceId: "conversation-root",
    targetId: "turn-1",
    sourceHandle: "source-right",
    targetHandle: "target-left",
    isRootEdge: true
  });
  assert.equal(routes.filter(({ isRootEdge }) => isRootEdge).length, 1);
  assert.deepEqual(
    routes.slice(1).map(({ sourceId, targetId }) => [sourceId, targetId]),
    Array.from({ length: 14 }, (_, index) => [`turn-${index + 1}`, `turn-${index + 2}`])
  );
  assert.ok(routes.every(({ id }) => id.startsWith("sequence-")));
});

test("Snake with 20 turns has one Root edge, 20 sequence edges, and zero topic edges", () => {
  const turns = makeTurns(20).reverse();
  const routes = createSequentialEdgeRoutes(turns);
  const edges = routes.map((route) => ({ ...route, label: "sequence" }));
  const rootEdges = edges.filter(({ sourceId }) => sourceId === "conversation-root");
  const autoSequenceEdges = edges.filter(({ id }) => automaticEdgeKindFromId(id) === "auto-sequence");
  const autoTopicEdges = edges.filter(({ id }) => automaticEdgeKindFromId(id) === "auto-topic");

  assert.equal(rootEdges.length, 1);
  assert.equal(autoSequenceEdges.length, 20);
  assert.equal(autoTopicEdges.length, 0);
  assert.equal(rootEdges[0].targetId, "turn-1");
  assert.deepEqual(
    autoSequenceEdges.map(({ sourceId, targetId }) => [sourceId, targetId]),
    [
      ["conversation-root", "turn-1"],
      ...Array.from({ length: 19 }, (_, index) => [`turn-${index + 1}`, `turn-${index + 2}`])
    ]
  );
  assert.ok(edges.every(({ label }) => label === "sequence"));
});

test("legacy automatic topic/next IDs are distinguished from user edges and not restored", () => {
  const storedEdges = [
    { id: "conversation-root-turn-1", source: "conversation-root", target: "turn-1" },
    { id: "sequence-turn-1-turn-2", source: "turn-1", target: "turn-2" },
    { id: "user-custom-edge", source: "conversation-root", target: "turn-2" }
  ];

  assert.equal(automaticEdgeKindFromId(storedEdges[0].id), "auto-topic");
  assert.equal(automaticEdgeKindFromId(storedEdges[1].id), "auto-sequence");
  assert.equal(automaticEdgeKindFromId(storedEdges[2].id), null);
  assert.deepEqual(
    filterRestoredUserEdges(storedEdges, new Set(["conversation-root", "turn-1", "turn-2"])).map(({ id }) => id),
    ["user-custom-edge"]
  );
});

test("snake sequence edges use short horizontal and vertical node handles", () => {
  const routes = createSequentialEdgeRoutes(makeTurns(16));

  assert.deepEqual(
    [routes[7], routes[8], routes[9], routes[14], routes[15]].map((route) => [
      route.sourceId,
      route.targetId,
      route.sourceHandle,
      route.targetHandle
    ]),
    [
      ["turn-7", "turn-8", "source-bottom", "target-top"],
      ["turn-8", "turn-9", "source-left", "target-right"],
      ["turn-9", "turn-10", "source-left", "target-right"],
      ["turn-14", "turn-15", "source-bottom", "target-top"],
      ["turn-15", "turn-16", "source-right", "target-left"]
    ]
  );
});

test("hiding the root omits only its edge; turn sequence stays connected", () => {
  const routes = createSequentialEdgeRoutes(makeTurns(3), true);

  assert.deepEqual(routes.map(({ sourceId, targetId }) => [sourceId, targetId]), [
    ["turn-1", "turn-2"],
    ["turn-2", "turn-3"]
  ]);
});

test("appending Turn 8 does not move Turns 1 through 7", () => {
  const firstSeven = makeTurns(7);
  const initial = createSequentialLayoutPositions(firstSeven, defaultLayout);
  const withTurnEight = createSequentialLayoutPositions(makeTurns(8), defaultLayout);

  for (const turn of firstSeven) assert.deepEqual(withTurnEight[turn.id], initial[turn.id]);
});

test("Snake overwrites legacy automatic positions but keeps stored custom-node positions", () => {
  const computed = createSequentialLayoutPositions(makeTurns(2), defaultLayout);
  const stored = {
    "conversation-root": { x: 1000, y: 800 },
    "turn-1": { x: 9000, y: 9000 },
    "turn-2": { x: 8000, y: 8000 },
    "custom-note": { x: 1200, y: 450 }
  };
  const snakePositions = resolveLayoutPositions(computed, stored, false);

  assert.deepEqual(snakePositions["conversation-root"], { x: 0, y: 0 });
  assert.deepEqual(snakePositions["turn-1"], { x: 380, y: 0 });
  assert.deepEqual(snakePositions["turn-2"], { x: 700, y: 0 });
  assert.deepEqual(snakePositions["custom-note"], { x: 1200, y: 450 });
  assert.deepEqual(resolveLayoutPositions(computed, stored, true)["turn-1"], { x: 9000, y: 9000 });
});

test("changing row width to five recomputes a deterministic grid for Rebuild", () => {
  const settings = normalizeConversationGraphLayoutSettings({ ...defaultLayout, columnsPerRow: 5 });
  const positions = createSequentialLayoutPositions(makeTurns(8), settings);

  assert.deepEqual(positions["turn-5"], { x: 1660, y: 0 });
  assert.deepEqual(positions["turn-6"], { x: 1660, y: 220 });
  assert.deepEqual(positions["turn-8"], { x: 1020, y: 220 });
});

test("left-to-right mode and spacing settings are honored", () => {
  const settings = normalizeConversationGraphLayoutSettings({
    columnsPerRow: 3,
    horizontalSpacing: 400,
    verticalSpacing: 280,
    arrangement: "left-to-right"
  });
  const positions = createSequentialLayoutPositions(makeTurns(5), settings);

  assert.deepEqual(positions["turn-3"], { x: 1180, y: 0 });
  assert.deepEqual(positions["turn-4"], { x: 380, y: 280 });
  assert.deepEqual(positions["turn-5"], { x: 780, y: 280 });
});

test("layout settings clamp columns and spacing to supported ranges", () => {
  assert.deepEqual(
    normalizeConversationGraphLayoutSettings({
      columnsPerRow: 99,
      horizontalSpacing: 10,
      verticalSpacing: 9000,
      arrangement: "unknown",
      showSequenceEdges: false
    }),
    {
      columnsPerRow: 15,
      horizontalSpacing: 160,
      verticalSpacing: 800,
      arrangement: "snake",
      showSequenceEdges: false
    }
  );
});

test("sequence edge visibility and stale hidden edge ids are reconciled", () => {
  const routes = createSequentialEdgeRoutes(makeTurns(3)).map((route) => ({ ...route }));
  const visible = reconcileAutoEdgeState(routes, [routes[1].id, "sequence-stale-edge"]);
  const disabled = reconcileAutoEdgeState(routes, [routes[1].id], false);

  assert.deepEqual(visible.hiddenAutoEdgeIds, [routes[1].id]);
  assert.equal(visible.visibleAutoEdges.length, 2);
  assert.deepEqual(disabled.hiddenAutoEdgeIds, [routes[1].id]);
  assert.deepEqual(disabled.visibleAutoEdges, []);
});

test("restoring a saved graph discards prior automatic topic and next edges", () => {
  const restored = filterRestoredUserEdges([
    { id: "conversation-root-turn-1", source: "conversation-root", target: "turn-1" },
    { id: "sequence-turn-1-turn-2", source: "turn-1", target: "turn-2" },
    { id: "user-custom-edge", source: "turn-1", target: "turn-2" }
  ], new Set(["conversation-root", "turn-1", "turn-2"]));

  assert.deepEqual(restored.map(({ id }) => id), ["user-custom-edge"]);
});

test("Snake layout and edges do not call topic classification", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const helperSource = await readFile(new URL("../src/side-panel/graph/graph-layout.ts", import.meta.url), "utf8");
  const layoutStart = canvasSource.indexOf("function createLayoutPositions(");
  const legacyLayoutStart = canvasSource.indexOf("function createLegacyLayoutPositions(", layoutStart);
  const edgesStart = canvasSource.indexOf("function autoEdgesFromTurns(");
  const edgesEnd = canvasSource.indexOf("function edgeHasExistingNodes(", edgesStart);
  const layoutBody = canvasSource.slice(layoutStart, legacyLayoutStart);
  const edgeBody = canvasSource.slice(edgesStart, edgesEnd);
  const sequentialBranchStart = edgeBody.indexOf('if (layoutMode === "snake")');
  const sequentialBranchEnd = edgeBody.indexOf('if (layoutMode === "list"', sequentialBranchStart);
  const sequentialBranch = edgeBody.slice(sequentialBranchStart, sequentialBranchEnd);
  const sequentialPositionStart = helperSource.indexOf("export function createSequentialLayoutPositions(");
  const sequentialEdgesStart = helperSource.indexOf("export function createSequentialEdgeRoutes(");
  const sequentialPositionsBody = helperSource.slice(sequentialPositionStart, sequentialEdgesStart);
  const sequentialEdgesBody = helperSource.slice(sequentialEdgesStart, helperSource.indexOf("export function isAutomaticEdgeId(", sequentialEdgesStart));

  assert.doesNotMatch(layoutBody, /topicPositionsFromTurns|textTokens|tokenSimilarity|explicitTopicShift/);
  assert.doesNotMatch(sequentialPositionsBody, /topicPositionsFromTurns|textTokens|tokenSimilarity|explicitTopicShift/);
  assert.doesNotMatch(sequentialEdgesBody, /topicPositionsFromTurns|textTokens|tokenSimilarity|explicitTopicShift|conversation-root-/);
  assert.ok(sequentialBranchStart >= 0, "Snake must have an explicit edge-generation branch");
  assert.ok(sequentialBranchEnd > sequentialBranchStart, "legacy layout routing must follow Snake's early branch");
  assert.match(sequentialBranch, /createSequentialEdgeRoutes\(orderedTurns, hiddenRoot, graphLayoutSettings\)/);
  assert.match(sequentialBranch, /label: "sequence"/);
  assert.doesNotMatch(
    sequentialBranch,
    /topicPositionsFromTurns|isTopicHead|legacyTopicEdgesFromTurns|userText|assistantText|label: "topic"|label: "next"/
  );
  assert.match(edgeBody, /return legacyTopicEdgesFromTurns\(orderedTurns\)/);
});

test("Rebuild calculates fresh turn positions and sequence edges from ordered turns and saved settings", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const rebuildStart = canvasSource.indexOf("const shouldRebuild =");
  const rebuildBody = canvasSource.slice(rebuildStart, canvasSource.indexOf("const nextEdges =", rebuildStart));

  assert.match(rebuildBody, /loadStoredGraph\(conversationId\)/);
  assert.match(rebuildBody, /createLayoutPositions\(orderedTurns, activeLayout, activeGraphLayoutSettings\)/);
  assert.match(rebuildBody, /resolveLayoutPositions\(/);
  assert.match(rebuildBody, /autoEdgeStateFromTurns\(\s*orderedTurns/);
  assert.match(rebuildBody, /setLayoutMode\(activeLayout\)/);
  assert.match(rebuildBody, /validUserEdges/);
  assert.match(rebuildBody, /storedCustomNodes/);
});

test("Refresh Index clears the stored graph before the canvas renders a newly indexed turn set", async () => {
  const appSource = await readFile(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");

  assert.match(appSource, /graphResetRequest=\{graphResetRequest\}/);
  assert.match(canvasSource, /graphResetRequest\?: number/);
  assert.match(canvasSource, /const shouldResetGraph = graphResetRequest > 0/);
  assert.match(canvasSource, /resetStoredGraph\(conversationId\)\.then\(\(\) => loadStoredGraph\(conversationId\)\)/);
});

test("undo and redo snapshot restoration reapply grid positions and regenerate sequence edges", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const restoreStart = canvasSource.indexOf("const restoreSnapshot = useCallback(");
  const restoreEnd = canvasSource.indexOf("const updateNodeText = useCallback(", restoreStart);
  const restoreBody = canvasSource.slice(restoreStart, restoreEnd);

  assert.match(restoreBody, /createLayoutPositions\(orderedTurns, layoutMode, graphLayoutSettings\)/);
  assert.match(restoreBody, /autoEdgeStateFromTurns\(/);
  assert.match(restoreBody, /filterRestoredUserEdges\(nextSnapshot\.edges, nodeIds\)/);
  assert.match(restoreBody, /setEdges\(restoredEdges\)/);
});

test("graph layout settings are in the existing UI settings storage", async () => {
  const storageSource = await readFile(new URL("../src/side-panel/settings/ui-settings-storage.ts", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");

  for (const key of [
    "columnsPerRow",
    "horizontalSpacing",
    "verticalSpacing",
    "arrangement",
    "showSequenceEdges"
  ]) {
    assert.match(storageSource, new RegExp(`turnmap\\.graphLayout\\.${key}`));
    assert.match(settingsSource, new RegExp(`settings\\.graphLayout\\.${key === "columnsPerRow" ? "columns" : key}`));
  }
  assert.match(storageSource, /UI_SETTINGS_STORAGE_KEYS/);
  assert.match(settingsSource, /normalizeConversationGraphLayoutSettings/);
  assert.match(settingsSource, /value=\{settings\.defaultLayout\}/);
  for (const mode of ["snake", "single", "radial", "list", "two-sided"]) {
    assert.match(settingsSource, new RegExp(`<option value="${mode}">`));
  }
  assert.match(storageSource, /turnmap\.defaultLayout/);
});
