export type ConversationGraphArrangement = "snake" | "left-to-right";

export type ConversationGraphLayoutSettings = {
  columnsPerRow: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  arrangement: ConversationGraphArrangement;
  showSequenceEdges: boolean;
};

export type GraphPosition = { x: number; y: number };

export type SequenceEdgeRoute = {
  id: string;
  sourceId: string;
  targetId: string;
  sourceHandle: string;
  targetHandle: string;
  isRootEdge: boolean;
};

export type GraphEdgeRef = {
  id: string;
  source: string;
  target: string;
};

export const DEFAULT_CONVERSATION_GRAPH_LAYOUT: Readonly<ConversationGraphLayoutSettings> = Object.freeze({
  columnsPerRow: 7,
  horizontalSpacing: 320,
  verticalSpacing: 220,
  arrangement: "snake",
  showSequenceEdges: true
});

function normalizedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

export function normalizeConversationGraphLayoutSettings(
  value: Partial<ConversationGraphLayoutSettings> | null | undefined
): ConversationGraphLayoutSettings {
  return {
    columnsPerRow: normalizedInteger(
      value?.columnsPerRow,
      DEFAULT_CONVERSATION_GRAPH_LAYOUT.columnsPerRow,
      3,
      15
    ),
    horizontalSpacing: normalizedInteger(
      value?.horizontalSpacing,
      DEFAULT_CONVERSATION_GRAPH_LAYOUT.horizontalSpacing,
      160,
      1000
    ),
    verticalSpacing: normalizedInteger(
      value?.verticalSpacing,
      DEFAULT_CONVERSATION_GRAPH_LAYOUT.verticalSpacing,
      140,
      800
    ),
    arrangement: value?.arrangement === "left-to-right" ? "left-to-right" : "snake",
    showSequenceEdges: value?.showSequenceEdges !== false
  };
}

export function sortTurnsByTurnIndex<T extends { id: string; turnIndex: number }>(turns: T[]): T[] {
  return turns
    .map((turn, originalIndex) => ({ turn, originalIndex }))
    .sort((left, right) => left.turn.turnIndex - right.turn.turnIndex || left.originalIndex - right.originalIndex)
    .map(({ turn }) => turn);
}

export function uniqueTurnsByTurnIndex<T extends { id: string; turnIndex: number }>(turns: T[]): T[] {
  const seenIds = new Set<string>();
  const seenTurnIndexes = new Set<number>();
  return sortTurnsByTurnIndex(turns).filter((turn) => {
    if (seenIds.has(turn.id) || seenTurnIndexes.has(turn.turnIndex)) return false;
    seenIds.add(turn.id);
    seenTurnIndexes.add(turn.turnIndex);
    return true;
  });
}

export const SEQUENTIAL_START_X = 380;

export function createSequentialLayoutPositions<T extends { id: string; turnIndex: number }>(
  turns: T[],
  settings: ConversationGraphLayoutSettings
): Record<string, GraphPosition> {
  const normalized = normalizeConversationGraphLayoutSettings(settings);
  const orderedTurns = uniqueTurnsByTurnIndex(turns);
  const positions: Record<string, GraphPosition> = {
    "conversation-root": { x: 0, y: 0 }
  };

  orderedTurns.forEach((turn, index) => {
    const row = Math.floor(index / normalized.columnsPerRow);
    const columnInRow = index % normalized.columnsPerRow;
    const column = normalized.arrangement === "snake" && row % 2 === 1
      ? normalized.columnsPerRow - 1 - columnInRow
      : columnInRow;
    positions[turn.id] = {
      x: SEQUENTIAL_START_X + column * normalized.horizontalSpacing,
      y: row * normalized.verticalSpacing
    };
  });

  return positions;
}

export function resolveLayoutPositions(
  computedPositions: Record<string, GraphPosition>,
  storedPositions: Record<string, GraphPosition>,
  useStoredAutoPositions: boolean
): Record<string, GraphPosition> {
  return useStoredAutoPositions
    ? { ...computedPositions, ...storedPositions }
    : { ...storedPositions, ...computedPositions };
}

