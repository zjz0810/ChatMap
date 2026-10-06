import type { Edge, Node, XYPosition } from "@xyflow/react";
import type { SourceAnchor, Turn } from "../../shared/types.ts";
import type { AnswerExpansion } from "../ai/answer-expansion.ts";
import { sanitizeSourceAnchors, sourceAnchorsFromNodeData } from "./source-anchors.ts";
import { isNodeColorName, type NodeColorName } from "./graph-colors.ts";
import { filterRestoredUserEdges, isAutomaticEdgeId } from "./graph-layout.ts";
import type { TopicGroupRecord } from "./topic-collapse.ts";
import { summaryFromTurn, titleFromTurn } from "./summary-behavior.ts";

export type LayoutMode = "single" | "radial" | "list" | "two-sided" | "snake";
type NodeStatus = "open" | "review" | "done";
export type StoredNodeDimensions = {
  width: number;
  height: number;
  manual: boolean;
};
type StoredNodeOverride = {
  title?: string;
  summary?: string;
  status?: NodeStatus;
  tags?: string[];
  sourceAnchors?: SourceAnchor[];
  color?: NodeColorName;
  collapsed?: boolean;
  important?: boolean;
  dimensions?: StoredNodeDimensions;
  answerExpansion?: AnswerExpansion;
};

type StoredGraph = {
  schemaVersion: number;
  positions: Record<string, XYPosition>;
  userEdges: Edge[];
  nodeOverrides: Record<string, StoredNodeOverride>;
  customNodes?: Array<{
    id: string;
    position: XYPosition;
    title: string;
    summary: string;
    status?: NodeStatus;
    tags?: string[];
    sourceAnchors?: SourceAnchor[];
    color?: NodeColorName;
    collapsed?: boolean;
    important?: boolean;
    dimensions?: StoredNodeDimensions;
    answerExpansion?: AnswerExpansion;
    topicGroupId?: string;
    topicGroupMemberIds?: string[];
  }>;
  hiddenNodeIds?: string[];
  layoutMode?: LayoutMode;
  layoutSchemaVersion?: number;
  hiddenRoot?: boolean;
  hiddenAutoEdgeIds?: string[];
  topicGroups?: TopicGroupRecord[];
};

const STORAGE_PREFIX = "turnmap.graph.";
const DEFAULT_LAYOUT_KEY = "turnmap.defaultLayout";
const LAYOUT_MODE_SCHEMA_KEY = "turnmap.layoutMode.schemaVersion";
export const GRAPH_LAYOUT_SCHEMA_VERSION = 2;
const CURRENT_LAYOUT_MODE_SCHEMA_VERSION = GRAPH_LAYOUT_SCHEMA_VERSION;
const CURRENT_SCHEMA_VERSION = 5;
const pendingGraphOperations = new Map<string, Promise<void>>();

function isLayoutMode(value: unknown): value is LayoutMode {
  return value === "single" || value === "radial" || value === "list" || value === "two-sided" || value === "snake";
}

function queueGraphOperation(conversationId: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingGraphOperations.get(conversationId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  pendingGraphOperations.set(conversationId, current);
  return current.finally(() => {
    if (pendingGraphOperations.get(conversationId) === current) {
      pendingGraphOperations.delete(conversationId);
    }
  });
}

async function waitForPendingGraphOperation(conversationId: string): Promise<void> {
  await pendingGraphOperations.get(conversationId)?.catch(() => undefined);
}

function isDefaultRootSummary(summary: unknown): boolean {
  return typeof summary === "string" && /^\d+\s+mapped turns$/i.test(summary.trim());
}

function isGenericConversationRootTitle(title: unknown): boolean {
  if (typeof title !== "string") return true;
  const normalized = title.trim();
  if (!normalized) return true;
  return [
    /^ChatMap$/i,
    /^TurnMap$/i,
    /^Current AI conversation$/i,
    /^Current conversation$/i,
    /^Agents$/i,
    /^Intelligence$/i,
    /^Projects$/i,
    /^Chats$/i,
    /^Upgrade(?: to Pro)?$/i,
    /^Qwen$/i,
    /^Qwen Studio$/i,
    /^Qwen(?:\d+(?:\.\d+)*)?[-\s]*(?:Plus|Max|Turbo|Coder|VL|Omni|Instruct)$/i,
    /^通义$/i,
    /^通义千问$/i,
    /^鍗冮棶$/i,
    /^Claude$/i,
    /^智谱清言$/i,
    /^ChatGLM$/i,
    /^Z\.ai$/i,
    /^GLM$/i,
    /^Le Chat$/i,
    /^Mistral$/i,
    /^Mistral Le Chat$/i,
    /^Arena$/i,
    /^LMArena$/i,
    /^Chatbot Arena$/i,
    /^Arena AI: The Official AI Ranking & LLM Leaderboard$/i,
    /批量操作|重命名|删除对话/,
    /Official AI Ranking/i,
    /LLM Leaderboard/i
  ].some((pattern) => pattern.test(normalized));
}

function storageKey(conversationId: string): string {
  return `${STORAGE_PREFIX}${conversationId}`;
}

function nodeStatus(value: unknown): NodeStatus | undefined {
  return value === "open" || value === "review" || value === "done" ? value : undefined;
}

function turnFromNode(node: Node): Turn | undefined {
  const turn = node.data?.turn as Turn | undefined;
  return turn && typeof turn.userText === "string" && typeof turn.assistantText === "string" ? turn : undefined;
}

function isGeneratedTurnTitle(node: Node): boolean {
  const turn = turnFromNode(node);
  return Boolean(turn && node.data?.title === titleFromTurn(turn));
}

function isGeneratedTurnSummary(node: Node): boolean {
  const turn = turnFromNode(node);
  return Boolean(turn && node.data?.summary === summaryFromTurn(turn));
}

function storedDimensions(value: unknown): StoredNodeDimensions | undefined {
  const dimensions = value as Partial<StoredNodeDimensions> | undefined;
  if (
    !dimensions ||
    typeof dimensions.width !== "number" ||
    typeof dimensions.height !== "number" ||
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height)
  ) {
    return undefined;
  }
  return {
    width: Math.max(1, Math.round(dimensions.width)),
    height: Math.max(1, Math.round(dimensions.height)),
    manual: Boolean(dimensions.manual)
  };
}

