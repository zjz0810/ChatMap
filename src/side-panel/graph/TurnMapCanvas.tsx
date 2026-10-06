import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type ReactFlowInstance
} from "@xyflow/react";
import type { SourceAnchor, Turn } from "../../shared/types.ts";
import { jumpToTurnInActiveTab } from "../../shared/messaging";
import {
  calculateMiniMapLayout,
  deleteMiniNode,
  renderableMiniLinks,
  type AnswerExpansionProgressStage,
  expandTurnAnswer,
  miniNodeDescendantIds,
  updateMiniNode,
  type AnswerExpansion,
  type AnswerMiniNode,
  type MiniMapLayoutDirection
} from "../ai/answer-expansion";
import { suggestSemanticEdges } from "../ai/link-suggestions";
import { summarizeTurn, summarizeTurns } from "../ai/node-summary";
import { buildTopicCandidatePairs } from "../ai/topic-analysis";
import { Icon } from "../components/Icon";
import {
  createSequentialEdgeRoutes,
  createSequentialLayoutPositions,
  DEFAULT_CONVERSATION_GRAPH_LAYOUT,
  filterRestoredUserEdges,
  isAutomaticEdgeId,
  reconcileAutoEdgeState,
  resolveLayoutPositions,
  sortTurnsByTurnIndex,
  uniqueTurnsByTurnIndex,
  type ConversationGraphLayoutSettings
} from "./graph-layout.ts";
import type { I18nKey } from "../../localization/index.ts";
import { useI18n } from "../i18n/useI18n";
import { loadAiSettings } from "../settings/ai-settings-storage";
import { applyTheme, normalizeTheme, resolveTheme, type ThemeMode } from "../settings/theme-storage";
import {
  applyNodeColorRendering,
  DEFAULT_NODE_SIZE_SETTINGS,
  loadUiSettings,
  saveUiSettings,
  UI_SETTINGS_STORAGE_KEYS,
  type DefaultNodeSizeSettings,
  type LinkConnectionStyle,
  type NodeColorRenderMode,
  type UiSettings
} from "../settings/ui-settings-storage";
import type { ApiTaskKind, ApiTaskStatus } from "../task-log";
import { TurnNode } from "./TurnNode";
import {
  GRAPH_LAYOUT_SCHEMA_VERSION,
  loadStoredGraph,
  resetStoredGraph,
  saveStoredGraph,
  type LayoutMode
} from "./graph-storage";
import {
  createZipFromTextFiles,
  graphToObsidianVaultMarkdownFiles,
  graphToOpml,
  type ExportAppearance,
  type ExportEdge,
  type ExportNode
} from "./export-formats";
import {
  NODE_COLOR_OPTIONS,
  colorForRelationship,
  colorValue,
  isNodeColorName,
  type NodeColorName
} from "./graph-colors";
import {
  DEFAULT_AI_EDGE_WEIGHT,
  DEFAULT_AUTO_TOPIC_EDGE_WEIGHT,
  DEFAULT_AUTO_SEQUENCE_EDGE_WEIGHT,
  DEFAULT_TOPIC_ANALYSIS_EDGE_WEIGHT,
  DEFAULT_TOPIC_PROXY_EDGE_WEIGHT,
  DEFAULT_USER_EDGE_WEIGHT,
  edgeStrokeOpacity,
  edgeStrokeWidth,
  normalizeEdgeWeight,
  weightFromConfidence,
  weightPercent
} from "./edge-weight";
import { graphIssuesSummary, repairGraphSnapshot, type GraphIssue } from "./graph-health";
import {
  cloneGraphDocument as cloneSnapshot,
  graphDocumentKey as snapshotKey,
  type GraphDocumentSnapshot as GraphSnapshot,
  type TurnNodeData
} from "./graph-document.ts";
import {
  mergeSourceAnchors,
  normalizeNodeTags,
  resolveSourceTurnsForAnchors,
  sanitizeSourceAnchors,
  sourceAnchorMatches,
  sourceAnchorsFromNodeData
} from "./source-anchors.ts";
import {
  applyProtectedTurnSummary,
  canSummarizeAiNote,
  hasSummarizableTurnField,
  summaryFromTurn,
  titleFromTurn
} from "./summary-behavior.ts";
import {
  buildCollapsedTopic,
  buildTopicGroupRecord,
  buildTopicProxyEdges,
  topicGroupHasNestedSelection,
  type TopicGroupRecord
} from "./topic-collapse";

type TurnMapCanvasProps = {
  conversationId: string;
  conversationTitle: string;
  turns: Turn[];
  turnUpdateMode?: "replace" | "refresh" | "refresh-index";
  sourceTabId?: number;
  rebuildRequest?: number;
  graphResetRequest?: number;
  onStatus?: (status: string) => void;
  onTaskStatus?: (entry: {
    id: string;
    kind: ApiTaskKind;
    status: ApiTaskStatus;
    message: string;
    progress: number;
  }) => void | Promise<void>;
};

type CustomNodeRecord = {
  id: string;
  position: { x: number; y: number };
  title: string;
  summary: string;
  status?: "open" | "review" | "done";
  tags?: string[];
  sourceAnchors?: SourceAnchor[];
  color?: NodeColorName;
  collapsed?: boolean;
  important?: boolean;
  dimensions?: { width: number; height: number; manual: boolean };
  answerExpansion?: AnswerExpansion;
  topicGroupId?: string;
  topicGroupMemberIds?: string[];
};

type EdgeRelationship =
  | "related"
  | "depends_on"
  | "extends"
  | "supports"
  | "contradicts"
  | "duplicates"
  | "references"
  | "todo";

type RelationshipEdgeData = {
  relationship: EdgeRelationship;
  important?: boolean;
  weight?: number;
  confidence?: number;
  reason?: string;
  createdBy?: "ai" | "user" | "topic-analysis";
  originalEdgeId?: string;
  proxyKind?: "incoming" | "outgoing";
  topicGroupId?: string;
};

type ExportedGraph = {
  schemaVersion?: number;
  conversation?: {
    id?: string;
    title?: string;
  };
  layout?: {
    mode?: LayoutMode;
    hiddenRoot?: boolean;
    hiddenAutoEdgeIds?: string[];
    hiddenNodeIds?: string[];
    topicGroups?: TopicGroupRecord[];
  };
  appearance?: ExportAppearance;
  nodes?: Array<{
    id?: string;
    position?: { x?: number; y?: number };
    title?: string;
    summary?: string;
    status?: "open" | "review" | "done";
    tags?: string[];
    sourceAnchors?: SourceAnchor[];
    color?: NodeColorName;
    collapsed?: boolean;
    important?: boolean;
    dimensions?: { width: number; height: number; manual: boolean };
    answerExpansion?: AnswerExpansion;
    topicGroupId?: string;
    topicGroupMemberIds?: string[];
    turnId?: string;
    isConversationRoot?: boolean;
  }>;
  edges?: Array<{
    id?: string;
    source?: string;
    target?: string;
    label?: unknown;
    relationship?: EdgeRelationship;
    important?: boolean;
    weight?: number;
    confidence?: number;
    reason?: string;
    createdBy?: "ai" | "user" | "topic-analysis";
    originalEdgeId?: string;
    proxyKind?: "incoming" | "outgoing";
    topicGroupId?: string;
    isAuto?: boolean;
  }>;
};

type GraphAppearance = {
  theme: ThemeMode;
  resolvedTheme: Exclude<ThemeMode, "browser">;
  nodeColorRendering: {
    mode: NodeColorRenderMode;
    strength: number;
  };
};

const nodeTypes = {
  turnNode: TurnNode
};

let activeLinkConnectionStyle: LinkConnectionStyle = "curved";

function edgeTypeForLinkConnectionStyle(style: LinkConnectionStyle): Edge["type"] {
  return style === "angled" ? "smoothstep" : "default";
}

function nodeDimensionsStyle(
  dimensions: { width: number; height: number; manual: boolean } | undefined,
  fallback: { width: number; height: number }
): { width: number; height: number } {
  return {
    width: dimensions?.width ?? fallback.width,
    height: dimensions?.height ?? fallback.height
  };
}

function estimateWrappedLineCount(text: string | undefined, charsPerLine: number, maxLines = 40): number {
  const clean = (text ?? "").trim();
  if (!clean) return 1;
  const lines = clean.split(/\r?\n/).flatMap((line) => {
    const length = Math.max(1, line.trim().length);
    return Array.from({ length: Math.ceil(length / Math.max(8, charsPerLine)) });
  });
  return Math.max(1, Math.min(maxLines, lines.length));
}

function tagRowCount(tags: string[] | undefined, width: number): number {
  if (!tags?.length) return 0;
  const capacity = Math.max(1, Math.floor((width - 32) / 78));
  return Math.ceil(tags.length / capacity);
}

function displayLineBudget(settings: DefaultNodeSizeSettings): { titleLines: number; summaryLines: number } {
  const totalLines = Math.max(2, Math.round((settings.defaultNodeHeight - 62) / 18));
  const titleLines = Math.round(totalLines * settings.defaultNodePromptRatio);
  return {
    titleLines,
    summaryLines: Math.max(0, totalLines - titleLines)
  };
}

function withDefaultNodeDisplayLines(data: TurnNodeData, settings: DefaultNodeSizeSettings): TurnNodeData {
  const lineBudget = displayLineBudget(settings);
  return {
    ...data,
    titleLineClamp: lineBudget.titleLines,
    summaryLineClamp: lineBudget.summaryLines
  };
}

function sameDefaultNodeSizeSettings(a: DefaultNodeSizeSettings, b: DefaultNodeSizeSettings): boolean {
  return (
    a.defaultNodeWidth === b.defaultNodeWidth &&
    a.defaultNodeHeight === b.defaultNodeHeight &&
    a.defaultNodePromptRatio === b.defaultNodePromptRatio
  );
}

function originalContentDimensions(
  node: Node<TurnNodeData>,
  settings: DefaultNodeSizeSettings = DEFAULT_NODE_SIZE_SETTINGS
): { width: number; height: number; manual: boolean } {
  const titleLength = node.data.title.trim().length;
  const summaryLength = node.data.summary.trim().length;
  const width = Math.max(
    node.data.isConversationRoot ? Math.max(300, settings.defaultNodeWidth) : settings.defaultNodeWidth,
    Math.min(680, settings.defaultNodeWidth + Math.round(Math.sqrt(Math.max(titleLength * 8, summaryLength)) * 18))
  );
  const charsPerLine = Math.max(18, Math.floor((width - 32) / 7));
  const lineBudget = displayLineBudget(settings);
  const titleLines = lineBudget.titleLines === 0 ? 0 : estimateWrappedLineCount(node.data.title, charsPerLine, lineBudget.titleLines);
  const summaryLines =
    lineBudget.summaryLines === 0 ? 0 : estimateWrappedLineCount(node.data.summary, charsPerLine, lineBudget.summaryLines);
  const badgeRows = tagRowCount(node.data.tags, width);
  const height = Math.max(
    node.data.isConversationRoot ? Math.max(160, settings.defaultNodeHeight) : settings.defaultNodeHeight,
    Math.min(980, 62 + titleLines * 20 + summaryLines * 18 + badgeRows * 28)
  );
  return { width, height, manual: false };
}

function compactCollapsedDimensions(node: Node<TurnNodeData>): { width: number; height: number; manual: boolean } {
  const titleWidth = 170 + Math.min(260, Math.round(node.data.title.trim().length * 6.8));
  const rawWidth = Number(node.style?.width ?? node.data.dimensions?.width ?? titleWidth);
  const defaultWidth = Math.max(node.data.isConversationRoot ? 260 : 240, Math.min(560, Math.max(titleWidth, Math.round(rawWidth))));
  const compactWidth = Math.max(node.data.isConversationRoot ? 182 : 168, Math.round(defaultWidth * 0.7));
  const badgeRows = tagRowCount(node.data.tags, compactWidth);
  return {
    width: compactWidth,
    height: Math.max(120, 94 + badgeRows * 26),
    manual: false
  };
}

function isAutoCollapsedDimensions(dimensions: TurnNodeData["dimensions"]): boolean {
  return Boolean(dimensions && !dimensions.manual);
}

function expandedContentDimensions(expansion: AnswerExpansion): { width: number; height: number; manual: boolean } {
  const miniLayout = calculateMiniMapLayout(expansion);
  return {
    width: Math.max(500, Math.min(2200, miniLayout.width + 32)),
    height: Math.max(320, Math.min(3200, miniLayout.height + 132)),
    manual: false
  };
}

function contentFittingDimensions(
  node: Node<TurnNodeData>,
  settings: DefaultNodeSizeSettings = DEFAULT_NODE_SIZE_SETTINGS
): { width: number; height: number; manual: boolean } {
  if (node.data.collapsed) return compactCollapsedDimensions(node);
  if (node.data.answerExpansion?.displayMode === "expanded") return expandedContentDimensions(node.data.answerExpansion);
  return originalContentDimensions(node, settings);
}

function withContentFittingDimensions(
  node: Node<TurnNodeData>,
  data: TurnNodeData,
  settings: DefaultNodeSizeSettings = DEFAULT_NODE_SIZE_SETTINGS
): Node<TurnNodeData> {
  const draftNode = { ...node, data: withDefaultNodeDisplayLines(data, settings) };
  const dimensions = contentFittingDimensions(draftNode, settings);
  return {
    ...draftNode,
    style: {
      ...node.style,
      width: dimensions.width,
      height: dimensions.height
    },
    data: {
      ...data,
      dimensions
    }
  };
}

function withInitialContentFittingDimensions(
  node: Node<TurnNodeData>,
  settings: DefaultNodeSizeSettings = DEFAULT_NODE_SIZE_SETTINGS
): Node<TurnNodeData> {
  const nodeWithDisplayLines = {
    ...node,
    data: withDefaultNodeDisplayLines(node.data, settings)
  };
  if (nodeWithDisplayLines.data.dimensions) return nodeWithDisplayLines;
  return withContentFittingDimensions(nodeWithDisplayLines, nodeWithDisplayLines.data, settings);
}

function edgeDisplayColor(color: string): string {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return color;
  const value = match[1];
  const darken = (component: string) =>
    Math.max(0, Math.min(255, Math.round(Number.parseInt(component, 16) / 1.5)))
      .toString(16)
      .padStart(2, "0");
  return `#${darken(value.slice(0, 2))}${darken(value.slice(2, 4))}${darken(value.slice(4, 6))}`;
}

const RELATIONSHIP_OPTIONS: Array<{ value: EdgeRelationship; label: string }> = [
  { value: "related", label: "Related" },
  { value: "depends_on", label: "Depends on" },
  { value: "extends", label: "Extends" },
  { value: "supports", label: "Supports" },
  { value: "contradicts", label: "Contradicts" },
  { value: "duplicates", label: "Duplicates" },
  { value: "references", label: "References" },
  { value: "todo", label: "Todo" }
];

const RELATIONSHIP_LABEL_KEYS = {
  related: "relationship.related",
  depends_on: "relationship.dependsOn",
  extends: "relationship.extends",
  supports: "relationship.supports",
  contradicts: "relationship.contradicts",
  duplicates: "relationship.duplicates",
  references: "relationship.references",
  todo: "relationship.todo"
} satisfies Record<EdgeRelationship, I18nKey>;

function isDefaultRootSummary(summary?: string): boolean {
  return Boolean(summary?.trim().match(/^\d+\s+mapped turns$/i));
}

function isGenericConversationRootTitle(title?: string): boolean {
  const normalized = title?.trim();
  if (!normalized) return true;
  return [
    /^(?:ChatMap|TurnMap)$/i,
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
    /^千问$/i,
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

function rootTitleFromOverride(overrideTitle: string | undefined, conversationTitle: string): string {
  return overrideTitle && !isGenericConversationRootTitle(overrideTitle) ? overrideTitle : conversationTitle;
}

type TopicPosition = {
  topicIndex: number;
  depth: number;
  isTopicHead: boolean;
};

function textTokens(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []) {
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

function tokenSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) overlap += 1;
  });
  return overlap / Math.min(left.size, right.size);
}

function explicitTopicShift(text: string): boolean {
  return /另(一|个|起)|新话题|换个话题|另说|接下来.*(话题|部分|板块)|another topic|new topic|separate topic/i.test(
    text
  );
}

function topicPositionsFromTurns(turns: Turn[]): Record<string, TopicPosition> {
  const positions: Record<string, TopicPosition> = {};
  let topicIndex = -1;
  let depth = 0;
  let previousTokens = new Set<string>();

  turns.forEach((turn, index) => {
    const currentTokens = textTokens(`${turn.userText}\n${turn.assistantText.slice(0, 360)}`);
    const similarity = tokenSimilarity(previousTokens, currentTokens);
    const startsNewTopic =
      index === 0 ||
      explicitTopicShift(turn.userText) ||
      (currentTokens.size >= 4 && previousTokens.size >= 4 && similarity < 0.08);

    if (startsNewTopic) {
      topicIndex += 1;
      depth = 0;
    } else {
      depth += 1;
    }

    positions[turn.id] = {
      topicIndex,
      depth,
      isTopicHead: startsNewTopic
    };
    previousTokens = currentTokens;
  });

  return positions;
}

function nodesFromTurns(
  conversationTitle: string,
  turns: Turn[],
  positions: Record<string, { x: number; y: number }>,
  nodeOverrides: Record<
    string,
    {
      title?: string;
      summary?: string;
      status?: "open" | "review" | "done";
      tags?: string[];
      sourceAnchors?: SourceAnchor[];
      color?: NodeColorName;
      collapsed?: boolean;
      important?: boolean;
      dimensions?: { width: number; height: number; manual: boolean };
      answerExpansion?: AnswerExpansion;
      topicGroupId?: string;
      topicGroupMemberIds?: string[];
    }
  >,
  onUpdate: TurnNodeData["onUpdate"],
  onSummarize: TurnNodeData["onSummarize"],
  onJump: TurnNodeData["onJump"],
  summarizingNodeIds: Set<string>,
  hiddenNodeIds: string[],
  customNodes: CustomNodeRecord[],
  hiddenRoot: boolean,
  layoutMode: LayoutMode,
  nodeSizeSettings: DefaultNodeSizeSettings = DEFAULT_NODE_SIZE_SETTINGS,
  graphLayoutSettings: ConversationGraphLayoutSettings = DEFAULT_CONVERSATION_GRAPH_LAYOUT
): Node<TurnNodeData>[] {
  const layoutPositions = createLayoutPositions(turns, layoutMode, graphLayoutSettings);
  const rootOverride = nodeOverrides["conversation-root"];
  const rootTitle = rootTitleFromOverride(rootOverride?.title, conversationTitle);
  const rootNode: Node<TurnNodeData> = withInitialContentFittingDimensions({
    id: "conversation-root",
    type: "turnNode",
    draggable: layoutMode === "snake" ? false : undefined,
    dragHandle: ".turn-node__drag-handle",
    position: positions["conversation-root"] ?? layoutPositions["conversation-root"],
    style: nodeDimensionsStyle(rootOverride?.dimensions, {
      width: Math.max(300, nodeSizeSettings.defaultNodeWidth),
      height: Math.max(180, nodeSizeSettings.defaultNodeHeight)
    }),
    data: {
      title: rootTitle,
      summary:
        rootOverride?.summary && !isDefaultRootSummary(rootOverride.summary)
          ? rootOverride.summary
          : `${turns.length} mapped turns`,
      status: rootOverride?.status,
      tags: normalizeNodeTags(rootOverride?.tags),
      color: rootOverride?.color,
      collapsed: rootOverride?.collapsed ?? true,
      important: rootOverride?.important,
      dimensions: rootOverride?.dimensions,
      answerExpansion: rootOverride?.answerExpansion,
      isConversationRoot: true,
      onUpdate
    }
  }, nodeSizeSettings);

  const hiddenNodeIdSet = new Set(hiddenNodeIds);
  const turnNodes = turns.filter((turn) => !hiddenNodeIdSet.has(turn.id)).map((turn, index) =>
    withInitialContentFittingDimensions({
      id: turn.id,
      type: "turnNode",
      draggable: layoutMode === "snake" ? false : undefined,
      dragHandle: ".turn-node__drag-handle",
      position: positions[turn.id] ?? layoutPositions[turn.id] ?? { x: 360, y: index * 190 },
      style: nodeDimensionsStyle(nodeOverrides[turn.id]?.dimensions, {
        width: nodeSizeSettings.defaultNodeWidth,
        height: nodeSizeSettings.defaultNodeHeight
      }),
      data: {
        title: nodeOverrides[turn.id]?.title ?? titleFromTurn(turn),
        summary: nodeOverrides[turn.id]?.summary ?? summaryFromTurn(turn),
        status: nodeOverrides[turn.id]?.status,
        tags: normalizeNodeTags(nodeOverrides[turn.id]?.tags),
        color: nodeOverrides[turn.id]?.color,
        collapsed: nodeOverrides[turn.id]?.collapsed ?? true,
        important: nodeOverrides[turn.id]?.important,
        dimensions: nodeOverrides[turn.id]?.dimensions,
        answerExpansion: nodeOverrides[turn.id]?.answerExpansion,
        topicGroupId: nodeOverrides[turn.id]?.topicGroupId,
        topicGroupMemberIds: nodeOverrides[turn.id]?.topicGroupMemberIds,
        sourceAnchors: sanitizeSourceAnchors(nodeOverrides[turn.id]?.sourceAnchors ?? [turn.sourceAnchor]),
        turn,
        onUpdate,
        onSummarize,
        onJump,
        isSummarizing: summarizingNodeIds.has(turn.id)
      }
    }, nodeSizeSettings)
  );
  const extraNodes: Node<TurnNodeData>[] = customNodes.map((node) =>
    withInitialContentFittingDimensions({
      id: node.id,
      type: "turnNode",
      dragHandle: ".turn-node__drag-handle",
      position: positions[node.id] ?? node.position,
      style: nodeDimensionsStyle(nodeOverrides[node.id]?.dimensions ?? node.dimensions, {
        width: nodeSizeSettings.defaultNodeWidth,
        height: nodeSizeSettings.defaultNodeHeight
      }),
      data: {
        title: nodeOverrides[node.id]?.title ?? node.title,
        summary: nodeOverrides[node.id]?.summary ?? node.summary,
        status: nodeOverrides[node.id]?.status ?? node.status,
        tags: normalizeNodeTags(nodeOverrides[node.id]?.tags ?? node.tags),
        sourceAnchors: sanitizeSourceAnchors(nodeOverrides[node.id]?.sourceAnchors ?? node.sourceAnchors),
        color: nodeOverrides[node.id]?.color ?? node.color,
        collapsed: nodeOverrides[node.id]?.collapsed ?? node.collapsed ?? true,
        important: nodeOverrides[node.id]?.important ?? node.important,
        dimensions: nodeOverrides[node.id]?.dimensions ?? node.dimensions,
        answerExpansion: nodeOverrides[node.id]?.answerExpansion ?? node.answerExpansion,
        topicGroupId: nodeOverrides[node.id]?.topicGroupId ?? node.topicGroupId,
        topicGroupMemberIds: nodeOverrides[node.id]?.topicGroupMemberIds ?? node.topicGroupMemberIds,
        isCustomNode: true,
        onUpdate
      }
    }, nodeSizeSettings)
  );

  const mapNodes = [...turnNodes, ...extraNodes];
  return hiddenRoot ? mapNodes : [rootNode, ...mapNodes];
}

