import { DEFAULT_TOPIC_PROXY_EDGE_WEIGHT, normalizeEdgeWeight } from "./edge-weight.ts";

type TopicSourceNode = {
  id: string;
  title: string;
  summary: string;
  position: { x: number; y: number };
  turnIndex?: number;
  tags?: string[];
};

type BuildCollapsedTopicInput = {
  selectedNodes: TopicSourceNode[];
  now?: number;
};

export type CollapsedTopic = {
  id: string;
  title: string;
  summary: string;
  position: { x: number; y: number };
  hiddenNodeIds: string[];
  tags: string[];
};

export type TopicGroupNodeSnapshot = TopicSourceNode & {
  status?: "open" | "review" | "done";
  color?: string;
  collapsed?: boolean;
  important?: boolean;
};

export type TopicGroupEdgeSnapshot = {
  id: string;
  source: string;
  target: string;
  label?: unknown;
  data?: unknown;
  isAuto?: boolean;
  weight?: number;
};

export type TopicGroupRecord = {
  id: string;
  topicNodeId: string;
  title: string;
  memberNodeIds: string[];
  nodeSnapshots: TopicGroupNodeSnapshot[];
  edgeSnapshots: TopicGroupEdgeSnapshot[];
  createdAt: string;
  updatedAt: string;
};

export type TopicProxyEdge = TopicGroupEdgeSnapshot & {
  originalEdgeId: string;
  proxyKind: "incoming" | "outgoing";
  topicGroupId: string;
  weight: number;
};

function compactText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}

export function buildCollapsedTopic(input: BuildCollapsedTopicInput): CollapsedTopic {
  const selectedNodes = [...input.selectedNodes].sort(
    (left, right) => (left.turnIndex ?? 0) - (right.turnIndex ?? 0)
  );
  if (selectedNodes.length < 2) {
    throw new Error("At least two nodes are required to collapse a topic.");
  }

  const now = input.now ?? Date.now();
  const firstNode = selectedNodes[0];
  const averagePosition = selectedNodes.reduce(
    (position, node) => ({
      x: position.x + node.position.x / selectedNodes.length,
      y: position.y + node.position.y / selectedNodes.length
    }),
    { x: 0, y: 0 }
  );

  return {
    id: `custom-topic-${now}-${firstNode.id}`,
    title: compactText(`Topic: ${firstNode.title}`, 120),
    summary: [
      `Collapsed topic from ${selectedNodes.length} turns.`,
      "",
      ...selectedNodes.map((node) => {
        const label = typeof node.turnIndex === "number" ? `Turn ${node.turnIndex + 1}` : "Note";
        return `- ${label}: ${compactText(node.title, 80)}\n  ${compactText(node.summary, 180)}`;
      })
    ].join("\n"),
    position: {
      x: Math.round(averagePosition.x),
      y: Math.round(averagePosition.y)
    },
    hiddenNodeIds: selectedNodes.map((node) => node.id),
    tags: ["topic"]
  };
}

function endpointKey(edge: { source: string; target: string; label?: unknown }): string {
  return `${edge.source}:${edge.target}:${String(edge.label ?? "")}`;
}

export function buildTopicGroupRecord(input: {
  topic: CollapsedTopic;
  selectedNodes: TopicGroupNodeSnapshot[];
  edges: TopicGroupEdgeSnapshot[];
  now?: number;
}): TopicGroupRecord {
  const now = new Date(input.now ?? Date.now()).toISOString();
  const memberIds = new Set(input.topic.hiddenNodeIds);
  return {
    id: `topic-group-${input.topic.id}`,
    topicNodeId: input.topic.id,
    title: input.topic.title,
    memberNodeIds: [...memberIds],
    nodeSnapshots: input.selectedNodes.filter((node) => memberIds.has(node.id)),
    edgeSnapshots: input.edges.filter((edge) => memberIds.has(edge.source) || memberIds.has(edge.target)),
    createdAt: now,
    updatedAt: now
  };
}

export function buildTopicProxyEdges(input: {
  topicNodeId: string;
  topicGroupId?: string;
  memberNodeIds: string[];
  edges: TopicGroupEdgeSnapshot[];
}): TopicProxyEdge[] {
  const memberIds = new Set(input.memberNodeIds);
  const seen = new Set<string>();
  const proxies: TopicProxyEdge[] = [];
  const topicGroupId = input.topicGroupId ?? input.topicNodeId;

  for (const edge of input.edges) {
    const sourceInGroup = memberIds.has(edge.source);
    const targetInGroup = memberIds.has(edge.target);
    if (sourceInGroup === targetInGroup) continue;

    const edgeData = edge.data && typeof edge.data === "object" ? (edge.data as Record<string, unknown>) : {};
    const weight = normalizeEdgeWeight(edgeData.weight ?? edge.weight, DEFAULT_TOPIC_PROXY_EDGE_WEIGHT);
    const proxy =
      sourceInGroup
        ? {
            ...edge,
            id: `topic-proxy-${input.topicNodeId}-${edge.id}-out`,
            source: input.topicNodeId,
            originalEdgeId: edge.id,
            proxyKind: "outgoing" as const,
            topicGroupId,
            weight,
            data: { ...edgeData, originalEdgeId: edge.id, proxyKind: "outgoing", topicGroupId, weight }
          }
        : {
            ...edge,
            id: `topic-proxy-${input.topicNodeId}-${edge.id}-in`,
            target: input.topicNodeId,
            originalEdgeId: edge.id,
            proxyKind: "incoming" as const,
            topicGroupId,
            weight,
            data: { ...edgeData, originalEdgeId: edge.id, proxyKind: "incoming", topicGroupId, weight }
          };
    const key = endpointKey(proxy);
    if (seen.has(key)) continue;
    seen.add(key);
    proxies.push(proxy);
  }

  return proxies;
}

export function topicGroupHasNestedSelection(input: {
  selectedNodeIds: string[];
  topicGroups: TopicGroupRecord[];
}): boolean {
  const selected = new Set(input.selectedNodeIds);
  return input.topicGroups.some(
    (group) => selected.has(group.topicNodeId) || group.memberNodeIds.some((nodeId) => selected.has(nodeId))
  );
}