function storedAnswerExpansion(value: unknown): AnswerExpansion | undefined {
  const expansion = value as AnswerExpansion | undefined;
  if (
    !expansion ||
    expansion.schemaVersion !== 2 ||
    (expansion.displayMode !== "expanded" && expansion.displayMode !== "original") ||
    (expansion.layoutDirection !== "left" && expansion.layoutDirection !== "right") ||
    !Array.isArray(expansion.nodes) ||
    expansion.nodes.length < 1
  ) {
    return undefined;
  }
  return expansion;
}

function storedTopicGroups(value: unknown): TopicGroupRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((group): group is TopicGroupRecord => {
    const candidate = group as TopicGroupRecord;
    return (
      typeof candidate?.id === "string" &&
      typeof candidate.topicNodeId === "string" &&
      typeof candidate.title === "string" &&
      Array.isArray(candidate.memberNodeIds) &&
      Array.isArray(candidate.nodeSnapshots) &&
      Array.isArray(candidate.edgeSnapshots)
    );
  });
}

export async function loadStoredGraph(conversationId: string): Promise<StoredGraph> {
  await waitForPendingGraphOperation(conversationId);
  const result = await chrome.storage.local.get(storageKey(conversationId));
  const value = result[storageKey(conversationId)] as StoredGraph | undefined;

  return {
    schemaVersion: value?.schemaVersion ?? 0,
    positions: value?.positions ?? {},
    userEdges: (value?.userEdges ?? []).filter((edge) => !isAutomaticEdgeId(edge.id)),
    nodeOverrides: Object.fromEntries(
      Object.entries(value?.nodeOverrides ?? {}).map(([nodeId, override]) => [
        nodeId,
        {
          ...override,
          sourceAnchors: sanitizeSourceAnchors(override?.sourceAnchors),
          dimensions: storedDimensions(override?.dimensions),
          answerExpansion: storedAnswerExpansion(override?.answerExpansion)
        }
      ])
    ),
    customNodes:
      value?.customNodes?.map((node) => ({
        ...node,
        sourceAnchors: sanitizeSourceAnchors(node.sourceAnchors),
        dimensions: storedDimensions(node.dimensions),
        answerExpansion: storedAnswerExpansion(node.answerExpansion),
        topicGroupId: typeof node.topicGroupId === "string" ? node.topicGroupId : undefined,
        topicGroupMemberIds: Array.isArray(node.topicGroupMemberIds)
          ? node.topicGroupMemberIds.filter((nodeId) => typeof nodeId === "string")
          : undefined
      })) ?? [],
    hiddenNodeIds: value?.hiddenNodeIds ?? [],
    layoutMode: value?.layoutMode,
    layoutSchemaVersion: value?.layoutSchemaVersion,
    hiddenRoot: value?.hiddenRoot ?? false,
    hiddenAutoEdgeIds: value?.hiddenAutoEdgeIds ?? [],
    topicGroups: storedTopicGroups(value?.topicGroups)
  };
}