function createLayoutPositions(
  turns: Turn[],
  layoutMode: LayoutMode,
  graphLayoutSettings: ConversationGraphLayoutSettings
): Record<string, { x: number; y: number }> {
  if (layoutMode === "snake") {
    return createSequentialLayoutPositions(sortTurnsByTurnIndex(turns), graphLayoutSettings);
  }
  return createLegacyLayoutPositions(turns, layoutMode);
}

function createLegacyLayoutPositions(
  turns: Turn[],
  layoutMode: Exclude<LayoutMode, "snake">
): Record<string, { x: number; y: number }> {
  const topicPositions = topicPositionsFromTurns(turns);
  const topicCount = Math.max(1, ...Object.values(topicPositions).map((position) => position.topicIndex + 1));
  const positions: Record<string, { x: number; y: number }> = { "conversation-root": { x: 0, y: 0 } };

  turns.forEach((turn, index) => {
    if (layoutMode === "list") {
      const column = index % 3;
      const row = Math.floor(index / 3);
      positions[turn.id] = { x: column * 320, y: row * 210 };
      return;
    }
    if (layoutMode === "two-sided") {
      const side = index % 2 === 0 ? 1 : -1;
      const row = Math.floor(index / 2);
      positions[turn.id] = { x: side * 380, y: row * 190 - Math.max(0, turns.length / 4) * 190 };
      return;
    }
    if (layoutMode === "radial") {
      const angle = turns.length <= 1 ? 0 : (index / turns.length) * Math.PI * 2;
      const radius = 420 + Math.floor(index / 12) * 180;
      positions[turn.id] = { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
      return;
    }
    positions[turn.id] = {
      x: 360 + (topicPositions[turn.id]?.depth ?? index) * 340,
      y: ((topicPositions[turn.id]?.topicIndex ?? 0) - (topicCount - 1) / 2) * 260
    };
  });

  return positions;
}

function autoEdgeStateFromTurns(
  turns: Turn[],
  layoutMode: LayoutMode,
  hiddenRoot: boolean,
  hiddenAutoEdgeIds: string[],
  graphLayoutSettings: ConversationGraphLayoutSettings
): ReturnType<typeof reconcileAutoEdgeState<Edge>> {
  const generatedEdges = autoEdgesFromTurns(turns, layoutMode, hiddenRoot, graphLayoutSettings);
  const autoEdgesEnabled = layoutMode === "snake" ? graphLayoutSettings.showSequenceEdges : true;
  return reconcileAutoEdgeState(generatedEdges, hiddenAutoEdgeIds, autoEdgesEnabled);
}

function legacyTopicEdgesFromTurns(turns: Turn[]): Edge[] {
  const topicPositions = topicPositionsFromTurns(turns);
  return turns.map((turn, index) => {
    const isTopicHead = topicPositions[turn.id]?.isTopicHead ?? index === 0;
    const previousTurn = turns[index - 1];
    const relationship: EdgeRelationship = isTopicHead ? "references" : "extends";
    return {
      id: isTopicHead ? `conversation-root-${turn.id}` : `sequence-${previousTurn.id}-${turn.id}`,
      source: isTopicHead ? "conversation-root" : previousTurn.id,
      target: turn.id,
      label: isTopicHead ? "topic" : "next",
      data: {
        relationship,
        weight: isTopicHead ? DEFAULT_AUTO_TOPIC_EDGE_WEIGHT : DEFAULT_AUTO_SEQUENCE_EDGE_WEIGHT
      } satisfies RelationshipEdgeData,
      style: relationshipStyle(relationship)
    };
  });
}

function autoEdgesFromTurns(
  turns: Turn[],
  layoutMode: LayoutMode,
  hiddenRoot: boolean,
  graphLayoutSettings: ConversationGraphLayoutSettings
): Edge[] {
  const orderedTurns = sortTurnsByTurnIndex(turns);

  // Snake is deliberately an independent path: topic classification is not consulted here.
  if (layoutMode === "snake") {
    return createSequentialEdgeRoutes(orderedTurns, hiddenRoot, graphLayoutSettings).map(
      ({ id, sourceId, targetId, sourceHandle, targetHandle }) => ({
        id,
        source: sourceId,
        target: targetId,
        sourceHandle,
        targetHandle,
        type: "smoothstep" as const,
        label: "sequence",
        data: {
          relationship: "extends",
          weight: DEFAULT_AUTO_SEQUENCE_EDGE_WEIGHT
        } satisfies RelationshipEdgeData,
        style: relationshipStyle("extends")
      })
    );
  }

  if (layoutMode === "list" || hiddenRoot) return [];
  return legacyTopicEdgesFromTurns(orderedTurns);
}

function edgeHasExistingNodes(edge: Edge, nodeIds: Set<string>): boolean {
  return Boolean(edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

function turnHashesFromNodeId(nodeId: string): { userHash: string; assistantHash: string } | null {
  const match = nodeId.match(/^turn-\d+-(.+)-(.+)$/);
  if (!match) return null;
  return {
    userHash: match[1],
    assistantHash: match[2]
  };
}

function storedTurnEntryMatches(
  storedNodeId: string,
  override: { sourceAnchors?: SourceAnchor[] } | undefined,
  turn: Turn
): boolean {
  const anchors = sanitizeSourceAnchors(override?.sourceAnchors);
  if (anchors?.some((anchor) => sourceAnchorMatches(anchor, turn.sourceAnchor))) return true;

  const hashes = turnHashesFromNodeId(storedNodeId);
  return Boolean(
    hashes &&
      hashes.userHash === turn.sourceAnchor.userHash &&
      hashes.assistantHash === turn.sourceAnchor.assistantHash
  );
}

function buildStoredTurnIdMap(
  turns: Turn[],
  nodeOverrides: Record<string, { sourceAnchors?: SourceAnchor[] }>
): Map<string, string> {
  const idMap = new Map<string, string>();

  Object.entries(nodeOverrides).forEach(([storedNodeId, override]) => {
    if (!storedNodeId.startsWith("turn-")) return;
    if (turns.some((turn) => turn.id === storedNodeId)) return;

    const match = turns.find((turn) => storedTurnEntryMatches(storedNodeId, override, turn));
    if (match) idMap.set(storedNodeId, match.id);
  });

  return idMap;
}

function remapRecordKeys<T>(record: Record<string, T>, idMap: Map<string, string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([id, value]) => [idMap.get(id) ?? id, value]));
}

function remapNodeIds(nodeIds: string[], idMap: Map<string, string>): string[] {
  return [...new Set(nodeIds.map((id) => idMap.get(id) ?? id))];
}

function remapCompoundId(id: string, idMap: Map<string, string>): string {
  let nextId = id;
  idMap.forEach((nextTurnId, previousTurnId) => {
    nextId = nextId.split(previousTurnId).join(nextTurnId);
  });
  return nextId;
}

function remapStoredEdge(edge: Edge, idMap: Map<string, string>): Edge {
  const source = idMap.get(edge.source) ?? edge.source;
  const target = idMap.get(edge.target) ?? edge.target;

  return {
    ...edge,
    id: remapCompoundId(edge.id, idMap),
    source,
    target
  };
}

function graphNodesMatchTurns(nodes: Node<TurnNodeData>[], turns: Turn[], hiddenNodeIds: string[] = []): boolean {
  const hidden = new Set(hiddenNodeIds);
  const turnIds = new Set(turns.filter((turn) => !hidden.has(turn.id)).map((turn) => turn.id));
  const nodeTurnIds = nodes.filter((node) => node.data.turn).map((node) => node.id);
  return (
    nodeTurnIds.length === turnIds.size &&
    nodeTurnIds.every((nodeId) => turnIds.has(nodeId)) &&
    nodes.filter((node) => node.data.turn).every((node) => node.data.turn?.id === node.id)
  );
}

function relationshipStyle(
  relationship: EdgeRelationship,
  important = false,
  weight = DEFAULT_USER_EDGE_WEIGHT
): Edge["style"] {
  const color = edgeDisplayColor(relationshipColor(relationship));
  return {
    stroke: color,
    strokeOpacity: edgeStrokeOpacity(weight, important),
    strokeWidth: edgeStrokeWidth(weight, important)
  };
}

function relationshipColor(relationship: EdgeRelationship): string {
  return colorForRelationship(relationship);
}

function edgeVisualStyle(edge: Edge): Edge["style"] {
  const data = edge.data as RelationshipEdgeData | undefined;
  const relationship = data?.relationship ?? "related";
  const color = edgeDisplayColor(relationshipColor(relationship));
  const weight = normalizeEdgeWeight(
    data?.weight,
    isAutoEdge(edge)
      ? DEFAULT_AUTO_SEQUENCE_EDGE_WEIGHT
      : isTopicProxyEdge(edge)
        ? DEFAULT_TOPIC_PROXY_EDGE_WEIGHT
        : DEFAULT_USER_EDGE_WEIGHT
  );
  if (isTopicProxyEdge(edge)) {
    return {
      stroke: color,
      strokeDasharray: "6 7",
      strokeLinecap: "round",
      strokeOpacity: edgeStrokeOpacity(weight) * 0.72,
      strokeWidth: edgeStrokeWidth(weight)
    };
  }
  if (isAutoEdge(edge)) {
    return {
      stroke: edgeDisplayColor("#64748b"),
      strokeLinecap: "round",
      strokeOpacity: edgeStrokeOpacity(weight) * 0.72,
      strokeWidth: edgeStrokeWidth(weight)
    };
  }
  return {
    stroke: color,
    filter: data?.important ? `drop-shadow(0 0 5px ${color})` : undefined,
    strokeLinecap: "round",
    strokeOpacity: edgeStrokeOpacity(weight, data?.important),
    strokeWidth: edgeStrokeWidth(weight, data?.important)
  };
}

function edgeVisualClass(edge: Edge): string {
  const data = edge.data as RelationshipEdgeData | undefined;
  return [
    isAutoEdge(edge) ? "edge-auto" : "",
    isTopicProxyEdge(edge) ? "edge-proxy" : "",
    data?.important ? "edge-important" : "",
    data?.createdBy === "ai" || data?.createdBy === "topic-analysis" ? "edge-semantic" : "",
    data?.createdBy === "user" ? "edge-user" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function RelationshipColorPicker({
  value,
  onChange
}: {
  value: EdgeRelationship;
  onChange: (relationship: EdgeRelationship) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="color-picker" aria-label={t("action.colorNode")}>
      <span className="color-picker__title">{t("action.colorNode")}</span>
      <div className="color-picker__row">
        {RELATIONSHIP_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="color-swatch-button"
            aria-pressed={value === option.value}
            title={t(RELATIONSHIP_LABEL_KEYS[option.value])}
            onClick={() => onChange(option.value)}
          >
            <span className="color-swatch-button__preview" style={{ backgroundColor: relationshipColor(option.value) }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function applyEdgeStyle(edge: Edge, linkConnectionStyle: LinkConnectionStyle = activeLinkConnectionStyle): Edge {
  const data = edge.data as RelationshipEdgeData | undefined;
  const relationship = data?.relationship ?? "related";
  const fallbackWeight = isAutoEdge(edge)
    ? DEFAULT_AUTO_SEQUENCE_EDGE_WEIGHT
    : isTopicProxyEdge(edge)
      ? DEFAULT_TOPIC_PROXY_EDGE_WEIGHT
      : data?.createdBy === "ai"
        ? weightFromConfidence(data?.confidence, DEFAULT_AI_EDGE_WEIGHT)
        : data?.createdBy === "topic-analysis"
          ? weightFromConfidence(data?.confidence, DEFAULT_TOPIC_ANALYSIS_EDGE_WEIGHT)
          : DEFAULT_USER_EDGE_WEIGHT;
  const nextData: RelationshipEdgeData = {
    ...data,
    relationship,
    weight: normalizeEdgeWeight(data?.weight, fallbackWeight)
  };
  return {
    ...edge,
    type: isAutoEdge(edge) ? "smoothstep" : edgeTypeForLinkConnectionStyle(linkConnectionStyle),
    label: edge.label ?? relationship,
    data: nextData,
    className: edgeVisualClass({ ...edge, data: nextData }),
    style: edgeVisualStyle({ ...edge, data: nextData })
  };
}

function acceptedSuggestionEdge(suggestion: Edge): Edge {
  const data = suggestion.data as RelationshipEdgeData | undefined;
  const weight = normalizeEdgeWeight(data?.weight, weightFromConfidence(data?.confidence, DEFAULT_AI_EDGE_WEIGHT));
  return applyEdgeStyle({
    ...suggestion,
    id: `user-${suggestion.id}`,
    data: {
      ...data,
      relationship: data?.relationship ?? "related",
      weight,
      createdBy: "user"
    } satisfies RelationshipEdgeData
  });
}

function isAutoEdge(edge: Edge): boolean {
  return isAutomaticEdgeId(edge.id);
}

function isTopicProxyEdge(edge: Edge): boolean {
  return edge.id.startsWith("topic-proxy-") || Boolean((edge.data as RelationshipEdgeData | undefined)?.proxyKind);
}

function topicEdgeSnapshot(edge: Edge) {
  const data = edge.data as RelationshipEdgeData | undefined;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    data: edge.data ? { ...edge.data } : undefined,
    isAuto: isAutoEdge(edge),
    weight: normalizeEdgeWeight(data?.weight)
  };
}

function nodeOverridesFromNodes(
  nodes: Node<TurnNodeData>[]
): Record<
  string,
  {
    title?: string;
    summary?: string;
    status?: "open" | "review" | "done";
    tags?: string[];
    sourceAnchors?: SourceAnchor[];
    color?: NodeColorName;
    collapsed?: boolean;
    important?: boolean;
    dimensions?: { width: number; height: number; manual: boolean };
    answerExpansion?: AnswerExpansion;
    topicGroupId?: string;
    topicGroupMemberIds?: string[];
  }
> {
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        title: typeof node.data?.title === "string" ? node.data.title : undefined,
        summary: typeof node.data?.summary === "string" ? node.data.summary : undefined,
        status: node.data.status,
        tags: normalizeNodeTags(node.data.tags),
        sourceAnchors: sanitizeSourceAnchors(node.data.sourceAnchors),
        color: node.data.color,
        collapsed: node.data.collapsed,
        important: node.data.important,
        dimensions: node.data.dimensions,
        answerExpansion: node.data.answerExpansion,
        topicGroupId: node.data.topicGroupId,
        topicGroupMemberIds: node.data.topicGroupMemberIds
      }
    ])
  );
}

function customRecordsFromNodes(nodes: Node<TurnNodeData>[]): CustomNodeRecord[] {
  return nodes
    .filter((node) => node.id !== "conversation-root" && !node.data.turn)
    .map((node) => ({
      id: node.id,
      position: node.position,
      title: node.data.title,
      summary: node.data.summary,
      status: node.data.status,
      tags: normalizeNodeTags(node.data.tags),
      sourceAnchors: sanitizeSourceAnchors(node.data.sourceAnchors),
      color: node.data.color,
      collapsed: node.data.collapsed,
      important: node.data.important,
      dimensions: node.data.dimensions,
      answerExpansion: node.data.answerExpansion,
      topicGroupId: node.data.topicGroupId,
      topicGroupMemberIds: node.data.topicGroupMemberIds
    }));
}

function mergedSourceAnchorsForNodes(nodes: Node<TurnNodeData>[]): SourceAnchor[] | undefined {
  const merged = mergeSourceAnchors(...nodes.map((node) => sourceAnchorsFromNodeData(node.data)));
  return merged.length > 0 ? merged : undefined;
}

function nodeTitleById(nodes: Node<TurnNodeData>[]): Map<string, string> {
  return new Map(nodes.map((node) => [node.id, node.data.title || node.id]));
}

function shortNodeTitle(nodes: Node<TurnNodeData>[], nodeId: string): string {
  const title = nodes.find((node) => node.id === nodeId)?.data.title ?? nodeId;
  return title.length > 42 ? `${title.slice(0, 42)}...` : title;
}

function edgeRelationship(edge: Edge): EdgeRelationship {
  return ((edge.data as RelationshipEdgeData | undefined)?.relationship ?? "related") as EdgeRelationship;
}

function safeFilePart(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return (cleaned || "turnmap").slice(0, 80);
}

function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  downloadBlobFile(filename, blob);
}

function downloadBlobFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeNodeColorRenderMode(value: unknown): NodeColorRenderMode {
  return value === "solid" ? "solid" : "gradient";
}

function normalizeNodeColorRenderStrength(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 70;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

async function loadExportAppearance(): Promise<GraphAppearance> {
  const settings = await loadUiSettings();
  const theme = normalizeTheme(settings.theme);
  return {
    theme,
    resolvedTheme: resolveTheme(theme),
    nodeColorRendering: {
      mode: normalizeNodeColorRenderMode(settings.nodeColorRenderMode),
      strength: normalizeNodeColorRenderStrength(settings.nodeColorRenderStrength)
    }
  };
}

function normalizeImportedAppearance(value: ExportedGraph["appearance"]): GraphAppearance | null {
  if (!value) return null;
  const theme = normalizeTheme(value.theme);
  return {
    theme,
    resolvedTheme: resolveTheme(theme),
    nodeColorRendering: {
      mode: normalizeNodeColorRenderMode(value.nodeColorRendering?.mode),
      strength: normalizeNodeColorRenderStrength(value.nodeColorRendering?.strength)
    }
  };
}

async function applyImportedAppearance(appearance: GraphAppearance | null): Promise<void> {
  if (!appearance) return;
  const settings = await loadUiSettings();
  const nextSettings = {
    ...settings,
    theme: appearance.theme,
    nodeColorRenderMode: appearance.nodeColorRendering.mode,
    nodeColorRenderStrength: appearance.nodeColorRendering.strength
  };
  await saveUiSettings(nextSettings);
  applyTheme(nextSettings.theme);
  applyNodeColorRendering(nextSettings);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function estimatedSvgTextWidth(value: string, fontSize: number): number {
  let units = 0;

  for (const char of Array.from(value)) {
    if (/\s/.test(char)) {
      units += 0.32;
    } else if (/[\u2e80-\u9fff\uac00-\ud7af\u3040-\u30ff\uff00-\uffef]/.test(char)) {
      units += 1;
    } else if (/[A-Z]/.test(char)) {
      units += 0.66;
    } else if (/[a-z0-9]/.test(char)) {
      units += 0.56;
    } else if (/[.,;:|/\\_\-()[\]{}'"]/.test(char)) {
      units += 0.36;
    } else {
      units += 0.62;
    }
  }

  return units * fontSize;
}

function appendEllipsis(line: string, maxWidth: number, fontSize: number): string {
  const ellipsis = "...";
  let next = line.trimEnd();

  while (next && estimatedSvgTextWidth(`${next}${ellipsis}`, fontSize) > maxWidth) {
    next = Array.from(next).slice(0, -1).join("").trimEnd();
  }

  return next ? `${next}${ellipsis}` : ellipsis;
}

function wrapText(value: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let currentLine = "";

  for (const char of Array.from(normalized)) {
    const nextLine = currentLine || !/\s/.test(char) ? `${currentLine}${char}` : currentLine;
    if (estimatedSvgTextWidth(nextLine, fontSize) <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine.trimEnd());
      if (lines.length >= maxLines) break;
    }

    currentLine = /\s/.test(char) ? "" : char;
  }

  if (currentLine && lines.length < maxLines) lines.push(currentLine);
  if (lines.length === maxLines && lines.join("").length < normalized.replace(/\s/g, "").length) {
    lines[maxLines - 1] = appendEllipsis(lines[maxLines - 1], maxWidth, fontSize);
  }

  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("PNG export failed while loading SVG."));
    image.src = src;
  });
}

async function svgToPngBlob(svg: string): Promise<Blob> {
  const sizeMatch = svg.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);
  const width = sizeMatch ? Number(sizeMatch[1]) : 1600;
  const height = sizeMatch ? Number(sizeMatch[2]) : 1200;
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export failed: canvas is unavailable.");
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("PNG export failed while encoding image."));
        }
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function serializeGraph(
  conversationId: string,
  conversationTitle: string,
  turns: Turn[],
  nodes: Node<TurnNodeData>[],
  edges: Edge[],
  layoutMode: LayoutMode,
  hiddenRoot: boolean,
  hiddenAutoEdgeIds: string[],
  hiddenNodeIds: string[],
  topicGroups: TopicGroupRecord[],
  appearance?: GraphAppearance
): string {
  const payload = {
    schemaVersion: 4,
    exportedAt: new Date().toISOString(),
    conversation: {
      id: conversationId,
      title: conversationTitle,
      turnCount: turns.length
    },
    layout: {
      mode: layoutMode,
      hiddenRoot,
      hiddenAutoEdgeIds,
      hiddenNodeIds,
      topicGroups
    },
    appearance,
    turns,
    nodes: nodes.map((node) => ({
      id: node.id,
      position: node.position,
      title: node.data.title,
      summary: node.data.summary,
      status: node.data.status,
      tags: node.data.tags,
      sourceAnchors: sanitizeSourceAnchors(node.data.sourceAnchors),
      color: node.data.color,
      collapsed: node.data.collapsed,
      important: node.data.important,
      dimensions: node.data.dimensions,
      answerExpansion: node.data.answerExpansion,
      topicGroupId: node.data.topicGroupId,
      topicGroupMemberIds: node.data.topicGroupMemberIds,
      turnId: node.data.turn?.id,
      isConversationRoot: Boolean(node.data.isConversationRoot)
    })),
    edges: edges.map((edge) => {
      const data = edge.data as RelationshipEdgeData | undefined;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        relationship: data?.relationship ?? (isAutoEdge(edge) ? "references" : "related"),
        important: Boolean(data?.important),
        weight: normalizeEdgeWeight(data?.weight),
        confidence: data?.confidence,
        reason: data?.reason,
        createdBy: data?.createdBy,
        originalEdgeId: data?.originalEdgeId,
        proxyKind: data?.proxyKind,
        topicGroupId: data?.topicGroupId,
        isAuto: isAutoEdge(edge)
      };
    })
  };

  return JSON.stringify(payload, null, 2);
}

