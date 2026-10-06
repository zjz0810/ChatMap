import type { Edge, Node } from "@xyflow/react";
import type { SourceAnchor, Turn } from "../../shared/types.ts";
import type { AnswerExpansion, AnswerMiniNode } from "../ai/answer-expansion.ts";
import type { NodeColorName } from "./graph-colors.ts";
import { sanitizeSourceAnchors } from "./source-anchors.ts";
import type { TopicGroupRecord } from "./topic-collapse.ts";

export type TurnNodeData = {
  title: string;
  summary: string;
  turn?: Turn;
  isConversationRoot?: boolean;
  isCustomNode?: boolean;
  status?: "open" | "review" | "done";
  tags?: string[];
  sourceAnchors?: SourceAnchor[];
  color?: NodeColorName;
  collapsed?: boolean;
  important?: boolean;
  titleLineClamp?: number;
  summaryLineClamp?: number;
  dimensions?: { width: number; height: number; manual: boolean };
  answerExpansion?: AnswerExpansion;
  topicGroupId?: string;
  topicGroupMemberIds?: string[];
  onUpdate?: (nodeId: string, updates: { title?: string; summary?: string }) => void;
  onResize?: (nodeId: string, dimensions: { width: number; height: number; manual: boolean }) => void;
  onMiniNodeUpdate?: (
    nodeId: string,
    miniNodeId: string,
    updates: Partial<Pick<AnswerMiniNode, "title" | "color" | "important">>
  ) => void;
  onMiniNodeDelete?: (nodeId: string, miniNodeId: string) => void;
  onMiniNodeSelect?: (nodeId: string, miniNodeId: string) => void;
  selectedMiniNodeId?: string;
  onSummarize?: (nodeId: string) => void;
  onJump?: (nodeId: string) => void;
  isSummarizing?: boolean;
};

export type GraphDocumentSnapshot = {
  nodes: Node<TurnNodeData>[];
  edges: Edge[];
  hiddenRoot: boolean;
  hiddenAutoEdgeIds: string[];
  hiddenNodeIds: string[];
  topicGroups: TopicGroupRecord[];
};

export function cloneGraphDocument(snapshot: GraphDocumentSnapshot): GraphDocumentSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: {
        ...node.data,
        tags: node.data.tags ? [...node.data.tags] : undefined,
        sourceAnchors: sanitizeSourceAnchors(node.data.sourceAnchors),
        dimensions: node.data.dimensions ? { ...node.data.dimensions } : undefined,
        answerExpansion: node.data.answerExpansion
          ? JSON.parse(JSON.stringify(node.data.answerExpansion))
          : undefined,
        topicGroupMemberIds: node.data.topicGroupMemberIds ? [...node.data.topicGroupMemberIds] : undefined
      }
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      data: edge.data ? { ...edge.data } : undefined
    })),
    hiddenRoot: snapshot.hiddenRoot,
    hiddenAutoEdgeIds: [...snapshot.hiddenAutoEdgeIds],
    hiddenNodeIds: [...snapshot.hiddenNodeIds],
    topicGroups: JSON.parse(JSON.stringify(snapshot.topicGroups))
  };
}

export function graphDocumentKey(snapshot: GraphDocumentSnapshot): string {
  return JSON.stringify({
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      data: {
        title: node.data.title,
        summary: node.data.summary,
        status: node.data.status,
        tags: node.data.tags,
        sourceAnchors: sanitizeSourceAnchors(node.data.sourceAnchors),
        isConversationRoot: node.data.isConversationRoot,
        isCustomNode: node.data.isCustomNode,
        color: node.data.color,
        collapsed: node.data.collapsed,
        important: node.data.important,
        titleLineClamp: node.data.titleLineClamp,
        summaryLineClamp: node.data.summaryLineClamp,
        dimensions: node.data.dimensions,
        answerExpansion: node.data.answerExpansion,
        topicGroupId: node.data.topicGroupId,
        topicGroupMemberIds: node.data.topicGroupMemberIds
      }
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      data: edge.data
    })),
    hiddenRoot: snapshot.hiddenRoot,
    hiddenAutoEdgeIds: snapshot.hiddenAutoEdgeIds,
    hiddenNodeIds: snapshot.hiddenNodeIds,
    topicGroups: snapshot.topicGroups
  });
}