export async function saveStoredGraph(
  conversationId: string,
  nodes: Node[],
  userEdges: Edge[],
  layoutMode?: LayoutMode,
  hiddenRoot = false,
  hiddenAutoEdgeIds: string[] = [],
  hiddenNodeIds: string[] = [],
  topicGroups: TopicGroupRecord[] = []
): Promise<void> {
  const positions = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
  const nodeOverrides = Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        title:
          node.id === "conversation-root" && isGenericConversationRootTitle(node.data?.title)
            ? undefined
            : isGeneratedTurnTitle(node)
              ? undefined
            : typeof node.data?.title === "string"
              ? node.data.title
              : undefined,
        summary:
          node.id === "conversation-root" && isDefaultRootSummary(node.data?.summary)
            ? undefined
            : isGeneratedTurnSummary(node)
              ? undefined
            : typeof node.data?.summary === "string"
              ? node.data.summary
              : undefined,
        status: nodeStatus(node.data?.status),
        tags: Array.isArray(node.data?.tags) ? node.data.tags.filter((tag) => typeof tag === "string") : undefined,
        sourceAnchors: sourceAnchorsFromNodeData(node.data ?? {}),
        color: isNodeColorName(node.data?.color) ? node.data.color : undefined,
        collapsed: typeof node.data?.collapsed === "boolean" ? node.data.collapsed : undefined,
        important: typeof node.data?.important === "boolean" ? node.data.important : undefined,
        dimensions: storedDimensions(node.data?.dimensions),
        answerExpansion: storedAnswerExpansion(node.data?.answerExpansion)
      }
    ])
  );
  const customNodes = nodes
    .filter((node) => node.id !== "conversation-root" && !node.data?.turn)
    .map((node) => ({
      id: node.id,
      position: node.position,
      title: typeof node.data?.title === "string" ? node.data.title : node.id,
      summary: typeof node.data?.summary === "string" ? node.data.summary : "",
      status: nodeStatus(node.data?.status),
      tags: Array.isArray(node.data?.tags) ? node.data.tags.filter((tag) => typeof tag === "string") : undefined,
      sourceAnchors: sourceAnchorsFromNodeData(node.data ?? {}),
      color: isNodeColorName(node.data?.color) ? node.data.color : undefined,
      collapsed: typeof node.data?.collapsed === "boolean" ? node.data.collapsed : undefined,
      important: typeof node.data?.important === "boolean" ? node.data.important : undefined,
      dimensions: storedDimensions(node.data?.dimensions),
      answerExpansion: storedAnswerExpansion(node.data?.answerExpansion),
      topicGroupId: typeof node.data?.topicGroupId === "string" ? node.data.topicGroupId : undefined,
      topicGroupMemberIds: Array.isArray(node.data?.topicGroupMemberIds)
        ? node.data.topicGroupMemberIds.filter((nodeId) => typeof nodeId === "string")
        : undefined
    }));
  const storedUserEdges = filterRestoredUserEdges(userEdges, new Set(nodes.map((node) => node.id)));

  await queueGraphOperation(conversationId, () =>
    chrome.storage.local.set({
      [storageKey(conversationId)]: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        positions,
        userEdges: storedUserEdges,
        nodeOverrides,
        customNodes,
        hiddenNodeIds,
        layoutMode,
        layoutSchemaVersion: GRAPH_LAYOUT_SCHEMA_VERSION,
        hiddenRoot,
        hiddenAutoEdgeIds,
        topicGroups: storedTopicGroups(topicGroups)
      } satisfies StoredGraph
    })
  );
}

export async function resetStoredGraph(conversationId: string): Promise<void> {
  await queueGraphOperation(conversationId, () => chrome.storage.local.remove(storageKey(conversationId)));
}

export async function loadDefaultLayout(): Promise<LayoutMode> {
  const result = await chrome.storage.local.get([DEFAULT_LAYOUT_KEY, LAYOUT_MODE_SCHEMA_KEY]);
  const value = result[DEFAULT_LAYOUT_KEY];
  const storedVersion = typeof result[LAYOUT_MODE_SCHEMA_KEY] === "number" ? result[LAYOUT_MODE_SCHEMA_KEY] : 0;
  const knownLayout = isLayoutMode(value);
  const migratedLayout: LayoutMode = !knownLayout
    ? "snake"
    : storedVersion < CURRENT_LAYOUT_MODE_SCHEMA_VERSION && value === "single"
      ? "snake"
      : value;
  if (storedVersion < CURRENT_LAYOUT_MODE_SCHEMA_VERSION || !knownLayout) {
    await chrome.storage.local.set({
      [DEFAULT_LAYOUT_KEY]: migratedLayout,
      [LAYOUT_MODE_SCHEMA_KEY]: CURRENT_LAYOUT_MODE_SCHEMA_VERSION
    });
  }
  return migratedLayout;
}

export async function saveDefaultLayout(layoutMode: LayoutMode): Promise<void> {
  await chrome.storage.local.set({
    [DEFAULT_LAYOUT_KEY]: layoutMode,
    [LAYOUT_MODE_SCHEMA_KEY]: CURRENT_LAYOUT_MODE_SCHEMA_VERSION
  });
}