function graphToObsidianCanvas(
  conversationTitle: string,
  nodes: Node<TurnNodeData>[],
  edges: Edge[],
  appearance?: GraphAppearance
): string {
  const nodeText = (node: Node<TurnNodeData>): string => {
    const metadata = [
      node.data.turn ? `Turn: ${node.data.turn.turnIndex + 1}` : "",
      node.data.status ? `Status: ${node.data.status}` : "",
      node.data.tags?.length ? `Tags: ${node.data.tags.map((tag) => `#${tag}`).join(" ")}` : "",
      node.data.color ? `Color: ${node.data.color}` : "",
      typeof node.data.collapsed === "boolean" ? `Collapsed: ${node.data.collapsed}` : "",
      node.data.important ? "Important: true" : ""
    ].filter(Boolean);

    return [
      node.data.isConversationRoot ? `# ${node.data.title}` : `## ${node.data.title}`,
      node.data.summary,
      metadata.length ? metadata.join("\n") : ""
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  const canvasNodes = nodes.map((node) => {
    const color = colorValue(node.data.color);
    const dimensions = node.data.dimensions;
    const expansionText =
      node.data.answerExpansion?.displayMode === "expanded"
        ? [
            "Answer expansion:",
            ...node.data.answerExpansion.nodes.map((miniNode) => `- ${miniNode.title}`)
          ].join("\n")
        : "";
    return {
      id: node.id,
      type: "text",
      text: [nodeText(node), expansionText].filter(Boolean).join("\n\n"),
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      width: dimensions?.width ?? (node.data.isConversationRoot ? 320 : 300),
      height: dimensions?.height ?? (node.data.collapsed ? 120 : node.data.isConversationRoot ? 180 : 220),
      color
    };
  });

  const expansionCanvasNodes = nodes.flatMap((node) => {
    if (node.data.answerExpansion?.displayMode !== "expanded") return [];
    const layout = calculateMiniMapLayout(node.data.answerExpansion);
    const parentColor = colorValue(node.data.color);
    return node.data.answerExpansion.nodes.map((miniNode) => {
      const position = layout.nodes[miniNode.id] ?? { x: 0, y: 0, width: 140, height: 70 };
      return {
      id: `${node.id}::mini::${miniNode.id}`,
      type: "text",
      text: [
        miniNode.title,
        `role: ${miniNode.role}`,
        `branch: ${miniNode.branchId}`,
        miniNode.parentId ? `parent: ${miniNode.parentId}` : "",
        node.data.answerExpansion?.layoutDirection ? `direction: ${node.data.answerExpansion.layoutDirection}` : ""
      ]
        .filter(Boolean)
        .join("\n"),
      x: Math.round(node.position.x + position.x),
      y: Math.round(node.position.y + (node.data.answerExpansion?.layoutDirection === "left" ? 82 : 82) + position.y),
      width: position.width,
      height: position.height,
      color: (isNodeColorName(miniNode.color) ? colorValue(miniNode.color) : undefined) ?? parentColor
    };
    });
  });

  const expansionCanvasEdges = nodes.flatMap((node) => {
    if (node.data.answerExpansion?.displayMode !== "expanded") return [];
    return node.data.answerExpansion.links.map((link) => ({
      id: `${node.id}::mini-link::${link.id}`,
      fromNode: `${node.id}::mini::${link.source}`,
      fromSide: "right",
      toNode: `${node.id}::mini::${link.target}`,
      toSide: "left",
      label: [link.relationship, typeof link.weight === "number" ? `weight ${link.weight}` : ""].filter(Boolean).join(" | "),
      color: "#64748b"
    }));
  });

  const canvasEdges = edges.map((edge) => {
    const relationship = edgeRelationship(edge);
    const data = edge.data as RelationshipEdgeData | undefined;
    return {
      id: edge.id,
      fromNode: edge.source,
      fromSide: "right",
      toNode: edge.target,
      toSide: "left",
      label: [
        String(edge.label ?? relationship),
        data?.important ? "important" : "",
        `weight ${weightPercent(data?.weight)}%`,
        typeof data?.confidence === "number" ? `${Math.round(data.confidence * 100)}%` : "",
        data?.reason ? data.reason : ""
      ]
        .filter(Boolean)
        .join(" | "),
      color: relationshipColor(relationship)
    };
  });

  return JSON.stringify(
    {
      nodes: [...canvasNodes, ...expansionCanvasNodes],
      edges: [...canvasEdges, ...expansionCanvasEdges],
      metadata: {
        name: conversationTitle,
        source: "ChatMap",
        appearance
      }
    },
    null,
    2
  );
}

const SVG_THEME_COLORS: Record<Exclude<ThemeMode, "browser">, {
  background: string;
  node: string;
  root: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  rootText: string;
  labelStroke: string;
}> = {
  day: {
    background: "#f7f9fc",
    node: "#ffffff",
    root: "#f1f5f9",
    border: "#d8e0ea",
    borderStrong: "#b8c4d2",
    text: "#1f2937",
    muted: "#64748b",
    rootText: "#1f2937",
    labelStroke: "#f7f9fc"
  },
  night: {
    background: "#0b111a",
    node: "#121b27",
    root: "#112a3b",
    border: "#2f4055",
    borderStrong: "#4e6680",
    text: "#eef6ff",
    muted: "#b6c6d8",
    rootText: "#eef6ff",
    labelStroke: "#0b111a"
  },
  "eye-care": {
    background: "#f3f8ef",
    node: "#fffffa",
    root: "#e4f3e6",
    border: "#cdddc5",
    borderStrong: "#9fbea0",
    text: "#1c2c20",
    muted: "#586d58",
    rootText: "#1c2c20",
    labelStroke: "#f3f8ef"
  }
};

function svgNodeHeight(node: Node<TurnNodeData>): number {
  if (node.data.dimensions?.height) return node.data.dimensions.height;
  if (node.data.collapsed) return node.data.isConversationRoot ? 118 : 108;
  return node.data.isConversationRoot ? 150 : 190;
}

function svgNodeWidth(node: Node<TurnNodeData>): number {
  return node.data.dimensions?.width ?? 300;
}

function svgColorMixStrength(appearance?: GraphAppearance): { fillOpacity: number; strokeOpacity: number; shadowOpacity: number } {
  const strength = normalizeNodeColorRenderStrength(appearance?.nodeColorRendering.strength);
  return {
    fillOpacity: 0.08 + strength * 0.0024,
    strokeOpacity: 0.2 + strength * 0.0055,
    shadowOpacity: 0.06 + strength * 0.0024
  };
}

function svgMiniColor(color: unknown, fallback: string): string {
  return isNodeColorName(color) ? (colorValue(color) ?? fallback) : fallback;
}

function renderMiniMapSvg(
  node: Node<TurnNodeData>,
  mapX: number,
  mapY: number,
  fallbackColor: string,
  appearance: GraphAppearance | undefined,
  index: number
): string {
  const expansion = node.data.answerExpansion;
  if (expansion?.displayMode !== "expanded") return "";
  const layout = calculateMiniMapLayout(expansion);
  const nodeById = new Map(expansion.nodes.map((miniNode) => [miniNode.id, miniNode]));
  const visibleLinks = renderableMiniLinks(expansion);
  const direction = expansion.layoutDirection === "left" ? -1 : 1;
  const theme = SVG_THEME_COLORS[appearance?.resolvedTheme ?? "day"];
  const colorMix = svgColorMixStrength(appearance);
  const summaryTargets = new Set(
    visibleLinks
      .filter((link) => link.visualKind === "summary")
      .map((link) => link.target)
      .filter((targetId) => visibleLinks.filter((link) => link.visualKind === "summary" && link.target === targetId).length >= 2)
  );

  const linkMarkup = visibleLinks
    .map((link) => {
      const sourceLayout = layout.nodes[link.source];
      const targetLayout = layout.nodes[link.target];
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!sourceLayout || !targetLayout || !source || !target) return "";
      const sourceColor = svgMiniColor(source.color, fallbackColor);
      const sourceX = mapX + sourceLayout.x + (direction === 1 ? sourceLayout.width : 0);
      const targetX = mapX + targetLayout.x + (direction === 1 ? 0 : targetLayout.width);
      const sourceY = mapY + sourceLayout.y + sourceLayout.height / 2;
      const targetY = mapY + targetLayout.y + targetLayout.height / 2;
      const midX = sourceX + direction * Math.max(28, Math.abs(targetX - sourceX) / 2);
      const isSummary = link.visualKind === "summary";
      if (isSummary && summaryTargets.has(link.target)) return "";
      return `<path class="mini-link${isSummary ? " mini-link-summary" : ""}" d="M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}" stroke="${sourceColor}" />`;
    })
    .join("");

  const braceMarkup = [...summaryTargets]
    .map((targetId) => {
      const targetLayout = layout.nodes[targetId];
      const target = nodeById.get(targetId);
      if (!targetLayout || !target) return "";
      const sources = visibleLinks
        .filter((link) => link.visualKind === "summary" && link.target === targetId)
        .map((link) => layout.nodes[link.source])
        .filter(Boolean);
      if (sources.length < 2) return "";
      const minY = Math.min(...sources.map((miniNode) => mapY + miniNode.y));
      const maxY = Math.max(...sources.map((miniNode) => mapY + miniNode.y + miniNode.height));
      if (maxY - minY > 260) return "";
      const sourceEdge =
        direction === 1
          ? Math.max(...sources.map((miniNode) => mapX + miniNode.x + miniNode.width))
          : Math.min(...sources.map((miniNode) => mapX + miniNode.x));
      const targetEdge = mapX + targetLayout.x + (direction === 1 ? 0 : targetLayout.width);
      const gap = Math.abs(targetEdge - sourceEdge);
      if (gap < 18) return "";
      const x = targetEdge - direction * Math.min(16, Math.max(8, gap / 2));
      const bend = 10 * direction;
      const midY = (minY + maxY) / 2;
      return `<path class="mini-brace" d="M ${x - bend} ${minY} Q ${x} ${midY - 10}, ${x - bend} ${midY} Q ${x} ${midY + 10}, ${x - bend} ${maxY}" stroke="${svgMiniColor(target.color, fallbackColor)}" />`;
    })
    .join("");

  const miniNodeGradients = expansion.nodes
    .map((miniNode, miniIndex) => {
      const item = layout.nodes[miniNode.id];
      if (!item || appearance?.nodeColorRendering.mode === "solid") return "";
      const accent = svgMiniColor(miniNode.color, fallbackColor);
      const miniGradientId = `mini-node-accent-${index}-${miniIndex}`;
      return `
        <linearGradient id="${miniGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="${colorMix.fillOpacity}" />
          <stop offset="58%" stop-color="${theme.node}" stop-opacity="1" />
          <stop offset="100%" stop-color="${theme.node}" stop-opacity="1" />
        </linearGradient>`;
    })
    .join("");

  const miniNodeMarkup = expansion.nodes
    .map((miniNode, miniIndex) => {
      const item = layout.nodes[miniNode.id];
      if (!item) return "";
      const accent = svgMiniColor(miniNode.color, fallbackColor);
      const miniGradientId = `mini-node-accent-${index}-${miniIndex}`;
      const miniFill = appearance?.nodeColorRendering.mode === "solid" ? accent : `url(#${miniGradientId})`;
      const miniFillOpacity = appearance?.nodeColorRendering.mode === "solid" ? colorMix.fillOpacity : 1;
      const x = mapX + item.x;
      const y = mapY + item.y;
      const lines = wrapText(miniNode.title, item.width - 16, miniNode.role === "branch" ? 12 : 11, 3);
      const textMarkup = lines
        .map((line, lineIndex) => `<tspan x="${x + 8}" y="${y + 17 + lineIndex * 14}">${escapeXml(line)}</tspan>`)
        .join("");
      return `
        <g>
          <rect x="${x}" y="${y}" width="${item.width}" height="${item.height}" rx="6" fill="${miniFill}" fill-opacity="${miniFillOpacity}" stroke="${accent}" stroke-opacity="${miniNode.important ? 0.95 : 0.58}" stroke-width="${miniNode.important ? 2 : 1}" ${miniNode.role === "summary" ? 'stroke-dasharray="5 5"' : ""} />
          <text class="${miniNode.role === "summary" ? "mini-text-summary" : "mini-text"}">${textMarkup}</text>
        </g>`;
    })
    .join("");

  return `
    <g>
      <defs>${miniNodeGradients}</defs>
      <rect x="${mapX}" y="${mapY}" width="${layout.width}" height="${layout.height}" rx="8" fill="transparent" stroke="${fallbackColor}" stroke-opacity="0.14" />
      ${linkMarkup}
      ${braceMarkup}
      ${miniNodeMarkup}
    </g>`;
}

function svgEdgeStyle(edge: Edge, relationship: EdgeRelationship): {
  dash: string;
  glow: string;
  marker: string;
  opacity: number;
  stroke: string;
  width: number;
} {
  const data = edge.data as RelationshipEdgeData | undefined;
  const stroke = edgeDisplayColor(isAutoEdge(edge) ? "#64748b" : relationshipColor(relationship));
  const width = edgeStrokeWidth(data?.weight, data?.important);
  const opacity = edgeStrokeOpacity(data?.weight, data?.important);
  if (isTopicProxyEdge(edge)) {
    return {
      dash: 'stroke-dasharray="6 7"',
      glow: "",
      marker: "",
      opacity: Math.max(0.38, opacity - 0.16),
      stroke,
      width
    };
  }
  if (isAutoEdge(edge)) {
    return {
      dash: "",
      glow: "",
      marker: "",
      opacity: Math.max(0.28, opacity - 0.2),
      stroke,
      width
    };
  }
  return {
    dash: "",
    glow: data?.important
      ? `<path d="{path}" fill="none" stroke="${stroke}" stroke-width="9" opacity="0.16" stroke-linecap="round" />`
      : "",
    marker: 'marker-end="url(#arrow)"',
    opacity,
    stroke,
    width
  };
}

function graphToSvg(
  conversationTitle: string,
  nodes: Node<TurnNodeData>[],
  edges: Edge[],
  appearance?: GraphAppearance
): string {
  const padding = 90;
  const theme = SVG_THEME_COLORS[appearance?.resolvedTheme ?? "day"];
  const colorMix = svgColorMixStrength(appearance);
  const bounds = nodes.reduce(
    (acc, node) => {
      const height = svgNodeHeight(node);
      const nodeWidth = svgNodeWidth(node);
      return {
        minX: Math.min(acc.minX, node.position.x),
        minY: Math.min(acc.minY, node.position.y),
        maxX: Math.max(acc.maxX, node.position.x + nodeWidth),
        maxY: Math.max(acc.maxY, node.position.y + height)
      };
    },
    { minX: 0, minY: 0, maxX: 300, maxY: 190 }
  );
  const offsetX = padding - bounds.minX;
  const offsetY = padding - bounds.minY;
  const width = Math.ceil(bounds.maxX - bounds.minX + padding * 2);
  const height = Math.ceil(bounds.maxY - bounds.minY + padding * 2);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const edgeMarkup = edges
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return "";
      const sourceHeight = svgNodeHeight(source);
      const targetHeight = svgNodeHeight(target);
      const sourceWidth = svgNodeWidth(source);
      const relationship = edgeRelationship(edge);
      const x1 = source.position.x + offsetX + sourceWidth;
      const y1 = source.position.y + offsetY + sourceHeight / 2;
      const x2 = target.position.x + offsetX;
      const y2 = target.position.y + offsetY + targetHeight / 2;
      const midX = (x1 + x2) / 2;
      const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
      const label = edge.label ? String(edge.label) : relationship;
      const visual = svgEdgeStyle(edge, relationship);
      const glow = visual.glow.replace("{path}", path);

      return `
    ${glow}
    <path d="${path}" fill="none" stroke="${visual.stroke}" stroke-width="${visual.width}" ${visual.marker} ${visual.dash} stroke-linecap="round" opacity="${visual.opacity}" />
    <text x="${midX}" y="${(y1 + y2) / 2 - 6}" class="edge-label ${isAutoEdge(edge) ? "edge-label-muted" : ""}">${escapeXml(label)}</text>`;
    })
    .join("");

  const nodeGradients = nodes
    .map((node, index) => {
      const accent = colorValue(node.data.color);
      if (!accent) return "";
      if (appearance?.nodeColorRendering.mode === "solid") return "";
      return `
    <linearGradient id="node-accent-${index}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="${colorMix.fillOpacity}" />
      <stop offset="58%" stop-color="${theme.node}" stop-opacity="1" />
      <stop offset="100%" stop-color="${theme.node}" stop-opacity="1" />
    </linearGradient>`;
    })
    .join("");

  const nodeMarkup = nodes
    .map((node, index) => {
      const isRoot = Boolean(node.data.isConversationRoot);
      const accent = colorValue(node.data.color);
      const x = node.position.x + offsetX;
      const y = node.position.y + offsetY;
      const height = svgNodeHeight(node);
      const nodeWidth = svgNodeWidth(node);
      const textX = x + 18;
      const textWidth = nodeWidth - 36;
      const clipId = `node-text-clip-${index}`;
      const titleLines = wrapText(node.data.title, textWidth, 14, node.data.collapsed ? 1 : isRoot ? 3 : 2);
      const hasExpandedMiniMap = node.data.answerExpansion?.displayMode === "expanded";
      const summaryLines = wrapText(
        hasExpandedMiniMap ? "" : node.data.summary,
        textWidth,
        12,
        node.data.collapsed ? 1 : isRoot ? 3 : 5
      );
      const titleMarkup = titleLines
        .map(
          (line, index) =>
            `<tspan x="${textX}" y="${y + 54 + index * 18}">${escapeXml(line)}</tspan>`
        )
        .join("");
      const summaryStart = y + 70 + titleLines.length * 18;
      const summaryMarkup = summaryLines
        .map(
          (line, index) =>
            `<tspan x="${textX}" y="${summaryStart + index * 16}">${escapeXml(line)}</tspan>`
        )
        .join("");
      const miniMarkup = hasExpandedMiniMap
        ? renderMiniMapSvg(node, x + 16, y + 72 + titleLines.length * 18, accent ?? theme.text, appearance, index)
        : "";
      const fill = accent
        ? appearance?.nodeColorRendering.mode === "solid"
          ? accent
          : `url(#node-accent-${index})`
        : isRoot
          ? theme.root
          : theme.node;
      const fillOpacity = accent && appearance?.nodeColorRendering.mode === "solid" ? colorMix.fillOpacity : 1;
      const stroke = accent ?? (isRoot ? theme.borderStrong : theme.border);
      const strokeWidth = node.data.important ? 3 : 1;
      const shadowColor = accent ?? "#000000";
      const shadowOpacity = node.data.important ? colorMix.shadowOpacity : 0.08;
      const importantGlow = node.data.important && !hasExpandedMiniMap
        ? `<ellipse cx="${x + nodeWidth / 2}" cy="${y + height / 2}" rx="${nodeWidth / 2 + 12}" ry="${height / 2 + 12}" fill="${shadowColor}" opacity="${shadowOpacity}" />`
        : "";

      return `
    <g>
      ${importantGlow}
      <clipPath id="${clipId}">
        <rect x="${x + 12}" y="${y + 10}" width="${nodeWidth - 24}" height="${height - 20}" rx="6" />
      </clipPath>
      <rect x="${x}" y="${y}" width="${nodeWidth}" height="${height}" rx="8" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-opacity="${accent ? colorMix.strokeOpacity : 1}" stroke-width="${strokeWidth}" class="${isRoot ? "node-root" : "node"}" />
      <g clip-path="url(#${clipId})">
        <text x="${textX}" y="${y + 26}" class="${isRoot ? "meta-root" : "meta"}">${
          isRoot ? "CONVERSATION" : `TURN ${node.data.turn ? node.data.turn.turnIndex + 1 : ""}`
        }</text>
        <text class="${isRoot ? "title-root" : "title"}">${titleMarkup}</text>
        <text class="${isRoot ? "summary-root" : "summary"}">${summaryMarkup}</text>
        ${miniMarkup}
      </g>
    </g>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(
    conversationTitle
  )}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
    </marker>
    <style>
      .bg { fill: ${theme.background}; }
      .node { filter: drop-shadow(0 6px 12px rgba(31,41,55,0.08)); }
      .node-root { filter: drop-shadow(0 8px 18px rgba(31,41,55,0.1)); }
      .meta { fill: ${theme.muted}; font: 700 11px Inter, Arial, sans-serif; letter-spacing: 0; }
      .meta-root { fill: ${theme.rootText}; font: 700 11px Inter, Arial, sans-serif; letter-spacing: 0; }
      .title { fill: ${theme.text}; font: 700 14px Inter, Arial, sans-serif; }
      .title-root { fill: ${theme.rootText}; font: 700 14px Inter, Arial, sans-serif; }
      .summary { fill: ${theme.muted}; font: 12px Inter, Arial, sans-serif; }
      .summary-root { fill: ${theme.rootText}; font: 12px Inter, Arial, sans-serif; }
      .edge-label { fill: ${theme.muted}; font: 11px Inter, Arial, sans-serif; paint-order: stroke; stroke: ${theme.labelStroke}; stroke-width: 4px; stroke-linejoin: round; }
      .edge-label-muted { opacity: 0.42; }
      .mini-link { fill: none; stroke-linecap: round; stroke-opacity: 0.62; stroke-width: 3px; }
      .mini-link-summary { stroke-dasharray: 5 7; stroke-opacity: 0.2; stroke-width: 2px; }
      .mini-brace { fill: none; stroke-linecap: round; stroke-opacity: 0.24; stroke-width: 2.2px; }
      .mini-text { fill: ${theme.text}; font: 700 11px Inter, Arial, sans-serif; }
      .mini-text-summary { fill: ${theme.muted}; font: 700 11px Inter, Arial, sans-serif; }
    </style>
    ${nodeGradients}
  </defs>
  <rect class="bg" width="100%" height="100%" />
  ${edgeMarkup}
  ${nodeMarkup}
</svg>`;
}

function graphToMarkdown(
  conversationTitle: string,
  turns: Turn[],
  nodes: Node<TurnNodeData>[],
  edges: Edge[]
): string {
  const titles = nodeTitleById(nodes);
  const turnNodes = nodes.filter((node) => !node.data.isConversationRoot);
  const lines: string[] = [`# ${conversationTitle}`, "", `${turns.length} turns mapped by ChatMap.`, ""];

  lines.push("## Nodes", "");
  turnNodes.forEach((node, index) => {
    lines.push(`### ${index + 1}. ${node.data.title}`);
    if (node.data.summary) {
      lines.push("", node.data.summary);
    }
    if (node.data.answerExpansion?.displayMode === "expanded") {
      lines.push("", "**Answer expansion**", "");
      node.data.answerExpansion.nodes.forEach((miniNode) => {
        lines.push(`- ${miniNode.title}`);
      });
    }
    if (node.data.turn) {
      lines.push("", "**User**", "", node.data.turn.userText.trim());
      lines.push("", "**Assistant**", "", node.data.turn.assistantText.trim());
    }
    lines.push("");
  });

  lines.push("## Links", "");
  if (edges.length === 0) {
    lines.push("No links.");
  } else {
    edges.forEach((edge) => {
      const relationship = edgeRelationship(edge);
      const data = edge.data as RelationshipEdgeData | undefined;
      const important = data?.important ? " important" : "";
      const weight = ` weight ${weightPercent(data?.weight)}%`;
      const label = edge.label ? ` - ${String(edge.label)}` : "";
      lines.push(
        `- ${titles.get(edge.source) ?? edge.source} -> ${titles.get(edge.target) ?? edge.target} [${relationship}${important}${weight}]${label}`
      );
    });
  }

  return lines.join("\n");
}

function nodesForAdvancedExport(nodes: Node<TurnNodeData>[]): ExportNode[] {
  return nodes.map((node) => ({
    id: node.id,
    title: node.data.title,
    summary: node.data.summary,
    status: node.data.status,
    tags: node.data.tags,
    color: node.data.color,
    collapsed: node.data.collapsed,
    important: node.data.important,
    dimensions: node.data.dimensions,
    answerExpansion: node.data.answerExpansion,
    turn: node.data.turn,
    isConversationRoot: node.data.isConversationRoot,
    position: node.position
  }));
}

function edgesForAdvancedExport(edges: Edge[]): ExportEdge[] {
  return edges.map((edge) => {
    const data = edge.data as RelationshipEdgeData | undefined;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      relationship: data?.relationship ?? (isAutoEdge(edge) ? "references" : "related"),
      important: data?.important,
      weight: normalizeEdgeWeight(data?.weight),
      confidence: data?.confidence,
      reason: data?.reason
    };
  });
}