export function createSequentialEdgeRoutes<T extends { id: string; turnIndex: number }>(
  turns: T[],
  hiddenRoot = false,
  settings: ConversationGraphLayoutSettings = DEFAULT_CONVERSATION_GRAPH_LAYOUT
): SequenceEdgeRoute[] {
  const normalized = normalizeConversationGraphLayoutSettings(settings);
  const orderedTurns = uniqueTurnsByTurnIndex(turns);
  if (orderedTurns.length === 0) return [];

  const routes: SequenceEdgeRoute[] = [];
  if (!hiddenRoot) {
    routes.push({
      id: `sequence-conversation-root-${orderedTurns[0].id}`,
      sourceId: "conversation-root",
      targetId: orderedTurns[0].id,
      sourceHandle: "source-right",
      targetHandle: "target-left",
      isRootEdge: true
    });
  }
  for (let index = 1; index < orderedTurns.length; index += 1) {
    const previousIndex = index - 1;
    const row = Math.floor(index / normalized.columnsPerRow);
    const previousRow = Math.floor(previousIndex / normalized.columnsPerRow);
    const sourceId = orderedTurns[index - 1].id;
    const targetId = orderedTurns[index].id;
    const sourceColumnInRow = previousIndex % normalized.columnsPerRow;
    const targetColumnInRow = index % normalized.columnsPerRow;
    const sourceColumn = normalized.arrangement === "snake" && previousRow % 2 === 1
      ? normalized.columnsPerRow - 1 - sourceColumnInRow
      : sourceColumnInRow;
    const targetColumn = normalized.arrangement === "snake" && row % 2 === 1
      ? normalized.columnsPerRow - 1 - targetColumnInRow
      : targetColumnInRow;
    const isRowTransition = row !== previousRow;
    routes.push({
      id: `sequence-${sourceId}-${targetId}`,
      sourceId,
      targetId,
      sourceHandle: isRowTransition ? "source-bottom" : sourceColumn < targetColumn ? "source-right" : "source-left",
      targetHandle: isRowTransition ? "target-top" : sourceColumn < targetColumn ? "target-left" : "target-right",
      isRootEdge: false
    });
  }
  return routes;
}

export type AutomaticEdgeKind = "auto-topic" | "auto-sequence";

export function automaticEdgeKindFromId(id: string): AutomaticEdgeKind | null {
  // Legacy topic heads used conversation-root-*; all automatic sequence edges use sequence-*.
  if (id.startsWith("conversation-root-")) return "auto-topic";
  if (id.startsWith("sequence-")) return "auto-sequence";
  return null;
}

export function isAutomaticEdgeId(id: string): boolean {
  return automaticEdgeKindFromId(id) !== null;
}

export function reconcileAutoEdgeState<T extends { id: string }>(
  generatedEdges: T[],
  hiddenAutoEdgeIds: string[],
  enabled = true
): { autoEdges: T[]; visibleAutoEdges: T[]; hiddenAutoEdgeIds: string[] } {
  const seenEdgeIds = new Set<string>();
  const autoEdges = generatedEdges.filter((edge) => {
    if (seenEdgeIds.has(edge.id)) return false;
    seenEdgeIds.add(edge.id);
    return true;
  });
  const currentEdgeIds = new Set(autoEdges.map((edge) => edge.id));
  const activeHiddenIds = [...new Set(hiddenAutoEdgeIds)].filter((id) => currentEdgeIds.has(id));
  const hiddenIds = new Set(activeHiddenIds);

  return {
    autoEdges,
    visibleAutoEdges: enabled ? autoEdges.filter((edge) => !hiddenIds.has(edge.id)) : [],
    hiddenAutoEdgeIds: activeHiddenIds
  };
}

export function filterRestoredUserEdges<T extends GraphEdgeRef>(edges: T[], nodeIds: Set<string>): T[] {
  const seenEdgeIds = new Set<string>();
  return edges.filter((edge) => {
    if (isAutomaticEdgeId(edge.id) || seenEdgeIds.has(edge.id)) return false;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
    seenEdgeIds.add(edge.id);
    return true;
  });
}