function sameConversationGraphLayoutSettings(
  left: ConversationGraphLayoutSettings,
  right: ConversationGraphLayoutSettings
): boolean {
  return (
    left.columnsPerRow === right.columnsPerRow &&
    left.horizontalSpacing === right.horizontalSpacing &&
    left.verticalSpacing === right.verticalSpacing &&
    left.arrangement === right.arrangement &&
    left.showSequenceEdges === right.showSequenceEdges
  );
}

function isRelationship(value: unknown): value is EdgeRelationship {
  return (
    value === "related" ||
    value === "depends_on" ||
    value === "extends" ||
    value === "supports" ||
    value === "contradicts" ||
    value === "duplicates" ||
    value === "references" ||
    value === "todo"
  );
}

function normalizeDimensions(value: unknown): { width: number; height: number; manual: boolean } | undefined {
  const dimensions = value as { width?: unknown; height?: unknown; manual?: unknown } | undefined;
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
    width: Math.max(220, Math.min(1200, Math.round(dimensions.width))),
    height: Math.max(120, Math.min(900, Math.round(dimensions.height))),
    manual: Boolean(dimensions.manual)
  };
}

function normalizeImportedExpansion(value: unknown): AnswerExpansion | undefined {
  const expansion = value as AnswerExpansion | undefined;
  if (
    !expansion ||
    expansion.schemaVersion !== 2 ||
    (expansion.displayMode !== "expanded" && expansion.displayMode !== "original") ||
    (expansion.layoutDirection !== "left" && expansion.layoutDirection !== "right") ||
    !Array.isArray(expansion.nodes)
  ) {
    return undefined;
  }
  return expansion;
}

function normalizeImportedTopicGroups(value: unknown): TopicGroupRecord[] {
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

function parseImportedGraph(text: string): ExportedGraph {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object") {
    throw new Error("Imported file is not a ChatMap JSON object.");
  }

  const graph = value as ExportedGraph;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Imported file does not look like a ChatMap or legacy TurnMap JSON export.");
  }

  return graph;
}

function positionsFromImportedGraph(graph: ExportedGraph): Record<string, { x: number; y: number }> {
  return Object.fromEntries(
    (graph.nodes ?? [])
      .filter(
        (node) =>
          typeof node.id === "string" &&
          typeof node.position?.x === "number" &&
          typeof node.position?.y === "number"
      )
      .map((node) => [node.id!, { x: node.position!.x!, y: node.position!.y! }])
  );
}

function overridesFromImportedGraph(
  graph: ExportedGraph
): Record<
  string,
  {
    title?: string;
    summary?: string;
    status?: "open" | "review" | "done";
    tags?: string[];
    sourceAnchors?: SourceAnchor[];
    color?: NodeColorName;
    collapsed?: boolean;
    important?: boolean;
    dimensions?: { width: number; height: number; manual: boolean };
    answerExpansion?: AnswerExpansion;
    topicGroupId?: string;
    topicGroupMemberIds?: string[];
  }
> {
  return Object.fromEntries(
    (graph.nodes ?? [])
      .filter((node) => typeof node.id === "string")
      .map((node) => [
        node.id!,
        {
          title: typeof node.title === "string" ? node.title : undefined,
          summary: typeof node.summary === "string" ? node.summary : undefined,
          status:
            node.status === "open" || node.status === "review" || node.status === "done"
              ? node.status
              : undefined,
          tags: Array.isArray(node.tags) ? node.tags.filter((tag) => typeof tag === "string") : undefined,
          sourceAnchors: sanitizeSourceAnchors(node.sourceAnchors),
          color: isNodeColorName(node.color) ? node.color : undefined,
          collapsed: typeof node.collapsed === "boolean" ? node.collapsed : undefined,
          important: typeof node.important === "boolean" ? node.important : undefined,
          dimensions: normalizeDimensions(node.dimensions),
          answerExpansion: normalizeImportedExpansion(node.answerExpansion),
          topicGroupId: typeof node.topicGroupId === "string" ? node.topicGroupId : undefined,
          topicGroupMemberIds: Array.isArray(node.topicGroupMemberIds)
            ? node.topicGroupMemberIds.filter((nodeId) => typeof nodeId === "string")
            : undefined
        }
      ])
  );
}

function customNodesFromImportedGraph(graph: ExportedGraph): CustomNodeRecord[] {
  return (graph.nodes ?? [])
    .filter((node) => typeof node.id === "string" && !node.isConversationRoot && !node.turnId)
    .map((node) => ({
      id: node.id!,
      position: {
        x: typeof node.position?.x === "number" ? node.position.x : 0,
        y: typeof node.position?.y === "number" ? node.position.y : 0
      },
      title: typeof node.title === "string" ? node.title : node.id!,
      summary: typeof node.summary === "string" ? node.summary : "",
      status:
        node.status === "open" || node.status === "review" || node.status === "done" ? node.status : undefined,
      tags: Array.isArray(node.tags) ? node.tags.filter((tag) => typeof tag === "string") : undefined,
      sourceAnchors: sanitizeSourceAnchors(node.sourceAnchors),
      color: isNodeColorName(node.color) ? node.color : undefined,
      collapsed: typeof node.collapsed === "boolean" ? node.collapsed : undefined,
      important: typeof node.important === "boolean" ? node.important : undefined,
      dimensions: normalizeDimensions(node.dimensions),
      answerExpansion: normalizeImportedExpansion(node.answerExpansion),
      topicGroupId: typeof node.topicGroupId === "string" ? node.topicGroupId : undefined,
      topicGroupMemberIds: Array.isArray(node.topicGroupMemberIds)
        ? node.topicGroupMemberIds.filter((nodeId) => typeof nodeId === "string")
        : undefined
    }));
}

export function TurnMapCanvas({
  conversationId,
  conversationTitle,
  turns,
  turnUpdateMode = "refresh",
  sourceTabId,
  rebuildRequest = 0,
  graphResetRequest = 0,
  onStatus,
  onTaskStatus
}: TurnMapCanvasProps) {
  const { t } = useI18n();
  const orderedTurns = useMemo(() => uniqueTurnsByTurnIndex(turns), [turns]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TurnNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [selectedRoot, setSelectedRoot] = useState(false);
  const [selectedMiniNode, setSelectedMiniNode] = useState<{ parentNodeId: string; miniNodeId: string } | null>(null);
  const [highlightedEndpointIds, setHighlightedEndpointIds] = useState<string[]>([]);
  const [jumpFeedback, setJumpFeedback] = useState<{ kind: "pending" | "success" | "error"; message: string } | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("snake");
  const [graphLayoutSettings, setGraphLayoutSettings] = useState<ConversationGraphLayoutSettings>(
    () => ({ ...DEFAULT_CONVERSATION_GRAPH_LAYOUT })
  );
  const [hiddenRoot, setHiddenRoot] = useState(false);
  const [hiddenAutoEdgeIds, setHiddenAutoEdgeIds] = useState<string[]>([]);
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>([]);
  const [topicGroups, setTopicGroups] = useState<TopicGroupRecord[]>([]);
  const [linkConnectionStyle, setLinkConnectionStyle] = useState<LinkConnectionStyle>("curved");
  const [nodeSizeSettings, setNodeSizeSettings] = useState<DefaultNodeSizeSettings>(DEFAULT_NODE_SIZE_SETTINGS);
  const updateNodeSizeSettings = useCallback((nextSettings: DefaultNodeSizeSettings) => {
    setNodeSizeSettings((current) =>
      sameDefaultNodeSizeSettings(current, nextSettings) ? current : nextSettings
    );
  }, []);
  const [summarizingNodeIds, setSummarizingNodeIds] = useState<Set<string>>(() => new Set());
  const [expandingNodeIds, setExpandingNodeIds] = useState<Set<string>>(() => new Set());
  const [pendingSuggestedEdges, setPendingSuggestedEdges] = useState<Edge[]>([]);
  const [suggestingLinks, setSuggestingLinks] = useState(false);
  const [analyzingTopics, setAnalyzingTopics] = useState(false);
  const [autoSummarize, setAutoSummarize] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [undoStack, setUndoStack] = useState<GraphSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<GraphSnapshot[]>([]);
  const saveTimer = useRef<number | null>(null);
  const historyTimer = useRef<number | null>(null);
  const nodesRef = useRef<Node<TurnNodeData>[]>([]);
  const lastHistorySnapshot = useRef<GraphSnapshot | null>(null);
  const restoringHistory = useRef(false);
  const loadedConversationId = useRef<string | null>(null);
  const appliedRebuildRequest = useRef(0);
  const appliedGraphResetRequest = useRef(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const flowInstance = useRef<ReactFlowInstance<Node<TurnNodeData>, Edge> | null>(null);
  const autoSummarizedNodeIds = useRef<Set<string>>(new Set());
  const autoSummarizeRunning = useRef(false);
  const jumpRequestId = useRef(0);

  activeLinkConnectionStyle = linkConnectionStyle;

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );
  const selectedEdges = useMemo(
    () => edges.filter((edge) => selectedEdgeIds.includes(edge.id)),
    [edges, selectedEdgeIds]
  );
  const selectedTurnNodes = useMemo(
    () => nodes.filter((node) => node.selected && node.data.turn && !node.data.isConversationRoot),
    [nodes]
  );
  const selectedActionNodes = useMemo(
    () => nodes.filter((node) => node.selected && !node.data.isConversationRoot),
    [nodes]
  );
  const selectedMiniNodeContext = useMemo(() => {
    if (!selectedMiniNode) return null;
    const parentNode = nodes.find((node) => node.id === selectedMiniNode.parentNodeId);
    const expansion = parentNode?.data.answerExpansion;
    const miniNode = expansion?.nodes.find((node) => node.id === selectedMiniNode.miniNodeId);
    return parentNode && expansion && miniNode ? { parentNode, expansion, miniNode } : null;
  }, [nodes, selectedMiniNode]);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return nodes
      .filter((node) => !node.data.isConversationRoot)
      .filter((node) =>
        [node.data.title, node.data.summary, ...(node.data.tags ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 30);
  }, [nodes, searchQuery]);
  const renderedNodes = useMemo<Node<TurnNodeData>[]>(() => {
    const highlighted = new Set(highlightedEndpointIds);
    return nodes.map((node) => ({
      ...node,
      className: [node.className, highlighted.has(node.id) ? "is-endpoint-highlight" : ""]
        .filter(Boolean)
        .join(" "),
      data: {
        ...node.data,
        selectedMiniNodeId: selectedMiniNode?.parentNodeId === node.id ? selectedMiniNode.miniNodeId : undefined
      }
    }));
  }, [highlightedEndpointIds, nodes, selectedMiniNode]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const currentSnapshot = useCallback(
    (): GraphSnapshot => {
      const snapshot = cloneSnapshot({
      nodes,
      edges,
      hiddenRoot,
      hiddenAutoEdgeIds,
      hiddenNodeIds,
      topicGroups
    });
    return snapshot;
  },
    [edges, hiddenAutoEdgeIds, hiddenNodeIds, hiddenRoot, nodes, topicGroups]
  );

  const restoreSnapshot = useCallback(
    (snapshot: GraphSnapshot) => {
      restoringHistory.current = true;
      const nextSnapshot = cloneSnapshot(snapshot);
      const positions = createLayoutPositions(orderedTurns, layoutMode, graphLayoutSettings);
      const nextNodes = nextSnapshot.nodes.map((node) => {
        const position = positions[node.id];
        return position ? { ...node, position, draggable: layoutMode === "snake" ? false : true } : node;
      });
      const autoEdgeState = autoEdgeStateFromTurns(
        orderedTurns,
        layoutMode,
        nextSnapshot.hiddenRoot,
        nextSnapshot.hiddenAutoEdgeIds,
        graphLayoutSettings
      );
      const nodeIds = new Set(nextNodes.map((node) => node.id));
      const userEdges = filterRestoredUserEdges(nextSnapshot.edges, nodeIds)
        .filter((edge) => edgeHasExistingNodes(edge, nodeIds));
      const restoredEdges = [
        ...autoEdgeState.visibleAutoEdges.map((edge) => applyEdgeStyle(edge, linkConnectionStyle)),
        ...userEdges.map((edge) => applyEdgeStyle(edge, linkConnectionStyle))
      ];
      nextSnapshot.nodes = nextNodes;
      nextSnapshot.edges = restoredEdges;
      nextSnapshot.hiddenAutoEdgeIds = autoEdgeState.hiddenAutoEdgeIds;
      setNodes(nextNodes);
      setEdges(restoredEdges);
      setHiddenRoot(nextSnapshot.hiddenRoot);
      setHiddenAutoEdgeIds(nextSnapshot.hiddenAutoEdgeIds);
      setHiddenNodeIds(nextSnapshot.hiddenNodeIds);
      setTopicGroups(nextSnapshot.topicGroups);
      setSelectedEdgeId(null);
      setSelectedRoot(false);
      lastHistorySnapshot.current = cloneSnapshot(nextSnapshot);
      window.setTimeout(() => {
        restoringHistory.current = false;
      }, 0);
    },
    [graphLayoutSettings, layoutMode, linkConnectionStyle, orderedTurns, setEdges, setNodes]
  );

  const updateNodeText = useCallback(
    (nodeId: string, updates: { title?: string; summary?: string }) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...updates
                }
              }
            : node
        )
      );
    },
    [setNodes]
  );

  const updateNodeDimensions = useCallback(
    (nodeId: string, dimensions: { width: number; height: number; manual: boolean }) => {
      const normalized = normalizeDimensions(dimensions);
      if (!normalized) return;
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                style: {
                  ...node.style,
                  width: normalized.width,
                  height: normalized.height
                },
                data: {
                  ...node.data,
                  dimensions: normalized
                }
              }
            : node
        )
      );
      onStatus?.(t("status.nodeResized"));
    },
    [onStatus, setNodes, t]
  );

  const updateNodeExpansion = useCallback(
    (nodeId: string, updater: (expansion: AnswerExpansion) => AnswerExpansion) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId && node.data.answerExpansion
            ? withContentFittingDimensions(node, {
                ...node.data,
                answerExpansion: updater(node.data.answerExpansion)
              }, nodeSizeSettings)
            : node
        )
      );
    },
    [nodeSizeSettings, setNodes]
  );

  const updateMiniNodeInExpansion = useCallback(
    (nodeId: string, miniNodeId: string, updates: Partial<Pick<AnswerMiniNode, "title" | "color" | "important">>) => {
      updateNodeExpansion(nodeId, (expansion) => updateMiniNode(expansion, miniNodeId, updates));
    },
    [updateNodeExpansion]
  );

  const selectMiniNode = useCallback(
    (parentNodeId: string, miniNodeId: string) => {
      setSelectedMiniNode({ parentNodeId, miniNodeId });
      setSelectedEdgeId(null);
      setSelectedEdgeIds([]);
      setSelectedRoot(false);
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          selected: node.id === parentNodeId
        }))
      );
    },
    [setNodes]
  );

  const deleteMiniNodeFromExpansion = useCallback(
    (nodeId: string, miniNodeId: string) => {
      const expansion = nodesRef.current.find((candidate) => candidate.id === nodeId)?.data.answerExpansion;
      const miniNode = expansion?.nodes.find((candidate) => candidate.id === miniNodeId);
      const deleteCount = expansion ? miniNodeDescendantIds(expansion, miniNodeId).length : 1;
      if (
        expansion &&
        miniNode &&
        (miniNode.role === "branch" || deleteCount >= 5) &&
        !window.confirm(t("app.confirm.deleteMiniSubtree", { count: deleteCount }))
      ) {
        return;
      }
      updateNodeExpansion(nodeId, (expansion) => deleteMiniNode(expansion, miniNodeId));
      setSelectedMiniNode(null);
      const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
      if ((node?.data.answerExpansion?.nodes.length ?? 0) <= 2) {
        onStatus?.(t("expansion.emptyGuidance"));
      }
    },
    [onStatus, t, updateNodeExpansion]
  );

  const reportApiTask = useCallback(
    (entry: {
      id: string;
      kind: ApiTaskKind;
      status: ApiTaskStatus;
      message: string;
      progress: number;
    }) => {
      onStatus?.(entry.message);
      void onTaskStatus?.(entry);
    },
    [onStatus, onTaskStatus]
  );

  const reportGraphHealthIssues = useCallback(
    (stage: string, issues: GraphIssue[]) => {
      if (issues.length === 0) return;
      const summary = graphIssuesSummary(issues);
      const hasFatal = summary.fatal > 0;
      reportApiTask({
        id: `graph-health-${conversationId}-${stage}`,
        kind: "graph-health",
        status: hasFatal ? "error" : "success",
        message: t("task.graphHealthDone", {
          corrected: summary.corrected,
          dropped: summary.dropped,
          fatal: summary.fatal
        }),
        progress: 100
      });
    },
    [conversationId, reportApiTask, t]
  );

  const healthyGraphSnapshot = useCallback(
    (stage: string, snapshotNodes: Node<TurnNodeData>[], snapshotEdges: Edge[]) => {
      const repaired = repairGraphSnapshot({ nodes: snapshotNodes, edges: snapshotEdges.map((edge) => applyEdgeStyle(edge)) });
      reportGraphHealthIssues(stage, repaired.issues);
      return repaired;
    },
    [reportGraphHealthIssues]
  );

  const expansionDirectionForNode = useCallback(
    (_node: Node<TurnNodeData>): MiniMapLayoutDirection => "right",
    []
  );

  const reportAnswerExpansionProgress = useCallback(
    (taskId: string, stage: AnswerExpansionProgressStage) => {
      const progressByStage: Record<AnswerExpansionProgressStage, number> = {
        prepare: 12,
        outline: 28,
        request: 55,
        validate: 78
      };
      const messageKeyByStage: Record<AnswerExpansionProgressStage, I18nKey> = {
        prepare: "task.expandAnswerPreparing",
        outline: "task.expandAnswerOutline",
        request: "task.expandAnswerRequesting",
        validate: "task.expandAnswerValidating"
      };
      reportApiTask({
        id: taskId,
        kind: "expand-answer",
        status: "running",
        message: t(messageKeyByStage[stage]),
        progress: progressByStage[stage]
      });
    },
    [reportApiTask, t]
  );

  const jumpToNodeTurn = useCallback(
    async (nodeId: string) => {
      const turn = turns.find((candidate) => candidate.id === nodeId);
      if (!turn) {
        setJumpFeedback({ kind: "error", message: t("jump.missingTurn") });
        return;
      }

      const requestId = (jumpRequestId.current += 1);
      setJumpFeedback({ kind: "pending", message: t("jump.inProgress", { number: turn.turnIndex + 1 }) });
      try {
        const result = await jumpToTurnInActiveTab(
          {
            type: "TURNMAP_JUMP_TO_TURN",
            navigation: turn.navigation,
            anchor: turn.sourceAnchor,
            promptText: turn.navigation?.site === "chatgpt" ? turn.userText : undefined
          },
          sourceTabId
        );

        if (requestId !== jumpRequestId.current) return;
        if (!result.ok) {
          const reason = result.reason ?? t("jump.failed");
          setJumpFeedback({ kind: "error", message: reason });
          onStatus?.(reason);
          return;
        }
        setJumpFeedback({ kind: "success", message: t("jump.succeeded", { number: turn.turnIndex + 1 }) });
      } catch (error) {
        if (requestId !== jumpRequestId.current) return;
        const reason = error instanceof Error ? error.message : t("jump.failed");
        setJumpFeedback({ kind: "error", message: reason });
        onStatus?.(reason);
      }
    },
    [onStatus, sourceTabId, t, turns]
  );

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      setNodes((currentNodes) =>
        currentNodes.map((candidate) => ({
          ...candidate,
          selected: candidate.id === nodeId
        }))
      );
      setSelectedEdgeId(null);
      setSelectedRoot(false);
      flowInstance.current?.setCenter(node.position.x + 150, node.position.y + 95, {
        duration: 420,
        zoom: 1.1
      });
      onStatus?.(`Focused ${node.data.title}`);
    },
    [nodes, onStatus, setNodes]
  );

  useEffect(() => {
    autoSummarizedNodeIds.current = new Set();
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    void loadAiSettings().then((settings) => {
      if (!cancelled) {
        setAutoSummarize(Boolean(settings.autoSummarize));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const applyUiSettings = (settings: UiSettings) => {
      const style = settings.linkConnectionStyle;
      activeLinkConnectionStyle = style;
      setLinkConnectionStyle(style);
      setLayoutMode(settings.defaultLayout);
      setGraphLayoutSettings((current) =>
        sameConversationGraphLayoutSettings(current, settings.conversationGraphLayout)
          ? current
          : settings.conversationGraphLayout
      );
      updateNodeSizeSettings({
        defaultNodeWidth: settings.defaultNodeWidth,
        defaultNodeHeight: settings.defaultNodeHeight,
        defaultNodePromptRatio: settings.defaultNodePromptRatio
      });
      setEdges((currentEdges) => currentEdges.map((edge) => applyEdgeStyle(edge, style)));
      setPendingSuggestedEdges((currentEdges) => currentEdges.map((edge) => applyEdgeStyle(edge, style)));
    };

    const refreshUiSettings = () => {
      void loadUiSettings().then((settings) => {
        if (!cancelled) applyUiSettings(settings);
      });
    };

    refreshUiSettings();
    const listener = (_changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "local" && UI_SETTINGS_STORAGE_KEYS.some((key) => key in _changes)) {
        refreshUiSettings();
      }
    };
    chrome.storage.onChanged.addListener(listener);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [setEdges, updateNodeSizeSettings]);

  const summarizeNode = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
      if (!node || node.data.isConversationRoot) return;

      const turn = node.data.turn;
      const isAiNote = canSummarizeAiNote(node.data);
      const sourceTurns = isAiNote ? resolveSourceTurnsForAnchors(turns, node.data.sourceAnchors) : [];

      if (!turn && !isAiNote) return;
      if (turn && !hasSummarizableTurnField(node.data)) {
        reportApiTask({
          id: `summarize-${conversationId}-${nodeId}-skipped`,
          kind: "summarize",
          status: "success",
          message: t("task.summarizeSkippedEdited"),
          progress: 100
        });
        return;
      }
      if (isAiNote && sourceTurns.length === 0) {
        reportApiTask({
          id: `summarize-${conversationId}-${nodeId}-no-source`,
          kind: "summarize",
          status: "error",
          message: t("task.summarizeNoteNeedsSource"),
          progress: 100
        });
        return;
      }

      setSummarizingNodeIds((currentIds) => new Set(currentIds).add(nodeId));
      const taskId = `summarize-${conversationId}-${nodeId}`;
      reportApiTask({
        id: taskId,
        kind: "summarize",
        status: "running",
        message: turn
          ? t("task.summarizeOne", { current: turn.turnIndex + 1 })
          : t("task.summarizeNote", { count: sourceTurns.length }),
        progress: 5
      });

      try {
        const summary = turn ? await summarizeTurn(turn) : await summarizeTurns(sourceTurns);
        let blocked = false;
        setNodes((currentNodes) =>
          currentNodes.map((currentNode) => {
            if (currentNode.id !== nodeId) return currentNode;
            if (currentNode.data.turn) {
              const protectedSummary = applyProtectedTurnSummary(currentNode.data, summary);
              blocked = protectedSummary.blocked;
              if (protectedSummary.blocked) return currentNode;
              return withContentFittingDimensions(currentNode, {
                ...currentNode.data,
                ...protectedSummary.updates
              }, nodeSizeSettings);
            }
            return withContentFittingDimensions(currentNode, {
              ...currentNode.data,
              title: summary.title,
              summary: summary.summary
            }, nodeSizeSettings);
          })
        );
        reportApiTask({
          id: taskId,
          kind: "summarize",
          status: "success",
          message: blocked
            ? t("task.summarizeSkippedEdited")
            : turn
              ? t("task.summarizeOneDone", { current: turn.turnIndex + 1 })
              : t("task.summarizeNoteDone"),
          progress: 100
        });
      } catch (error) {
        reportApiTask({
          id: taskId,
          kind: "summarize",
          status: "error",
          message: error instanceof Error ? error.message : t("task.summarizeFailed"),
          progress: 100
        });
      } finally {
        setSummarizingNodeIds((currentIds) => {
          const nextIds = new Set(currentIds);
          nextIds.delete(nodeId);
          return nextIds;
        });
      }
    },
    [conversationId, nodeSizeSettings, reportApiTask, setNodes, t, turns]
  );

  const expandNodeAnswer = useCallback(
    async (nodeId: string, replaceExisting = false) => {
      const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
      if (!node?.data.turn || node.data.isConversationRoot) return;
      if (node.data.answerExpansion && !replaceExisting) {
        setNodes((currentNodes) =>
          currentNodes.map((currentNode) =>
            currentNode.id === nodeId && currentNode.data.answerExpansion
              ? withContentFittingDimensions(currentNode, {
                  ...currentNode.data,
                answerExpansion: {
                  ...currentNode.data.answerExpansion,
                  displayMode: "expanded",
                  updatedAt: new Date().toISOString()
                }
              }, nodeSizeSettings)
              : currentNode
          )
        );
        return;
      }
      if (replaceExisting && node.data.answerExpansion && !window.confirm(t("app.confirm.reexpandAnswer"))) {
        return;
      }

      const taskId = `expand-answer-${conversationId}-${nodeId}`;
      setExpandingNodeIds((currentIds) => new Set(currentIds).add(nodeId));
      reportApiTask({
        id: taskId,
        kind: "expand-answer",
        status: "running",
        message: t("task.expandAnswer"),
        progress: 10
      });

      try {
        const direction = expansionDirectionForNode(node);
        const expansion = {
          ...(await expandTurnAnswer(node.data.turn, node.data.summary, {
            onProgress: (stage) => reportAnswerExpansionProgress(taskId, stage)
          })),
          layoutDirection: direction,
          updatedAt: new Date().toISOString()
        } satisfies AnswerExpansion;
        reportApiTask({
          id: taskId,
          kind: "expand-answer",
          status: "running",
          message: t("task.expandAnswerLayout"),
          progress: 90
        });
        const targetDimensions = expandedContentDimensions(expansion);
        setNodes((currentNodes) =>
          currentNodes.map((currentNode) =>
            currentNode.id === nodeId
              ? (() => {
                  const previousWidth = Number(currentNode.style?.width ?? currentNode.data.dimensions?.width ?? 300);
                  const width = replaceExisting ? targetDimensions.width : Math.max(previousWidth, targetDimensions.width);
                  const height = targetDimensions.height;
                  return {
                    ...currentNode,
                    position:
                      direction === "left"
                        ? {
                            ...currentNode.position,
                            x: currentNode.position.x - Math.max(0, width - previousWidth)
                          }
                        : currentNode.position,
                    style: {
                      ...currentNode.style,
                      width,
                      height
                    },
                    data: {
                      ...currentNode.data,
                      dimensions: {
                        width,
                        height,
                        manual: false
                      },
                      answerExpansion: expansion
                    }
                  };
                })()
              : currentNode
          )
        );
        window.setTimeout(() => {
          flowInstance.current?.fitView({ nodes: [{ id: nodeId }], padding: 0.18, duration: 300 });
        }, 80);
        reportApiTask({
          id: taskId,
          kind: "expand-answer",
          status: "success",
          message: t("task.expandAnswerDone"),
          progress: 100
        });
      } catch (error) {
        reportApiTask({
          id: taskId,
          kind: "expand-answer",
          status: "error",
          message: error instanceof Error ? error.message : t("task.expandAnswerFailed"),
          progress: 100
        });
        onStatus?.(t("task.expandAnswerFailed"));
      } finally {
        setExpandingNodeIds((currentIds) => {
          const nextIds = new Set(currentIds);
          nextIds.delete(nodeId);
          return nextIds;
        });
      }
    },
    [
      conversationId,
      expansionDirectionForNode,
      onStatus,
      reportAnswerExpansionProgress,
      reportApiTask,
      setNodes,
      t
    ]
  );

  const setSelectedNodeExpansionMode = useCallback(
    (displayMode: "expanded" | "original") => {
      const nodeId = selectedTurnNodes[0]?.id;
      if (!nodeId) return;
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId && node.data.answerExpansion
            ? withContentFittingDimensions(node, {
                ...node.data,
                collapsed: false,
                answerExpansion: {
                  ...node.data.answerExpansion,
                  displayMode,
                  updatedAt: new Date().toISOString()
                }
              }, nodeSizeSettings)
            : node
        )
      );
    },
    [nodeSizeSettings, selectedTurnNodes, setNodes]
  );

  const deleteSelectedNodeExpansion = useCallback(() => {
    const nodeId = selectedTurnNodes[0]?.id;
    if (!nodeId || !window.confirm(t("app.confirm.deleteExpansion"))) return;
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? withContentFittingDimensions(node, {
                ...node.data,
                collapsed: false,
                answerExpansion: undefined
              }, nodeSizeSettings)
          : node
      )
    );
    onStatus?.(t("status.expansionDeleted"));
  }, [nodeSizeSettings, onStatus, selectedTurnNodes, setNodes, t]);

  const summarizeAllNodes = useCallback(async () => {
    if (summarizingNodeIds.size > 0) return;
    const candidates = nodes.filter(
      (node) => node.data.turn && !node.data.isConversationRoot && hasSummarizableTurnField(node.data)
    );
    if (candidates.length === 0) return;

    setSummarizingNodeIds(new Set(candidates.map((node) => node.id)));
    const taskId = `summarize-all-${conversationId}`;
    reportApiTask({
      id: taskId,
      kind: "summarize",
      status: "running",
      message: t("task.summarizeAll", { total: candidates.length }),
      progress: 0
    });
    let completed = 0;
    let failed = false;

    for (const node of candidates) {
      const turn = node.data.turn;
      if (!turn) continue;
      try {
        const summary = await summarizeTurn(turn);
        let updated = false;
        setNodes((currentNodes) =>
          currentNodes.map((node) =>
            node.id === turn.id
              ? (() => {
                  const protectedSummary = applyProtectedTurnSummary(node.data, summary);
                  if (protectedSummary.blocked) return node;
                  updated = true;
                  return withContentFittingDimensions(node, {
                    ...node.data,
                    ...protectedSummary.updates
                  }, nodeSizeSettings);
                })()
              : node
          )
        );
        if (updated) {
          completed += 1;
        }
        reportApiTask({
          id: taskId,
          kind: "summarize",
          status: "running",
          message: t("task.summarizeProgress", { current: completed, total: candidates.length }),
          progress: Math.round((completed / candidates.length) * 100)
        });
      } catch (error) {
        reportApiTask({
          id: taskId,
          kind: "summarize",
          status: "error",
          message: error instanceof Error ? error.message : t("task.summarizeFailed"),
          progress: Math.round((completed / candidates.length) * 100)
        });
        failed = true;
        break;
      } finally {
        setSummarizingNodeIds((currentIds) => {
          const nextIds = new Set(currentIds);
          nextIds.delete(turn.id);
          return nextIds;
        });
      }
    }

    if (!failed) {
      reportApiTask({
        id: taskId,
        kind: "summarize",
        status: "success",
        message: t("task.summarizeAllDone", { total: completed }),
        progress: 100
      });
    }
  }, [conversationId, nodeSizeSettings, nodes, reportApiTask, setNodes, summarizingNodeIds.size, t]);

  useEffect(() => {
    let cancelled = false;
    const loadingConversationId = conversationId;
    const shouldRebuild = rebuildRequest > 0 && appliedRebuildRequest.current !== rebuildRequest;
    const shouldResetGraph = graphResetRequest > 0 && appliedGraphResetRequest.current !== graphResetRequest;
    loadedConversationId.current = null;
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (historyTimer.current) {
      window.clearTimeout(historyTimer.current);
      historyTimer.current = null;
    }

    const storedGraphRequest = shouldResetGraph
      ? resetStoredGraph(conversationId).then(() => loadStoredGraph(conversationId))
      : loadStoredGraph(conversationId);
    Promise.all([storedGraphRequest, loadUiSettings()]).then(
      ([storedGraph, uiSettings]) => {
      if (cancelled) return;

      const activeConnectionStyle = uiSettings.linkConnectionStyle;
      activeLinkConnectionStyle = activeConnectionStyle;
      setLinkConnectionStyle(activeConnectionStyle);
      const activeNodeSizeSettings = {
        defaultNodeWidth: uiSettings.defaultNodeWidth,
        defaultNodeHeight: uiSettings.defaultNodeHeight,
        defaultNodePromptRatio: uiSettings.defaultNodePromptRatio
      };
      updateNodeSizeSettings(activeNodeSizeSettings);
      const activeLayout = uiSettings.defaultLayout;
      const activeGraphLayoutSettings = uiSettings.conversationGraphLayout;
      const shouldMigrateSequentialLayout = activeLayout === "snake" && (
        storedGraph?.layoutSchemaVersion !== GRAPH_LAYOUT_SCHEMA_VERSION || storedGraph?.layoutMode !== "snake"
      );
      setGraphLayoutSettings((current) =>
        sameConversationGraphLayoutSettings(current, activeGraphLayoutSettings) ? current : activeGraphLayoutSettings
      );
      const activeHiddenRoot = storedGraph?.hiddenRoot ?? false;
      const storedNodeOverrides = storedGraph?.nodeOverrides ?? {};
      const storedTurnIdMap = buildStoredTurnIdMap(turns, storedNodeOverrides);
      const savedHiddenAutoEdgeIds = shouldRebuild || shouldMigrateSequentialLayout
        ? []
        : [...new Set((storedGraph?.hiddenAutoEdgeIds ?? []).map((id) => remapCompoundId(id, storedTurnIdMap)))];
      const activeHiddenNodeIds = remapNodeIds(storedGraph?.hiddenNodeIds ?? [], storedTurnIdMap);
      const activeTopicGroups = storedGraph?.topicGroups ?? [];
      const storedCustomNodes = storedGraph?.customNodes ?? [];
      const activeNodeOverrides = remapRecordKeys(storedNodeOverrides, storedTurnIdMap);
      const activePositions = resolveLayoutPositions(
        createLayoutPositions(orderedTurns, activeLayout, activeGraphLayoutSettings),
        storedGraph?.positions ?? {},
        !shouldRebuild && activeLayout !== "snake" && storedGraph?.layoutMode === activeLayout
      );
      const autoEdgeState = autoEdgeStateFromTurns(
        orderedTurns,
        activeLayout,
        activeHiddenRoot,
        savedHiddenAutoEdgeIds,
        activeGraphLayoutSettings
      );
      const activeHiddenAutoEdgeIds = autoEdgeState.hiddenAutoEdgeIds;
      setLayoutMode(activeLayout);
      setHiddenRoot(activeHiddenRoot);
      setHiddenAutoEdgeIds(activeHiddenAutoEdgeIds);
      setHiddenNodeIds(activeHiddenNodeIds);
      setTopicGroups(activeTopicGroups);
      const autoEdges = autoEdgeState.visibleAutoEdges.map((edge) => applyEdgeStyle(edge, activeConnectionStyle));
      const nodeIds = new Set([
        ...(activeHiddenRoot ? [] : ["conversation-root"]),
        ...orderedTurns.filter((turn) => !activeHiddenNodeIds.includes(turn.id)).map((turn) => turn.id),
        ...storedCustomNodes.map((node) => node.id)
      ]);
      const validUserEdges = filterRestoredUserEdges(
        (storedGraph?.userEdges ?? []).map((edge) => remapStoredEdge(edge, storedTurnIdMap)),
        nodeIds
      ).filter((edge) => edgeHasExistingNodes(edge, nodeIds));
      const nextNodes = nodesFromTurns(
        conversationTitle,
        orderedTurns,
        activePositions,
        activeNodeOverrides,
        updateNodeText,
        summarizeNode,
        jumpToNodeTurn,
        new Set(),
        activeHiddenNodeIds,
        storedCustomNodes,
        activeHiddenRoot,
        activeLayout,
        activeNodeSizeSettings,
        activeGraphLayoutSettings
      );
      const nextEdges = [...autoEdges, ...validUserEdges.map((edge) => applyEdgeStyle(edge, activeConnectionStyle))];
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedEdgeId((edgeId) =>
        edgeId && validUserEdges.some((edge) => edge.id === edgeId) ? edgeId : null
      );
      setSelectedRoot(false);
      setUndoStack([]);
      setRedoStack([]);
      lastHistorySnapshot.current = cloneSnapshot({
        nodes: nextNodes,
        edges: nextEdges,
        hiddenRoot: activeHiddenRoot,
        hiddenAutoEdgeIds: activeHiddenAutoEdgeIds,
        hiddenNodeIds: activeHiddenNodeIds,
        topicGroups: activeTopicGroups
      });
      loadedConversationId.current = loadingConversationId;
      if (shouldRebuild || shouldMigrateSequentialLayout) {
        void saveStoredGraph(
          loadingConversationId,
          nextNodes,
          validUserEdges,
          activeLayout,
          activeHiddenRoot,
          activeHiddenAutoEdgeIds,
          activeHiddenNodeIds,
          activeTopicGroups
        );
      }
      if (shouldRebuild) {
        appliedRebuildRequest.current = rebuildRequest;
        onStatus?.(t("app.status.rebuilt", { count: turns.length }));
      }
      if (shouldResetGraph) {
        appliedGraphResetRequest.current = graphResetRequest;
      }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [
    conversationId,
    conversationTitle,
    onStatus,
    rebuildRequest,
    graphResetRequest,
    setEdges,
    setNodes,
    summarizeNode,
    jumpToNodeTurn,
    t,
    orderedTurns,
    updateNodeSizeSettings,
    updateNodeText
  ]);

  useEffect(() => {
    if (loadedConversationId.current !== conversationId || orderedTurns.length === 0) return;

    const positions = createLayoutPositions(orderedTurns, layoutMode, graphLayoutSettings);
    setNodes((currentNodes) => {
      let changed = false;
      const nextNodes = currentNodes.map((node) => {
        const position = positions[node.id];
        if (!position) return node;
        if (
          node.position.x === position.x &&
          node.position.y === position.y &&
          node.draggable === (layoutMode === "snake" ? false : true)
        ) {
          return node;
        }
        changed = true;
        return { ...node, position, draggable: layoutMode === "snake" ? false : true };
      });
      return changed ? nextNodes : currentNodes;
    });

    const autoEdgeState = autoEdgeStateFromTurns(
      orderedTurns,
      layoutMode,
      hiddenRoot,
      hiddenAutoEdgeIds,
      graphLayoutSettings
    );
    setHiddenAutoEdgeIds((current) =>
      current.length === autoEdgeState.hiddenAutoEdgeIds.length &&
      current.every((id, index) => id === autoEdgeState.hiddenAutoEdgeIds[index])
        ? current
        : autoEdgeState.hiddenAutoEdgeIds
    );
    setEdges((currentEdges) => [
      ...autoEdgeState.visibleAutoEdges.map((edge) => applyEdgeStyle(edge, linkConnectionStyle)),
      ...currentEdges.filter((edge) => !isAutoEdge(edge))
    ]);
  }, [
    conversationId,
    graphLayoutSettings,
    layoutMode,
    hiddenAutoEdgeIds,
    hiddenRoot,
    linkConnectionStyle,
    orderedTurns,
    setEdges,
    setNodes
  ]);

  const scheduleSave = useCallback(
    (nextNodes: Node<TurnNodeData>[], nextEdges: Edge[]) => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }

      if (loadedConversationId.current !== conversationId) return;
      if (!graphNodesMatchTurns(nextNodes, turns, hiddenNodeIds)) return;

      saveTimer.current = window.setTimeout(() => {
        if (loadedConversationId.current !== conversationId) return;
        if (!graphNodesMatchTurns(nextNodes, turns, hiddenNodeIds)) return;

        void saveStoredGraph(
          conversationId,
          nextNodes,
          nextEdges.filter((edge) => !isAutoEdge(edge)),
          layoutMode,
          hiddenRoot,
          hiddenAutoEdgeIds,
          hiddenNodeIds,
          topicGroups
        );
      }, 250);
    },
    [conversationId, hiddenAutoEdgeIds, hiddenNodeIds, hiddenRoot, layoutMode, topicGroups, turns]
  );

  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onSummarize: summarizeNode,
          onJump: jumpToNodeTurn,
          onResize: updateNodeDimensions,
          onMiniNodeUpdate: updateMiniNodeInExpansion,
          onMiniNodeDelete: deleteMiniNodeFromExpansion,
          onMiniNodeSelect: selectMiniNode,
          isSummarizing: summarizingNodeIds.has(node.id)
        }
      }))
    );
  }, [
    deleteMiniNodeFromExpansion,
    jumpToNodeTurn,
    setNodes,
    selectMiniNode,
    summarizeNode,
    summarizingNodeIds,
    updateMiniNodeInExpansion,
    updateNodeDimensions
  ]);

  useEffect(() => {
    if (nodes.length === 0) return;
    if (loadedConversationId.current !== conversationId) return;
    if (!graphNodesMatchTurns(nodes, turns, hiddenNodeIds)) return;
    scheduleSave(nodes, edges);
  }, [conversationId, edges, hiddenNodeIds, nodes, scheduleSave, turns]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const snapshot = currentSnapshot();
    if (!lastHistorySnapshot.current) {
      lastHistorySnapshot.current = cloneSnapshot(snapshot);
      return;
    }
    if (restoringHistory.current) return;

    if (historyTimer.current) {
      window.clearTimeout(historyTimer.current);
    }

    historyTimer.current = window.setTimeout(() => {
      const previous = lastHistorySnapshot.current;
      if (!previous || snapshotKey(previous) === snapshotKey(snapshot)) return;
      setUndoStack((currentStack) => [...currentStack.slice(-29), cloneSnapshot(previous)]);
      setRedoStack([]);
      lastHistorySnapshot.current = cloneSnapshot(snapshot);
    }, 450);
  }, [currentSnapshot, edges, hiddenAutoEdgeIds, hiddenNodeIds, hiddenRoot, nodes, topicGroups]);

  useEffect(() => {
    if (!autoSummarize || autoSummarizeRunning.current) return;
    const candidates = nodes
      .filter((node) => node.data.turn && !node.data.isConversationRoot && hasSummarizableTurnField(node.data))
      .filter((node) => !autoSummarizedNodeIds.current.has(node.id))
      .filter((node) => !summarizingNodeIds.has(node.id));

    if (candidates.length === 0) return;

    autoSummarizeRunning.current = true;
    let cancelled = false;

    void (async () => {
      const taskId = `auto-summarize-${conversationId}`;
      let completed = 0;
      reportApiTask({
        id: taskId,
        kind: "summarize",
        status: "running",
        message: t("task.autoSummarize", { total: candidates.length }),
        progress: 0
      });

      for (const node of candidates) {
        if (cancelled || !node.data.turn) break;
        autoSummarizedNodeIds.current.add(node.id);
        setSummarizingNodeIds((currentIds) => new Set(currentIds).add(node.id));

        try {
          const summary = await summarizeTurn(node.data.turn);
          if (cancelled) break;
          let updated = false;
          setNodes((currentNodes) =>
            currentNodes.map((currentNode) => {
              if (currentNode.id !== node.id || !currentNode.data.turn) return currentNode;
              const protectedSummary = applyProtectedTurnSummary(currentNode.data, summary);
              if (protectedSummary.blocked) return currentNode;
              updated = true;
              return withContentFittingDimensions(currentNode, {
                ...currentNode.data,
                ...protectedSummary.updates
              }, nodeSizeSettings);
            })
          );
          if (updated) {
            completed += 1;
          }
          reportApiTask({
            id: taskId,
            kind: "summarize",
            status: "running",
            message: t("task.summarizeProgress", { current: completed, total: candidates.length }),
            progress: Math.round((completed / candidates.length) * 100)
          });
        } catch (error) {
          reportApiTask({
            id: taskId,
            kind: "summarize",
            status: "error",
            message: error instanceof Error ? error.message : t("task.autoSummarizeFailed"),
            progress: Math.round((completed / candidates.length) * 100)
          });
          break;
        } finally {
          setSummarizingNodeIds((currentIds) => {
            const nextIds = new Set(currentIds);
            nextIds.delete(node.id);
            return nextIds;
          });
        }
      }

      if (!cancelled) {
        reportApiTask({
          id: taskId,
          kind: "summarize",
          status: "success",
          message: t("task.autoSummarizeDone", { total: completed }),
          progress: 100
        });
      }
      autoSummarizeRunning.current = false;
    })();

    return () => {
      cancelled = true;
      autoSummarizeRunning.current = false;
    };
  }, [autoSummarize, conversationId, nodeSizeSettings, nodes, reportApiTask, setNodes, t]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) =>
        addEdge(
          applyEdgeStyle({
            ...connection,
            animated: false,
            label: "related",
            id: `user-${connection.source}-${connection.target}-${Date.now()}`,
            data: {
              relationship: "related",
              important: false,
              weight: DEFAULT_USER_EDGE_WEIGHT,
              createdBy: "user"
            } satisfies RelationshipEdgeData,
            style: relationshipStyle("related", false, DEFAULT_USER_EDGE_WEIGHT)
          }, linkConnectionStyle),
          currentEdges
        )
      );
    },
    [linkConnectionStyle, setEdges]
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.stopPropagation();
      setSelectedMiniNode(null);
      setSelectedRoot(false);
      setSelectedEdgeId(edge.id);
      setSelectedEdgeIds((currentIds) =>
        event.ctrlKey || event.metaKey || event.shiftKey
          ? currentIds.includes(edge.id)
            ? currentIds.filter((id) => id !== edge.id)
            : [...currentIds, edge.id]
          : [edge.id]
      );
      setHighlightedEndpointIds([]);
    },
    []
  );

  const onEdgeContextMenu = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedMiniNode(null);
      setSelectedRoot(false);
      setSelectedEdgeId(edge.id);
      setSelectedEdgeIds([edge.id]);
      setHighlightedEndpointIds([edge.source, edge.target]);
      onStatus?.("Highlighted linked nodes");
    },
    [onStatus]
  );

  const updateSelectedEdge = useCallback(
    (updates: Partial<RelationshipEdgeData> & { label?: string }) => {
      if (!selectedEdgeId) return;
      const selectedIsAutoEdge = selectedEdge ? isAutoEdge(selectedEdge) : false;
      const nextSelectedEdgeId = selectedIsAutoEdge ? `user-${selectedEdgeId}` : selectedEdgeId;

      if (selectedIsAutoEdge) {
        setHiddenAutoEdgeIds((currentIds) =>
          currentIds.includes(selectedEdgeId) ? currentIds : [...currentIds, selectedEdgeId]
        );
        setSelectedEdgeId(nextSelectedEdgeId);
      }

      setEdges((currentEdges) =>
        currentEdges.map((edge) => {
          if (edge.id !== selectedEdgeId) return edge;

          const currentData = (edge.data as RelationshipEdgeData | undefined) ?? {
            relationship: isAutoEdge(edge) ? "references" : "related",
            important: false,
            weight: isAutoEdge(edge) ? DEFAULT_AUTO_SEQUENCE_EDGE_WEIGHT : DEFAULT_USER_EDGE_WEIGHT
          };
          const nextData: RelationshipEdgeData = {
            ...currentData,
            relationship: updates.relationship ?? currentData.relationship,
            important: updates.important ?? currentData.important,
            weight: updates.weight != null ? normalizeEdgeWeight(updates.weight) : normalizeEdgeWeight(currentData.weight)
          };

          return applyEdgeStyle({
            ...edge,
            id: selectedIsAutoEdge ? nextSelectedEdgeId : edge.id,
            data: nextData,
            label: updates.label ?? edge.label
          }, linkConnectionStyle);
        })
      );
    },
    [linkConnectionStyle, selectedEdge, selectedEdgeId, setEdges]
  );

  const updateSelectedEdges = useCallback(
    (updates: Partial<RelationshipEdgeData>) => {
      if (selectedEdges.length < 2) return;
      const selectedIds = new Set(selectedEdges.map((edge) => edge.id));
      const convertedIds = new Map<string, string>();
      selectedEdges.forEach((edge) => {
        if (isAutoEdge(edge)) {
          convertedIds.set(edge.id, `user-${edge.id}`);
        }
      });
      if (convertedIds.size > 0) {
        setHiddenAutoEdgeIds((currentIds) => [...new Set([...currentIds, ...convertedIds.keys()])]);
      }
      setEdges((currentEdges) =>
        currentEdges.map((edge) => {
          if (!selectedIds.has(edge.id)) return edge;
          const currentData = (edge.data as RelationshipEdgeData | undefined) ?? {
            relationship: isAutoEdge(edge) ? "references" : "related",
            important: false,
            weight: isAutoEdge(edge) ? DEFAULT_AUTO_SEQUENCE_EDGE_WEIGHT : DEFAULT_USER_EDGE_WEIGHT
          };
          return applyEdgeStyle({
            ...edge,
            id: convertedIds.get(edge.id) ?? edge.id,
            data: {
              ...currentData,
              relationship: updates.relationship ?? currentData.relationship,
              important: updates.important ?? currentData.important,
              weight: updates.weight != null ? normalizeEdgeWeight(updates.weight) : normalizeEdgeWeight(currentData.weight)
            } satisfies RelationshipEdgeData
          }, linkConnectionStyle);
        })
      );
      const nextIds = selectedEdges.map((edge) => convertedIds.get(edge.id) ?? edge.id);
      setSelectedEdgeIds(nextIds);
      setSelectedEdgeId(null);
      onStatus?.(t("status.linksUpdated", { count: selectedEdges.length }));
    },
    [linkConnectionStyle, onStatus, selectedEdges, setEdges, t]
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<TurnNodeData>) => {
      const multiSelect = event.ctrlKey || event.metaKey || event.shiftKey;
      setSelectedMiniNode(null);
      setSelectedEdgeId(null);
      setSelectedEdgeIds([]);
      setHighlightedEndpointIds([]);

      if (node.data.isConversationRoot) {
        setSelectedRoot(true);
        setNodes((currentNodes) =>
          currentNodes.map((candidate) => ({
            ...candidate,
            selected: candidate.id === node.id
          }))
        );
        return;
      }

      setSelectedRoot(false);
      setNodes((currentNodes) =>
        currentNodes.map((candidate) => {
          if (candidate.id !== node.id) {
            return multiSelect ? candidate : { ...candidate, selected: false };
          }
          return {
            ...candidate,
            selected: multiSelect ? !candidate.selected : true
          };
        })
      );
    },
    [setNodes]
  );

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdge) return;

    if (isAutoEdge(selectedEdge)) {
      setHiddenAutoEdgeIds((currentIds) =>
        currentIds.includes(selectedEdge.id) ? currentIds : [...currentIds, selectedEdge.id]
      );
    }

    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdge.id));
    setSelectedEdgeId(null);
    setSelectedEdgeIds([]);
  }, [selectedEdge, setEdges]);

  const deleteRoot = useCallback(() => {
    setHiddenRoot(true);
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== "conversation-root"));
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== "conversation-root"));
    setSelectedRoot(false);
    onStatus?.("Conversation header deleted");
  }, [onStatus, setEdges, setNodes]);

  const mergeSelectedNodes = useCallback(() => {
    if (selectedTurnNodes.length < 2) return;

    const sortedNodes = [...selectedTurnNodes].sort(
      (left, right) => (left.data.turn?.turnIndex ?? 0) - (right.data.turn?.turnIndex ?? 0)
    );
    const sourceIds = new Set(sortedNodes.map((node) => node.id));
    const mergedId = `custom-merge-${Date.now()}`;
    const averagePosition = sortedNodes.reduce(
      (position, node) => ({
        x: position.x + node.position.x / sortedNodes.length,
        y: position.y + node.position.y / sortedNodes.length
      }),
      { x: 0, y: 0 }
    );
    const mergedTitle = `Merged: ${sortedNodes.map((node) => node.data.title).join(" / ")}`.slice(0, 120);
    const mergedSummary = sortedNodes
      .map((node) => {
        const turnLabel = node.data.turn ? `Turn ${node.data.turn.turnIndex + 1}` : "Note";
        return `${turnLabel}: ${node.data.summary}`;
      })
      .join("\n\n");
    const sourceAnchors = mergedSourceAnchorsForNodes(sortedNodes);

    setHiddenNodeIds((currentIds) => [...new Set([...currentIds, ...sourceIds])]);
    setNodes((currentNodes) => [
      ...currentNodes.filter((node) => !sourceIds.has(node.id)),
      withInitialContentFittingDimensions({
        id: mergedId,
        type: "turnNode",
        position: averagePosition,
        selected: true,
        data: {
          title: mergedTitle,
          summary: mergedSummary,
          collapsed: true,
          isCustomNode: true,
          sourceAnchors,
          onUpdate: updateNodeText
        }
      }, nodeSizeSettings)
    ]);
    setEdges((currentEdges) => {
      const seen = new Set<string>();
      return currentEdges
        .filter((edge) => !isAutoEdge(edge))
        .map((edge) => ({
          ...edge,
          source: sourceIds.has(edge.source) ? mergedId : edge.source,
          target: sourceIds.has(edge.target) ? mergedId : edge.target
        }))
        .filter((edge) => edge.source !== edge.target)
        .filter((edge) => {
          const key = `${edge.source}:${edge.target}:${edge.label ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((edge) => applyEdgeStyle(edge));
    });
    setSelectedEdgeId(null);
    setSelectedRoot(false);
    onStatus?.(`Merged ${sortedNodes.length} nodes`);
  }, [nodeSizeSettings, onStatus, selectedTurnNodes, setEdges, setNodes, updateNodeText]);

  const collapseSelectedAsTopic = useCallback(() => {
    if (selectedTurnNodes.length < 2) return;
    if (
      topicGroupHasNestedSelection({
        selectedNodeIds: selectedTurnNodes.map((node) => node.id),
        topicGroups
      })
    ) {
      onStatus?.(t("status.topicNestedRejected"));
      return;
    }

    const topic = buildCollapsedTopic({
      selectedNodes: selectedTurnNodes.map((node) => ({
        id: node.id,
        title: node.data.title,
        summary: node.data.summary,
        position: node.position,
        turnIndex: node.data.turn?.turnIndex,
        tags: node.data.tags
      }))
    });
    const sourceIds = new Set(topic.hiddenNodeIds);
    const sourceAnchors = mergedSourceAnchorsForNodes(selectedTurnNodes);
    const groupRecord = buildTopicGroupRecord({
      topic,
      selectedNodes: selectedTurnNodes.map((node) => ({
        id: node.id,
        title: node.data.title,
        summary: node.data.summary,
        position: node.position,
        turnIndex: node.data.turn?.turnIndex,
        tags: node.data.tags,
        status: node.data.status,
        color: node.data.color,
        collapsed: node.data.collapsed,
        important: node.data.important
      })),
      edges: edges.map(topicEdgeSnapshot)
    });
    const proxyEdges = buildTopicProxyEdges({
      topicNodeId: topic.id,
      topicGroupId: groupRecord.id,
      memberNodeIds: topic.hiddenNodeIds,
      edges: edges.map(topicEdgeSnapshot)
    }).map((edge) =>
      applyEdgeStyle({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === "string" ? edge.label : undefined,
        data: {
          ...((edge.data as RelationshipEdgeData | undefined) ?? { relationship: "related" }),
          originalEdgeId: edge.originalEdgeId,
          proxyKind: edge.proxyKind,
          topicGroupId: edge.topicGroupId,
          weight: edge.weight,
          createdBy: "user",
          reason: "Collapsed topic group"
        } satisfies RelationshipEdgeData
      })
    );

    setTopicGroups((currentGroups) => [...currentGroups, groupRecord]);
    setHiddenNodeIds((currentIds) => [...new Set([...currentIds, ...topic.hiddenNodeIds])]);
    setNodes((currentNodes) => [
      ...currentNodes
        .filter((node) => !sourceIds.has(node.id))
        .map((node) => ({ ...node, selected: false })),
      withInitialContentFittingDimensions({
        id: topic.id,
        type: "turnNode",
        position: topic.position,
        selected: true,
        data: {
          title: topic.title,
          summary: topic.summary,
          collapsed: true,
          isCustomNode: true,
          status: "review",
          tags: topic.tags,
          sourceAnchors,
          topicGroupId: groupRecord.id,
          topicGroupMemberIds: topic.hiddenNodeIds,
          onUpdate: updateNodeText
        }
      }, nodeSizeSettings)
    ]);
    setEdges((currentEdges) => {
      const keptEdges = currentEdges.filter(
        (edge) => !sourceIds.has(edge.source) && !sourceIds.has(edge.target)
      );
      return [...keptEdges, ...proxyEdges].map((edge) => applyEdgeStyle(edge));
    });
    setSelectedEdgeId(null);
    setSelectedRoot(false);
    onStatus?.(t("status.topicCollapsed", { count: topic.hiddenNodeIds.length }));
  }, [edges, nodeSizeSettings, onStatus, selectedTurnNodes, setEdges, setNodes, t, topicGroups, updateNodeText]);

  const expandTopicGroup = useCallback(
    (groupId: string) => {
      const group = topicGroups.find((candidate) => candidate.id === groupId);
      if (!group) return;
      const memberIds = new Set(group.memberNodeIds);
      const snapshotById = new Map(group.nodeSnapshots.map((node) => [node.id, node]));
      const restoredNodes: Node<TurnNodeData>[] = group.memberNodeIds.map((nodeId) => {
        const snapshot = snapshotById.get(nodeId);
        const turn = turns.find((candidate) => candidate.id === nodeId);
        const title = snapshot?.title ?? (turn ? titleFromTurn(turn) : nodeId);
        const summary = snapshot?.summary ?? (turn ? summaryFromTurn(turn) : "");
        return {
          id: nodeId,
          type: "turnNode",
          dragHandle: ".turn-node__drag-handle",
          position: snapshot?.position ?? { x: 0, y: 0 },
          selected: true,
          style: nodeDimensionsStyle(undefined, { width: 280, height: 220 }),
          data: {
            title,
            summary,
            turn,
            status: snapshot?.status,
            tags: normalizeNodeTags(snapshot?.tags),
            color: isNodeColorName(snapshot?.color) ? snapshot.color : undefined,
            collapsed: snapshot?.collapsed ?? true,
            important: snapshot?.important,
            sourceAnchors: turn?.sourceAnchor ? [turn.sourceAnchor] : undefined,
            onUpdate: updateNodeText,
            onSummarize: summarizeNode,
            onJump: jumpToNodeTurn
          }
        };
      });

      setTopicGroups((currentGroups) => currentGroups.filter((candidate) => candidate.id !== groupId));
      setHiddenNodeIds((currentIds) => currentIds.filter((nodeId) => !memberIds.has(nodeId)));
      setNodes((currentNodes) => [
        ...currentNodes
          .filter((node) => node.id !== group.topicNodeId && !memberIds.has(node.id))
          .map((node) => ({ ...node, selected: false })),
        ...restoredNodes
      ]);
      setEdges((currentEdges) => {
        const existingIds = new Set<string>();
        const keptEdges = currentEdges
          .filter((edge) => edge.source !== group.topicNodeId && edge.target !== group.topicNodeId)
          .filter((edge) => !isTopicProxyEdge(edge))
          .map((edge) => {
            existingIds.add(edge.id);
            return edge;
          });
        const restoredEdges = group.edgeSnapshots
          .filter((edge) => !existingIds.has(edge.id))
          .map((edge) =>
            applyEdgeStyle({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: typeof edge.label === "string" ? edge.label : undefined,
              data: edge.data as Edge["data"]
            })
          );
        return [...keptEdges, ...restoredEdges];
      });
      setSelectedEdgeId(null);
      setSelectedEdgeIds([]);
      setSelectedRoot(false);
      onStatus?.(t("status.topicExpanded", { count: group.memberNodeIds.length }));
    },
    [jumpToNodeTurn, onStatus, setEdges, setNodes, summarizeNode, t, topicGroups, turns, updateNodeText]
  );

  const duplicateSelectedNodeAsNote = useCallback(() => {
    const sourceNode = selectedTurnNodes[0];
    if (!sourceNode?.data.turn) return;

    const noteId = `custom-note-${Date.now()}`;
    const sourceAnchors = sourceAnchorsFromNodeData(sourceNode.data);
    setNodes((currentNodes) => [
      ...currentNodes.map((node) => ({ ...node, selected: false })),
      withInitialContentFittingDimensions({
        id: noteId,
        type: "turnNode",
        position: {
          x: sourceNode.position.x + 340,
          y: sourceNode.position.y + 40
        },
        selected: true,
        data: {
          title: `Note: ${sourceNode.data.title}`.slice(0, 120),
          summary: sourceNode.data.summary,
          collapsed: true,
          isCustomNode: true,
          sourceAnchors,
          onUpdate: updateNodeText
        }
      }, nodeSizeSettings)
    ]);
    setSelectedEdgeId(null);
    setSelectedRoot(false);
    onStatus?.(`Duplicated turn ${sourceNode.data.turn.turnIndex + 1} as note`);
  }, [nodeSizeSettings, onStatus, selectedTurnNodes, setNodes, updateNodeText]);

  const splitSelectedNode = useCallback(() => {
    const sourceNode = selectedTurnNodes[0];
    if (!sourceNode) return;
    const paragraphs = sourceNode.data.summary
      .split(/\n{2,}|(?<=。)|(?<=\.)\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const midpoint = Math.max(1, Math.ceil(paragraphs.length / 2));
    const parts =
      paragraphs.length >= 2
        ? [paragraphs.slice(0, midpoint).join(" "), paragraphs.slice(midpoint).join(" ")]
        : [sourceNode.data.summary.slice(0, Math.ceil(sourceNode.data.summary.length / 2)), sourceNode.data.summary.slice(Math.ceil(sourceNode.data.summary.length / 2))];
    const splitTime = Date.now();
    const splitIds = [`custom-split-${splitTime}-a`, `custom-split-${splitTime}-b`];
    const sourceAnchors = sourceAnchorsFromNodeData(sourceNode.data);
    const splitNodes: Node<TurnNodeData>[] = splitIds.map((id, index) => withInitialContentFittingDimensions({
      id,
      type: "turnNode",
      position: {
        x: sourceNode.position.x + (index === 0 ? -170 : 170),
        y: sourceNode.position.y + 230
      },
      selected: true,
      data: {
        title: `${sourceNode.data.title} (${index + 1})`.slice(0, 120),
        summary: parts[index] || sourceNode.data.summary,
        collapsed: true,
        isCustomNode: true,
        status: sourceNode.data.status,
        tags: sourceNode.data.tags,
        sourceAnchors,
        onUpdate: updateNodeText
      }
    }, nodeSizeSettings));

    setHiddenNodeIds((currentIds) =>
      sourceNode.data.turn ? [...new Set([...currentIds, sourceNode.id])] : currentIds
    );
    setNodes((currentNodes) => [
      ...currentNodes.filter((node) => node.id !== sourceNode.id || (!sourceNode.data.turn && !sourceNode.data.isCustomNode)),
      ...splitNodes
    ]);
    setEdges((currentEdges) =>
      currentEdges
        .filter((edge) => !isAutoEdge(edge))
        .flatMap((edge) => {
          if (edge.source === sourceNode.id) {
            return splitIds.map((id) => applyEdgeStyle({ ...edge, id: `${edge.id}-${id}`, source: id }));
          }
          if (edge.target === sourceNode.id) {
            return splitIds.map((id) => applyEdgeStyle({ ...edge, id: `${edge.id}-${id}`, target: id }));
          }
          return [edge];
        })
    );
    setSelectedEdgeId(null);
    setSelectedRoot(false);
    onStatus?.("Split node into two notes");
  }, [nodeSizeSettings, onStatus, selectedTurnNodes, setEdges, setNodes, updateNodeText]);

  const selectAllTurnNodes = useCallback(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        selected: Boolean(node.data.turn && !node.data.isConversationRoot)
      }))
    );
    setSelectedEdgeId(null);
    setSelectedRoot(false);
    onStatus?.("Selected all turn nodes");
  }, [onStatus, setNodes]);

  const applyBulkStatus = useCallback(
    (status: "open" | "review" | "done") => {
      if (selectedTurnNodes.length === 0) return;
      const selectedIds = new Set(selectedTurnNodes.map((node) => node.id));
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          selectedIds.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  status
                }
              }
            : node
        )
      );
      onStatus?.(`Set ${selectedTurnNodes.length} nodes to ${status}`);
    },
    [onStatus, selectedTurnNodes, setNodes]
  );

  const selectedTagUnion = useMemo(
    () => [...new Set(selectedTurnNodes.flatMap((node) => node.data.tags ?? []))].sort(),
    [selectedTurnNodes]
  );

  const addBulkTag = useCallback(() => {
    if (!tagDraft.trim() || selectedTurnNodes.length === 0) return;
    const cleanTag = tagDraft.trim().slice(0, 32);
    const selectedIds = new Set(selectedTurnNodes.map((node) => node.id));
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        selectedIds.has(node.id)
          ? {
              ...node,
              data: {
              ...node.data,
                tags: normalizeNodeTags([...(node.data.tags ?? []), cleanTag])
              }
            }
          : node
      )
    );
    setTagDraft("");
    onStatus?.(t("status.tagAdded", { count: selectedTurnNodes.length }));
  }, [onStatus, selectedTurnNodes, setNodes, t, tagDraft]);

  const removeBulkTag = useCallback(
    (tag: string) => {
      if (!tag || selectedTurnNodes.length === 0) return;
      const selectedIds = new Set(selectedTurnNodes.map((node) => node.id));
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          selectedIds.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  tags: normalizeNodeTags((node.data.tags ?? []).filter((currentTag) => currentTag !== tag))
                }
              }
            : node
        )
      );
      onStatus?.(t("status.tagRemoved", { tag, count: selectedTurnNodes.length }));
    },
    [onStatus, selectedTurnNodes, setNodes, t]
  );

  const updateSelectedNodeAppearance = useCallback(
    (updates: Pick<Partial<TurnNodeData>, "color" | "collapsed" | "important">) => {
      if (selectedTurnNodes.length === 0) return;
      const selectedIds = new Set(selectedTurnNodes.map((node) => node.id));
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          selectedIds.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...updates
                }
              }
            : node
        )
      );
    },
    [selectedTurnNodes, setNodes]
  );

  const toggleSelectedNodeCollapsed = useCallback(() => {
    if (selectedTurnNodes.length === 0) return;
    const shouldCollapse = selectedTurnNodes.some((node) => !node.data.collapsed);
    const selectedIds = new Set(selectedTurnNodes.map((node) => node.id));
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (!selectedIds.has(node.id)) return node;
        return withContentFittingDimensions(node, {
          ...node.data,
          collapsed: shouldCollapse,
          dimensions: shouldCollapse || isAutoCollapsedDimensions(node.data.dimensions) ? undefined : node.data.dimensions
        }, nodeSizeSettings);
      })
    );
    onStatus?.(shouldCollapse ? t("status.nodesCollapsed") : t("status.nodesExpanded"));
  }, [nodeSizeSettings, onStatus, selectedTurnNodes, setNodes, t]);

  const resetSelectedNodeSize = useCallback(() => {
    if (selectedTurnNodes.length === 0) return;
    const selectedIds = new Set(selectedTurnNodes.map((node) => node.id));
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (!selectedIds.has(node.id)) return node;
        return withContentFittingDimensions(node, {
          ...node.data,
          dimensions: undefined
        }, nodeSizeSettings);
      })
    );
    onStatus?.(t("status.nodeSizeRestored"));
  }, [nodeSizeSettings, onStatus, selectedTurnNodes, setNodes, t]);

  const rebuildSelectedNode = useCallback(() => {
    const selectedIds = new Set(selectedTurnNodes.map((node) => node.id));
    if (selectedIds.size === 0) return;
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (!selectedIds.has(node.id)) return node;
        const rebuiltData = node.data.turn
          ? {
              ...node.data,
              title: titleFromTurn(node.data.turn),
              summary: summaryFromTurn(node.data.turn),
              status: undefined,
              tags: [],
              color: undefined,
              collapsed: true,
              important: undefined,
              dimensions: undefined,
              answerExpansion: undefined,
              topicGroupId: undefined,
              topicGroupMemberIds: undefined,
              sourceAnchors: [node.data.turn.sourceAnchor]
            }
          : {
              ...node.data,
              status: undefined,
              tags: [],
              color: undefined,
              collapsed: true,
              important: undefined,
              dimensions: undefined,
              answerExpansion: undefined,
              topicGroupId: undefined,
              topicGroupMemberIds: undefined
            };
        return withContentFittingDimensions(node, rebuiltData, nodeSizeSettings);
      })
    );
    onStatus?.(t("status.nodeRebuilt"));
  }, [nodeSizeSettings, onStatus, selectedTurnNodes, setNodes, t]);

  const toggleSelectedNodeImportant = useCallback(() => {
    if (selectedTurnNodes.length === 0) return;
    const important = selectedTurnNodes.some((node) => !node.data.important);
    updateSelectedNodeAppearance({ important });
    onStatus?.(important ? t("status.nodesImportant") : t("status.nodesNormal"));
  }, [onStatus, selectedTurnNodes, t, updateSelectedNodeAppearance]);

  const convertSelectedEdgeToNote = useCallback(() => {
    if (!selectedEdge) return;
    const sourceTitle = shortNodeTitle(nodes, selectedEdge.source);
    const targetTitle = shortNodeTitle(nodes, selectedEdge.target);
    const data = selectedEdge.data as RelationshipEdgeData | undefined;
    const noteId = `custom-edge-note-${Date.now()}`;
    const sourceNode = nodes.find((node) => node.id === selectedEdge.source);
    const targetNode = nodes.find((node) => node.id === selectedEdge.target);
    const sourceAnchors = mergeSourceAnchors(
      sourceNode ? sourceAnchorsFromNodeData(sourceNode.data) : undefined,
      targetNode ? sourceAnchorsFromNodeData(targetNode.data) : undefined
    );
    const position = {
      x: ((sourceNode?.position.x ?? 0) + (targetNode?.position.x ?? 340)) / 2,
      y: ((sourceNode?.position.y ?? 0) + (targetNode?.position.y ?? 160)) / 2 + 120
    };

    setNodes((currentNodes) => [
      ...currentNodes.map((node) => ({ ...node, selected: false })),
      withInitialContentFittingDimensions({
        id: noteId,
        type: "turnNode",
        position,
        selected: true,
        data: {
          title: `Link note: ${sourceTitle} -> ${targetTitle}`.slice(0, 120),
          summary: [
            `Relationship: ${data?.relationship ?? "related"}`,
            selectedEdge.label ? `Label: ${String(selectedEdge.label)}` : "",
            data?.reason ? `Reason: ${data.reason}` : ""
          ]
            .filter(Boolean)
            .join("\n"),
          collapsed: true,
          isCustomNode: true,
          tags: ["link-note"],
          sourceAnchors: sourceAnchors.length > 0 ? sourceAnchors : undefined,
          onUpdate: updateNodeText
        }
      }, nodeSizeSettings)
    ]);
    setEdges((currentEdges) => [
      ...currentEdges.filter((edge) => edge.id !== selectedEdge.id),
      applyEdgeStyle({
        id: `user-${selectedEdge.source}-${noteId}-${Date.now()}`,
        source: selectedEdge.source,
        target: noteId,
        label: "note",
        data: { relationship: "references" } satisfies RelationshipEdgeData
      }),
      applyEdgeStyle({
        id: `user-${noteId}-${selectedEdge.target}-${Date.now()}`,
        source: noteId,
        target: selectedEdge.target,
        label: "note",
        data: { relationship: data?.relationship ?? "related", important: data?.important } satisfies RelationshipEdgeData
      })
    ]);
    setSelectedEdgeId(null);
    onStatus?.("Converted link into note node");
  }, [nodeSizeSettings, nodes, onStatus, selectedEdge, setEdges, setNodes, updateNodeText]);

  const suggestLinks = useCallback(async () => {
    const taskId = `suggest-links-${conversationId}`;
    try {
      setSuggestingLinks(true);
      reportApiTask({
        id: taskId,
        kind: "suggest-links",
        status: "running",
        message: t("task.suggestLinks"),
        progress: 15
      });
      reportApiTask({
        id: taskId,
        kind: "suggest-links",
        status: "running",
        message: t("task.suggestLinksRequesting"),
        progress: 45
      });
      const suggestedEdges = (await suggestSemanticEdges(nodes)).map((edge) => applyEdgeStyle(edge));
      reportApiTask({
        id: taskId,
        kind: "suggest-links",
        status: "running",
        message: t("task.suggestLinksFiltering"),
        progress: 85
      });
      const existingPairs = new Set([
        ...edges.map((edge) => `${edge.source}:${edge.target}`),
        ...pendingSuggestedEdges.map((edge) => `${edge.source}:${edge.target}`)
      ]);
      const uniqueSuggestions = suggestedEdges.filter(
        (edge) => !existingPairs.has(`${edge.source}:${edge.target}`)
      );
      setPendingSuggestedEdges((currentEdges) => [...currentEdges, ...uniqueSuggestions]);
      reportApiTask({
        id: taskId,
        kind: "suggest-links",
        status: "success",
        message: t("task.suggestLinksDone", { count: uniqueSuggestions.length }),
        progress: 100
      });
    } catch (error) {
      reportApiTask({
        id: taskId,
        kind: "suggest-links",
        status: "error",
        message: error instanceof Error ? error.message : t("task.suggestLinksFailed"),
        progress: 100
      });
    } finally {
      setSuggestingLinks(false);
    }
  }, [conversationId, edges, nodes, pendingSuggestedEdges, reportApiTask, t]);

  const analyzeTopics = useCallback(() => {
    const taskId = `analyze-topics-${conversationId}`;
    try {
      setAnalyzingTopics(true);
      reportApiTask({
        id: taskId,
        kind: "analyze-topics",
        status: "running",
        message: t("task.analyzeTopics"),
        progress: 20
      });
      const existingLinks = [
        ...edges.map((edge) => ({ source: edge.source, target: edge.target })),
        ...pendingSuggestedEdges.map((edge) => ({ source: edge.source, target: edge.target }))
      ];
      const candidatePairs = buildTopicCandidatePairs(
        nodes.map((node, fallbackOrder) => ({
          id: node.id,
          title: String(node.data?.title ?? node.id),
          summary: String(node.data?.summary ?? ""),
          tags: Array.isArray(node.data?.tags) ? node.data.tags : [],
          order: node.data?.turn?.turnIndex ?? fallbackOrder
        })),
        { existingLinks }
      );
      const suggestedEdges = candidatePairs
        .map(
          (candidate): Edge =>
            applyEdgeStyle({
              id: `topic-${candidate.source}-${candidate.target}`,
              source: candidate.source,
              target: candidate.target,
              label: candidate.label,
              data: {
                relationship: candidate.relationship,
                confidence: candidate.confidence,
                weight: weightFromConfidence(candidate.confidence, DEFAULT_TOPIC_ANALYSIS_EDGE_WEIGHT),
                reason: candidate.reason,
                createdBy: "topic-analysis"
              } satisfies RelationshipEdgeData
            })
        )
        .filter((edge) => edge.source !== "conversation-root" && edge.target !== "conversation-root");

      setPendingSuggestedEdges((currentEdges) => [...currentEdges, ...suggestedEdges]);
      reportApiTask({
        id: taskId,
        kind: "analyze-topics",
        status: "success",
        message:
          suggestedEdges.length > 0
            ? t("task.analyzeTopicsDone", { count: suggestedEdges.length })
            : t("task.analyzeTopicsNone"),
        progress: 100
      });
    } catch (error) {
      reportApiTask({
        id: taskId,
        kind: "analyze-topics",
        status: "error",
        message: error instanceof Error ? error.message : t("task.analyzeTopicsFailed"),
        progress: 100
      });
    } finally {
      setAnalyzingTopics(false);
    }
  }, [conversationId, edges, nodes, pendingSuggestedEdges, reportApiTask, t]);

  const updatePendingSuggestion = useCallback(
    (edgeId: string, updates: Partial<RelationshipEdgeData> & { label?: string }) => {
      setPendingSuggestedEdges((currentEdges) =>
        currentEdges.map((edge) => {
          if (edge.id !== edgeId) return edge;
          const currentData = (edge.data as RelationshipEdgeData | undefined) ?? {
            relationship: "related",
            important: false,
            weight: DEFAULT_AI_EDGE_WEIGHT
          };

          return applyEdgeStyle({
            ...edge,
            label: updates.label ?? edge.label,
            data: {
              ...currentData,
              relationship: updates.relationship ?? currentData.relationship,
              important: updates.important ?? currentData.important,
              weight: updates.weight != null ? normalizeEdgeWeight(updates.weight) : normalizeEdgeWeight(currentData.weight)
            } satisfies RelationshipEdgeData
          });
        })
      );
    },
    []
  );

  const rejectPendingSuggestion = useCallback(
    (edgeId: string) => {
      setPendingSuggestedEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
      onStatus?.(t("suggestions.rejectedStatus"));
    },
    [onStatus, t]
  );

  const acceptPendingSuggestion = useCallback(
    (edgeId: string) => {
      const suggestion = pendingSuggestedEdges.find((edge) => edge.id === edgeId);
      if (!suggestion) return;

      const edgeToAdd = acceptedSuggestionEdge(suggestion);

      setEdges((currentEdges) => {
        const exists = currentEdges.some(
          (edge) => edge.source === edgeToAdd.source && edge.target === edgeToAdd.target
        );
        return exists ? currentEdges : [...currentEdges, edgeToAdd];
      });
      setPendingSuggestedEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
      onStatus?.(
        t("suggestions.acceptedStatus", {
          source: shortNodeTitle(nodes, suggestion.source),
          target: shortNodeTitle(nodes, suggestion.target)
        })
      );
    },
    [nodes, onStatus, pendingSuggestedEdges, setEdges, t]
  );

  const acceptAllPendingSuggestions = useCallback(() => {
    if (pendingSuggestedEdges.length === 0) return;
    const edgesToAdd = pendingSuggestedEdges.map(acceptedSuggestionEdge);
    setEdges((currentEdges) => {
      const existingPairs = new Set(currentEdges.map((edge) => `${edge.source}:${edge.target}`));
      const uniqueEdgesToAdd = edgesToAdd.filter((edge) => {
        const pairKey = `${edge.source}:${edge.target}`;
        if (existingPairs.has(pairKey)) return false;
        existingPairs.add(pairKey);
        return true;
      });
      return uniqueEdgesToAdd.length > 0 ? [...currentEdges, ...uniqueEdgesToAdd] : currentEdges;
    });
    setPendingSuggestedEdges([]);
    onStatus?.(t("suggestions.acceptedAllStatus", { count: pendingSuggestedEdges.length }));
  }, [onStatus, pendingSuggestedEdges, setEdges, t]);

  const clearPendingSuggestions = useCallback(() => {
    const count = pendingSuggestedEdges.length;
    setPendingSuggestedEdges([]);
    onStatus?.(t("suggestions.clearedStatus", { count }));
  }, [onStatus, pendingSuggestedEdges.length, t]);

  const exportJson = useCallback(async () => {
    const filename = `${safeFilePart(conversationTitle)}.chatmap.json`;
    const appearance = await loadExportAppearance();
    const healthy = healthyGraphSnapshot("export-json", nodes, edges);
    downloadTextFile(
      filename,
      serializeGraph(
        conversationId,
        conversationTitle,
        turns,
        healthy.nodes,
        healthy.edges,
        layoutMode,
        hiddenRoot,
        hiddenAutoEdgeIds,
        hiddenNodeIds,
        topicGroups,
        appearance
      ),
      "application/json"
    );
    onStatus?.(t("file.exported", { filename }));
  }, [
    conversationId,
    conversationTitle,
    edges,
    hiddenAutoEdgeIds,
    hiddenNodeIds,
    hiddenRoot,
    healthyGraphSnapshot,
    layoutMode,
    nodes,
    onStatus,
    topicGroups,
    turns,
    t
  ]);

  const markdown = useMemo(
    () => graphToMarkdown(conversationTitle, turns, nodes, edges),
    [conversationTitle, edges, nodes, turns]
  );

  const exportMarkdown = useCallback(() => {
    const filename = `${safeFilePart(conversationTitle)}.chatmap.md`;
    const healthy = healthyGraphSnapshot("export-markdown", nodes, edges);
    downloadTextFile(filename, graphToMarkdown(conversationTitle, turns, healthy.nodes, healthy.edges), "text/markdown;charset=utf-8");
    onStatus?.(t("file.exported", { filename }));
  }, [conversationTitle, edges, healthyGraphSnapshot, nodes, onStatus, t, turns]);

  const copyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      onStatus?.(t("file.markdownCopied"));
    } catch {
      onStatus?.(t("file.markdownCopyFailed"));
    }
  }, [markdown, onStatus, t]);

  const exportObsidianCanvas = useCallback(async () => {
    const filename = `${safeFilePart(conversationTitle)}.canvas`;
    const appearance = await loadExportAppearance();
    const healthy = healthyGraphSnapshot("export-canvas", nodes, edges);
    downloadTextFile(
      filename,
      graphToObsidianCanvas(conversationTitle, healthy.nodes, healthy.edges, appearance),
      "application/json"
    );
    onStatus?.(t("file.exported", { filename }));
  }, [conversationTitle, edges, healthyGraphSnapshot, nodes, onStatus, t]);

  const exportOpml = useCallback(() => {
    const filename = `${safeFilePart(conversationTitle)}.opml`;
    const healthy = healthyGraphSnapshot("export-opml", nodes, edges);
    downloadTextFile(
      filename,
      graphToOpml(conversationTitle, nodesForAdvancedExport(healthy.nodes), edgesForAdvancedExport(healthy.edges)),
      "text/x-opml;charset=utf-8"
    );
    onStatus?.(t("file.exported", { filename }));
  }, [conversationTitle, edges, healthyGraphSnapshot, nodes, onStatus, t]);

  const exportObsidianVaultMarkdown = useCallback(async () => {
    const filename = `${safeFilePart(conversationTitle)}.obsidian-vault.zip`;
    const appearance = await loadExportAppearance();
    const healthy = healthyGraphSnapshot("export-vault", nodes, edges);
    const files = graphToObsidianVaultMarkdownFiles(
      conversationTitle,
      nodesForAdvancedExport(healthy.nodes),
      edgesForAdvancedExport(healthy.edges),
      appearance
    );
    downloadBlobFile(filename, createZipFromTextFiles(files));
    onStatus?.(t("file.exported", { filename }));
  }, [conversationTitle, edges, healthyGraphSnapshot, nodes, onStatus, t]);

  const exportSvg = useCallback(async () => {
    const filename = `${safeFilePart(conversationTitle)}.chatmap.svg`;
    const appearance = await loadExportAppearance();
    const healthy = healthyGraphSnapshot("export-svg", nodes, edges);
    downloadTextFile(filename, graphToSvg(conversationTitle, healthy.nodes, healthy.edges, appearance), "image/svg+xml;charset=utf-8");
    onStatus?.(t("file.exported", { filename }));
  }, [conversationTitle, edges, healthyGraphSnapshot, nodes, onStatus, t]);

  const exportPng = useCallback(async () => {
    const filename = `${safeFilePart(conversationTitle)}.chatmap.png`;
    try {
      const appearance = await loadExportAppearance();
      const healthy = healthyGraphSnapshot("export-png", nodes, edges);
      const pngBlob = await svgToPngBlob(graphToSvg(conversationTitle, healthy.nodes, healthy.edges, appearance));
      downloadBlobFile(filename, pngBlob);
      onStatus?.(t("file.exported", { filename }));
    } catch {
      onStatus?.(t("file.exportPngFailed"));
    }
  }, [conversationTitle, edges, healthyGraphSnapshot, nodes, onStatus, t]);

  const resetCurrentMap = useCallback(async () => {
    const confirmed = window.confirm(t("file.resetConfirm"));
    if (!confirmed) return;

    await resetStoredGraph(conversationId);
    setHiddenRoot(false);
    setHiddenAutoEdgeIds([]);
    setHiddenNodeIds([]);
    setTopicGroups([]);
    setSelectedEdgeId(null);
    setSelectedRoot(false);
    setPendingSuggestedEdges([]);
    const resetNodes = nodesFromTurns(
      conversationTitle,
      orderedTurns,
      createLayoutPositions(orderedTurns, layoutMode, graphLayoutSettings),
      {},
      updateNodeText,
      summarizeNode,
      jumpToNodeTurn,
      summarizingNodeIds,
      [],
      [],
      false,
      layoutMode,
      nodeSizeSettings,
      graphLayoutSettings
    );
    setNodes(resetNodes);
    setEdges(
      autoEdgeStateFromTurns(orderedTurns, layoutMode, false, [], graphLayoutSettings).visibleAutoEdges
    );
    onStatus?.(t("file.resetDone"));
  }, [
    conversationId,
    conversationTitle,
    graphLayoutSettings,
    layoutMode,
    nodeSizeSettings,
    onStatus,
    setEdges,
    setNodes,
    summarizeNode,
    t,
    jumpToNodeTurn,
    summarizingNodeIds,
    orderedTurns,
    updateNodeText
  ]);

  const undoGraphChange = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const current = currentSnapshot();
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-29), cloneSnapshot(current)]);
    restoreSnapshot(previous);
    onStatus?.(t("file.undoDone"));
  }, [currentSnapshot, onStatus, restoreSnapshot, t, undoStack]);

  const redoGraphChange = useCallback(() => {
    const next = redoStack.at(-1);
    if (!next) return;
    const current = currentSnapshot();
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-29), cloneSnapshot(current)]);
    restoreSnapshot(next);
    onStatus?.(t("file.redoDone"));
  }, [currentSnapshot, onStatus, redoStack, restoreSnapshot, t]);

  const importJson = useCallback(
    async (event: { currentTarget: HTMLInputElement }) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;

      try {
        const graph = parseImportedGraph(await file.text());
        const importedAppearance = normalizeImportedAppearance(graph.appearance);
        const nextLayout = layoutMode;
        const nextHiddenRoot = Boolean(graph.layout?.hiddenRoot);
        const nextHiddenAutoEdgeIds = Array.isArray(graph.layout?.hiddenAutoEdgeIds)
          ? graph.layout.hiddenAutoEdgeIds.filter((id): id is string => typeof id === "string")
          : [];
        const importedAutoEdgeState = autoEdgeStateFromTurns(
          orderedTurns,
          nextLayout,
          nextHiddenRoot,
          nextHiddenAutoEdgeIds,
          graphLayoutSettings
        );
        const activeHiddenAutoEdgeIds = importedAutoEdgeState.hiddenAutoEdgeIds;
        const nextHiddenNodeIds = Array.isArray(graph.layout?.hiddenNodeIds)
          ? graph.layout.hiddenNodeIds.filter((id): id is string => typeof id === "string")
          : [];
        const importedPositions = positionsFromImportedGraph(graph);
        const overrides = overridesFromImportedGraph(graph);
        const customNodes = customNodesFromImportedGraph(graph);
        const customNodeIds = new Set(customNodes.map((node) => node.id));
        const positions = {
          ...createLayoutPositions(orderedTurns, nextLayout, graphLayoutSettings),
          ...Object.fromEntries(
            Object.entries(importedPositions).filter(([nodeId]) => customNodeIds.has(nodeId))
          )
        };
        const nextTopicGroups = normalizeImportedTopicGroups(graph.layout?.topicGroups);
        const nextNodes = nodesFromTurns(
          conversationTitle,
          orderedTurns,
          positions,
          overrides,
          updateNodeText,
          summarizeNode,
          jumpToNodeTurn,
          summarizingNodeIds,
          nextHiddenNodeIds,
          customNodes,
          nextHiddenRoot,
          nextLayout,
          nodeSizeSettings,
          graphLayoutSettings
        );
        const nodeIds = new Set(nextNodes.map((node) => node.id));
        const importedUserEdges: Edge[] = (graph.edges ?? [])
          .filter((edge) => !edge.isAuto && !isAutomaticEdgeId(typeof edge.id === "string" ? edge.id : ""))
          .filter(
            (edge) =>
              typeof edge.source === "string" &&
              typeof edge.target === "string" &&
              nodeIds.has(edge.source) &&
              nodeIds.has(edge.target)
          )
          .map((edge, index) =>
            applyEdgeStyle({
              id: typeof edge.id === "string" ? edge.id : `imported-${index}-${Date.now()}`,
              source: edge.source!,
              target: edge.target!,
              label: typeof edge.label === "string" ? edge.label : undefined,
              data: {
                relationship: isRelationship(edge.relationship) ? edge.relationship : "related",
                important: Boolean(edge.important),
                weight: normalizeEdgeWeight(edge.weight),
                confidence: typeof edge.confidence === "number" ? edge.confidence : undefined,
                reason: typeof edge.reason === "string" ? edge.reason : undefined,
                createdBy:
                  edge.createdBy === "ai" || edge.createdBy === "user" || edge.createdBy === "topic-analysis"
                    ? edge.createdBy
                    : undefined,
                originalEdgeId: typeof edge.originalEdgeId === "string" ? edge.originalEdgeId : undefined,
                proxyKind: edge.proxyKind === "incoming" || edge.proxyKind === "outgoing" ? edge.proxyKind : undefined,
                topicGroupId: typeof edge.topicGroupId === "string" ? edge.topicGroupId : undefined
              } satisfies RelationshipEdgeData
            })
          );
        const repairedImported = healthyGraphSnapshot("import-json", nextNodes, [
          ...importedAutoEdgeState.visibleAutoEdges,
          ...importedUserEdges
        ]);
        const repairedUserEdges = repairedImported.edges.filter((edge) => !isAutoEdge(edge));

        setLayoutMode(nextLayout);
        setHiddenRoot(nextHiddenRoot);
        setHiddenAutoEdgeIds(activeHiddenAutoEdgeIds);
        setHiddenNodeIds(nextHiddenNodeIds);
        setTopicGroups(nextTopicGroups);
        setSelectedEdgeId(null);
        setSelectedRoot(false);
        setNodes(repairedImported.nodes);
        setEdges(repairedImported.edges);
        void saveStoredGraph(
          conversationId,
          repairedImported.nodes,
          repairedUserEdges,
          nextLayout,
          nextHiddenRoot,
          activeHiddenAutoEdgeIds,
          nextHiddenNodeIds,
          nextTopicGroups
        );
        void applyImportedAppearance(importedAppearance);
        onStatus?.(t("file.importedJson", { nodes: repairedImported.nodes.length, links: repairedUserEdges.length }));
      } catch {
        onStatus?.(t("file.importJsonFailed"));
      }
    },
    [
      conversationId,
      conversationTitle,
      graphLayoutSettings,
      healthyGraphSnapshot,
      nodeSizeSettings,
      onStatus,
      setEdges,
      setNodes,
      summarizeNode,
      t,
      jumpToNodeTurn,
      summarizingNodeIds,
      orderedTurns,
      updateNodeText
    ]
  );

  if (turns.length === 0) {
    return (
      <section className="empty-state">
        <h2>{t("app.empty.title")}</h2>
        <p>{t("app.empty.hint")}</p>
      </section>
    );
  }

  return (
    <section className="canvas-shell">
      {jumpFeedback ? (
        <div className={`jump-feedback is-${jumpFeedback.kind}`} role={jumpFeedback.kind === "error" ? "alert" : "status"}>
          <div>
            <strong>{t(`jump.heading.${jumpFeedback.kind}` as I18nKey)}</strong>
            <p>{jumpFeedback.message}</p>
          </div>
          <button type="button" aria-label={t("jump.dismiss")} onClick={() => setJumpFeedback(null)}>×</button>
        </div>
      ) : null}
      <ReactFlow
        nodes={renderedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeClick={onNodeClick}
        onSelectionChange={({ edges: selectedFlowEdges }) => {
          const ids = selectedFlowEdges.map((edge) => edge.id);
          if (ids.length > 0) setSelectedMiniNode(null);
          setSelectedEdgeIds(ids);
          setSelectedEdgeId(ids.length === 1 ? ids[0] : null);
        }}
        multiSelectionKeyCode={["Control", "Meta", "Shift"]}
        onPaneClick={() => {
          setSelectedMiniNode(null);
          setSelectedEdgeId(null);
          setSelectedEdgeIds([]);
          setSelectedRoot(false);
          setHighlightedEndpointIds([]);
          setFileMenuOpen(false);
        }}
        onInit={(instance) => {
          flowInstance.current = instance;
        }}
        minZoom={0.08}
        fitView
      >
        <Background color="var(--cm-grid-dot)" />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
      <div className="graph-toolbar">
        <button className="button-with-icon" type="button" onClick={suggestLinks} disabled={suggestingLinks}>
          <Icon name="sparkles" />
          <span>{suggestingLinks ? t("toolbar.suggesting") : t("toolbar.suggestLinks")}</span>
        </button>
        <button className="button-with-icon" type="button" onClick={analyzeTopics} disabled={analyzingTopics}>
          <Icon name="brain" />
          <span>{analyzingTopics ? t("toolbar.analyzingTopics") : t("toolbar.analyzeTopics")}</span>
        </button>
        <button className="button-with-icon" type="button" onClick={() => setSearchOpen((open) => !open)}>
          <Icon name="search" />
          <span>{t("toolbar.search")}</span>
        </button>
        <button className="button-with-icon" type="button" onClick={undoGraphChange} disabled={undoStack.length === 0}>
          <Icon name="undo" />
          <span>{t("toolbar.undo")}</span>
        </button>
        <button className="button-with-icon" type="button" onClick={redoGraphChange} disabled={redoStack.length === 0}>
          <Icon name="redo" />
          <span>{t("toolbar.redo")}</span>
        </button>
        <button
          className="button-with-icon"
          type="button"
          onClick={summarizeAllNodes}
          disabled={summarizingNodeIds.size > 0}
        >
          <Icon name="brain" />
          <span>{summarizingNodeIds.size > 0 ? t("toolbar.summarizing") : t("toolbar.summarizeAll")}</span>
        </button>
        <div className="file-menu">
          <button className="button-with-icon" type="button" onClick={() => setFileMenuOpen((open) => !open)}>
            <Icon name="files" />
            <span>{t("toolbar.files")}</span>
            <Icon name="chevronDown" size={14} />
          </button>
          {fileMenuOpen ? (
            <div className="file-menu__panel">
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  importInputRef.current?.click();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="upload" />
                <span>{t("file.importJson")}</span>
              </button>
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  void exportJson();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="download" />
                <span>{t("file.exportJson")}</span>
              </button>
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  void exportObsidianCanvas();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="map" />
                <span>{t("file.exportCanvas")}</span>
              </button>
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  exportOpml();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="download" />
                <span>{t("file.exportOpml")}</span>
              </button>
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  void exportObsidianVaultMarkdown();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="download" />
                <span>{t("file.exportObsidianVault")}</span>
              </button>
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  void exportSvg();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="external" />
                <span>{t("file.exportSvg")}</span>
              </button>
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  void exportPng();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="image" />
                <span>{t("file.exportPng")}</span>
              </button>
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  exportMarkdown();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="download" />
                <span>{t("file.exportMd")}</span>
              </button>
              <button
                className="button-with-icon"
                type="button"
                onClick={() => {
                  void copyMarkdown();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="copy" />
                <span>{t("file.copyMd")}</span>
              </button>
              <button
                type="button"
                className="button-with-icon file-menu__danger"
                onClick={() => {
                  void resetCurrentMap();
                  setFileMenuOpen(false);
                }}
              >
                <Icon name="trash" />
                <span>{t("file.resetMap")}</span>
              </button>
            </div>
          ) : null}
          <input
            ref={importInputRef}
            className="file-input"
            type="file"
            accept=".json,application/json"
            onChange={importJson}
          />
        </div>
      </div>
      {searchOpen ? (
        <aside className="search-panel">
          <div className="edge-panel__header">
            <strong>{t("search.title")}</strong>
            <button type="button" onClick={() => setSearchOpen(false)}>
              {t("search.close")}
            </button>
          </div>
          <input
            value={searchQuery}
            placeholder={t("search.placeholder")}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            autoFocus
          />
          <div className="search-results">
            {searchQuery.trim() && searchResults.length === 0 ? (
              <p className="panel-note">{t("search.empty")}</p>
            ) : null}
            {searchResults.map((node) => (
              <button type="button" key={node.id} onClick={() => focusNode(node.id)}>
                <strong>{node.data.title}</strong>
                <span>{node.data.summary}</span>
              </button>
            ))}
          </div>
        </aside>
      ) : null}
      {pendingSuggestedEdges.length > 0 ? (
        <aside className="suggestion-panel">
          <div className="suggestion-panel__header">
            <strong>{t("suggestions.title")}</strong>
            <div>
              <button type="button" onClick={acceptAllPendingSuggestions}>
                {t("suggestions.acceptAll")}
              </button>
              <button type="button" onClick={clearPendingSuggestions}>
                {t("suggestions.clear")}
              </button>
            </div>
          </div>
          <div className="suggestion-list">
            {pendingSuggestedEdges.map((edge) => {
              const data = (edge.data as RelationshipEdgeData | undefined) ?? {
                relationship: "related"
              };
              return (
                <article className="suggestion-item" key={edge.id}>
                  <div className="suggestion-item__nodes">
                    <span>{shortNodeTitle(nodes, edge.source)}</span>
                    <span>{"->"}</span>
                    <span>{shortNodeTitle(nodes, edge.target)}</span>
                  </div>
                  <div className="suggestion-item__controls">
                    <RelationshipColorPicker
                      value={data.relationship}
                      onChange={(relationship) =>
                        updatePendingSuggestion(edge.id, {
                          relationship
                        })
                      }
                    />
                    <input
                      value={String(edge.label ?? "")}
                      onChange={(event) =>
                        updatePendingSuggestion(edge.id, { label: event.currentTarget.value })
                      }
                    />
                  </div>
                  <label className="suggestion-item__check">
                    <input
                      type="checkbox"
                      checked={Boolean(data.important)}
                      onChange={(event) =>
                        updatePendingSuggestion(edge.id, { important: event.currentTarget.checked })
                      }
                    />
                    {t("action.important")}
                  </label>
                  {data.reason || typeof data.confidence === "number" ? (
                    <p>
                      {data.reason}
                      {typeof data.confidence === "number"
                        ? ` ${t("label.confidence")} ${Math.round(data.confidence * 100)}%`
                        : ""}
                    </p>
                  ) : null}
                  <div className="suggestion-item__actions">
                    <button type="button" onClick={() => acceptPendingSuggestion(edge.id)}>
                      {t("suggestions.accept")}
                    </button>
                    <button type="button" onClick={() => rejectPendingSuggestion(edge.id)}>
                      {t("suggestions.reject")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </aside>
      ) : null}
      {selectedMiniNodeContext ? (
        <aside className="edge-panel node-panel">
          <div className="edge-panel__header">
            <strong>{t("panel.miniNodeActions")}</strong>
            <button type="button" onClick={() => setSelectedMiniNode(null)}>
              {t("action.close")}
            </button>
          </div>
          <p className="panel-note">{t("panel.miniNodeHint")}</p>
          <label>
            {t("field.title")}
            <input
              value={selectedMiniNodeContext.miniNode.title}
              onChange={(event) =>
                updateMiniNodeInExpansion(selectedMiniNodeContext.parentNode.id, selectedMiniNodeContext.miniNode.id, {
                  title: event.currentTarget.value
                })
              }
            />
          </label>
          <div className="color-picker" aria-label={t("action.colorNode")}>
            <span className="color-picker__title">{t("action.colorNode")}</span>
            <div className="color-picker__row">
              {NODE_COLOR_OPTIONS.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  className="color-swatch-button"
                  title={t(`color.${color.name}` as I18nKey)}
                  onClick={() =>
                    updateMiniNodeInExpansion(selectedMiniNodeContext.parentNode.id, selectedMiniNodeContext.miniNode.id, {
                      color: color.name
                    })
                  }
                >
                  <span className="color-swatch-button__preview" style={{ backgroundColor: color.value }} />
                </button>
              ))}
            </div>
          </div>
          <label className="edge-panel__check">
            <input
              type="checkbox"
              checked={Boolean(selectedMiniNodeContext.miniNode.important)}
              onChange={(event) =>
                updateMiniNodeInExpansion(selectedMiniNodeContext.parentNode.id, selectedMiniNodeContext.miniNode.id, {
                  important: event.currentTarget.checked
                })
              }
            />
            {t("action.important")}
          </label>
          <button
            type="button"
            className="danger-button"
            onClick={() =>
              deleteMiniNodeFromExpansion(selectedMiniNodeContext.parentNode.id, selectedMiniNodeContext.miniNode.id)
            }
          >
            {t("action.deleteMiniNode")}
          </button>
        </aside>
      ) : null}
      {!selectedMiniNodeContext && selectedTurnNodes.length >= 2 ? (
        <aside className="edge-panel node-panel">
          <div className="edge-panel__header">
            <strong>{t("panel.nodesSelected").replace("{count}", String(selectedTurnNodes.length))}</strong>
          </div>
          <p className="panel-note">{t("panel.organizeSelected")}</p>
          <div className="node-panel__actions">
            <button type="button" onClick={mergeSelectedNodes}>
              {t("action.mergeNodes")}
            </button>
            <button type="button" onClick={collapseSelectedAsTopic}>
              {t("action.collapseTopic")}
            </button>
            <button type="button" onClick={toggleSelectedNodeCollapsed}>
              {selectedTurnNodes.some((node) => !node.data.collapsed) ? t("action.collapseNode") : t("action.expandNode")}
            </button>
            <button type="button" onClick={toggleSelectedNodeImportant}>
              {t("action.important")}
            </button>
          </div>
          <div className="tag-editor">
            <label>
              {t("field.tag")}
              <input
                value={tagDraft}
                placeholder={t("field.tagPlaceholder")}
                onChange={(event) => setTagDraft(event.currentTarget.value)}
              />
            </label>
            <button type="button" onClick={addBulkTag}>
              {t("action.addTag")}
            </button>
            <div className="tag-editor__chips">
              {selectedTagUnion.map((tag) => (
                <button key={tag} type="button" onClick={() => removeBulkTag(tag)}>
                  {t("action.removeTag")}: {tag}
                </button>
              ))}
            </div>
          </div>
          <div className="color-picker" aria-label={t("action.colorNode")}>
            <span className="color-picker__title">{t("action.colorNode")}</span>
            <div className="color-picker__row">
              {NODE_COLOR_OPTIONS.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  className="color-swatch-button"
                  title={t(`color.${color.name}` as I18nKey)}
                  onClick={() => updateSelectedNodeAppearance({ color: color.name })}
                >
                  <span className="color-swatch-button__preview" style={{ backgroundColor: color.value }} />
                </button>
              ))}
              <button
                type="button"
                className="color-swatch-button color-swatch-button--theme"
                title={t("color.theme")}
                onClick={() => updateSelectedNodeAppearance({ color: undefined })}
              >
                <span className="color-swatch-button__preview" />
                <span className="color-swatch-button__label">{t("color.theme")}</span>
              </button>
            </div>
          </div>
        </aside>
      ) : null}
      {!selectedMiniNodeContext && selectedActionNodes.length === 1 ? (
        <aside className="edge-panel node-panel">
          <div className="edge-panel__header">
            <strong>{t("panel.nodeActions")}</strong>
          </div>
          <p className="panel-note">{t("panel.nodeHint")}</p>
          <div className="node-panel__actions">
            <button type="button" onClick={selectAllTurnNodes}>
              {t("action.selectAllTurns")}
            </button>
            {selectedActionNodes[0]?.data.topicGroupId ? (
              <button type="button" onClick={() => expandTopicGroup(selectedActionNodes[0].data.topicGroupId!)}>
                {t("action.expandTopicGroup")}
              </button>
            ) : null}
            {selectedTurnNodes[0] ? (
              <>
                <button type="button" onClick={toggleSelectedNodeCollapsed}>
                  {selectedTurnNodes[0]?.data.collapsed ? t("action.expandNode") : t("action.collapseNode")}
                </button>
                <button type="button" onClick={toggleSelectedNodeImportant}>
                  {t("action.important")}
                </button>
                <button type="button" onClick={resetSelectedNodeSize}>
                  {t("action.restoreNodeSize")}
                </button>
                <button type="button" onClick={rebuildSelectedNode}>
                  {t("action.rebuildNode")}
                </button>
              </>
            ) : null}
            {selectedTurnNodes[0] && !selectedTurnNodes[0]?.data.answerExpansion ? (
              <button
                type="button"
                onClick={() => void expandNodeAnswer(selectedTurnNodes[0].id)}
                disabled={expandingNodeIds.has(selectedTurnNodes[0]?.id)}
              >
                {t("action.expandAnswer")}
              </button>
            ) : selectedTurnNodes[0] ? (
              <>
                <button type="button" onClick={() => setSelectedNodeExpansionMode("original")}>
                  {t("action.showOriginal")}
                </button>
                <button type="button" onClick={() => setSelectedNodeExpansionMode("expanded")}>
                  {t("action.showExpansion")}
                </button>
                <button
                  type="button"
                  onClick={() => void expandNodeAnswer(selectedTurnNodes[0].id, true)}
                  disabled={expandingNodeIds.has(selectedTurnNodes[0]?.id)}
                >
                  {t("action.reexpandAnswer")}
                </button>
                <button type="button" onClick={deleteSelectedNodeExpansion}>
                  {t("action.deleteExpansion")}
                </button>
              </>
            ) : null}
          </div>
          <div className="tag-editor">
            <label>
              {t("field.tag")}
              <input
                value={tagDraft}
                placeholder={t("field.tagPlaceholder")}
                onChange={(event) => setTagDraft(event.currentTarget.value)}
              />
            </label>
            <button type="button" onClick={addBulkTag}>
              {t("action.addTag")}
            </button>
            <div className="tag-editor__chips">
              {selectedTagUnion.map((tag) => (
                <button key={tag} type="button" onClick={() => removeBulkTag(tag)}>
                  {t("action.removeTag")}: {tag}
                </button>
              ))}
            </div>
          </div>
          <div className="color-picker" aria-label={t("action.colorNode")}>
            <span className="color-picker__title">{t("action.colorNode")}</span>
            <div className="color-picker__row">
              {NODE_COLOR_OPTIONS.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  className="color-swatch-button"
                  title={t(`color.${color.name}` as I18nKey)}
                  onClick={() => updateSelectedNodeAppearance({ color: color.name })}
                >
                  <span className="color-swatch-button__preview" style={{ backgroundColor: color.value }} />
                </button>
              ))}
              <button
                type="button"
                className="color-swatch-button color-swatch-button--theme"
                title={t("color.theme")}
                onClick={() => updateSelectedNodeAppearance({ color: undefined })}
              >
                <span className="color-swatch-button__preview" />
                <span className="color-swatch-button__label">{t("color.theme")}</span>
              </button>
            </div>
          </div>
        </aside>
      ) : null}
      {selectedEdges.length > 1 ? (
        <aside className="edge-panel">
          <div className="edge-panel__header">
            <strong>{t("panel.linksSelected", { count: selectedEdges.length })}</strong>
            <button
              type="button"
              onClick={() => {
                setSelectedEdgeIds([]);
                setSelectedEdgeId(null);
              }}
            >
              {t("action.close")}
            </button>
          </div>
          <p className="panel-note">{t("panel.linkBatchHint")}</p>
          <RelationshipColorPicker
            value={(selectedEdges[0]?.data as RelationshipEdgeData | undefined)?.relationship ?? "related"}
            onChange={(relationship) => updateSelectedEdges({ relationship })}
          />
          <label className="edge-panel__check">
            <input
              type="checkbox"
              checked={selectedEdges.every((edge) => Boolean((edge.data as RelationshipEdgeData | undefined)?.important))}
              onChange={(event) => updateSelectedEdges({ important: event.currentTarget.checked })}
            />
            {t("action.important")}
          </label>
          <label className="edge-panel__range">
            <span>
              {t("action.edgeWeight")} {weightPercent((selectedEdges[0]?.data as RelationshipEdgeData | undefined)?.weight)}%
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={weightPercent((selectedEdges[0]?.data as RelationshipEdgeData | undefined)?.weight)}
              onChange={(event) => updateSelectedEdges({ weight: Number(event.currentTarget.value) / 100 })}
            />
          </label>
        </aside>
      ) : selectedEdge ? (
        <aside className="edge-panel">
          <div className="edge-panel__header">
            <strong>{t("panel.linkTitle")}</strong>
            <button type="button" onClick={() => setSelectedEdgeId(null)}>
              {t("action.close")}
            </button>
          </div>
          <div>
            <RelationshipColorPicker
              value={
                (selectedEdge.data as RelationshipEdgeData | undefined)?.relationship ??
                (isAutoEdge(selectedEdge) ? "references" : "related")
              }
              onChange={(relationship) => updateSelectedEdge({ relationship })}
            />
          </div>
          <label>
            {t("field.label")}
            <input
              value={String(selectedEdge.label ?? "")}
              onChange={(event) => updateSelectedEdge({ label: event.currentTarget.value })}
            />
          </label>
          <label className="edge-panel__check">
            <input
              type="checkbox"
              checked={Boolean((selectedEdge.data as RelationshipEdgeData | undefined)?.important)}
              onChange={(event) => updateSelectedEdge({ important: event.currentTarget.checked })}
            />
            {t("action.important")}
          </label>
          <label className="edge-panel__range">
            <span>
              {t("action.edgeWeight")} {weightPercent((selectedEdge.data as RelationshipEdgeData | undefined)?.weight)}%
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={weightPercent((selectedEdge.data as RelationshipEdgeData | undefined)?.weight)}
              onChange={(event) => updateSelectedEdge({ weight: Number(event.currentTarget.value) / 100 })}
            />
          </label>
          {((selectedEdge.data as RelationshipEdgeData | undefined)?.reason ||
            typeof (selectedEdge.data as RelationshipEdgeData | undefined)?.confidence === "number") ? (
            <p className="panel-note">
              {(selectedEdge.data as RelationshipEdgeData | undefined)?.reason}
              {typeof (selectedEdge.data as RelationshipEdgeData | undefined)?.confidence === "number"
                ? ` ${t("label.confidence")} ${Math.round(
                    ((selectedEdge.data as RelationshipEdgeData | undefined)?.confidence ?? 0) * 100
                  )}%`
                : ""}
            </p>
          ) : null}
          <button type="button" className="danger-button" onClick={deleteSelectedEdge}>
            {t("action.deleteLink")}
          </button>
        </aside>
      ) : null}
      {selectedRoot ? (
        <aside className="edge-panel">
          <div className="edge-panel__header">
            <strong>{t("panel.headerTitle")}</strong>
            <button type="button" onClick={() => setSelectedRoot(false)}>
              {t("action.close")}
            </button>
          </div>
          <p className="panel-note">{t("panel.headerHint")}</p>
          <button type="button" className="danger-button" onClick={deleteRoot}>
            {t("action.deleteHeader")}
          </button>
        </aside>
      ) : null}
    </section>
  );
}
