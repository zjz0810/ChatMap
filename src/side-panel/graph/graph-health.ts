import type { Edge, Node } from "@xyflow/react";
import { DEFAULT_USER_EDGE_WEIGHT, normalizeEdgeWeight } from "./edge-weight.ts";

export type GraphIssueLevel = "auto-corrected" | "dropped" | "fatal";

export type GraphIssue = {
  level: GraphIssueLevel;
  category:
    | "dangling-edge"
    | "duplicate-node"
    | "invalid-dimensions"
    | "invalid-position"
    | "invalid-proxy-edge"
    | "invalid-weight"
    | "empty-graph";
  message: string;
  path?: string;
};

type RepairInput<N extends Node = Node, E extends Edge = Edge> = {
  nodes: N[];
  edges: E[];
};

type RepairOutput<N extends Node = Node, E extends Edge = Edge> = RepairInput<N, E> & {
  issues: GraphIssue[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidDimension(value: unknown): value is { width: number; height: number; manual?: boolean } {
  const dimensions = value as { width?: unknown; height?: unknown } | undefined;
  return Boolean(dimensions && isFiniteNumber(dimensions.width) && isFiniteNumber(dimensions.height));
}

export function graphIssuesSummary(issues: GraphIssue[]): { corrected: number; dropped: number; fatal: number } {
  return {
    corrected: issues.filter((issue) => issue.level === "auto-corrected").length,
    dropped: issues.filter((issue) => issue.level === "dropped").length,
    fatal: issues.filter((issue) => issue.level === "fatal").length
  };
}

export function repairGraphSnapshot<N extends Node, E extends Edge>(input: RepairInput<N, E>): RepairOutput<N, E> {
  const issues: GraphIssue[] = [];
  const seenNodeIds = new Set<string>();
  const nodes: N[] = [];

  input.nodes.forEach((node, index) => {
    if (!node.id || seenNodeIds.has(node.id)) {
      issues.push({
        level: "dropped",
        category: "duplicate-node",
        message: `Dropped duplicate or empty node id: ${node.id || "(empty)"}.`,
        path: `nodes.${index}`
      });
      return;
    }

    seenNodeIds.add(node.id);
    let nextNode = node;
    const nextPosition = { ...node.position };
    if (!isFiniteNumber(nextPosition.x) || !isFiniteNumber(nextPosition.y)) {
      issues.push({
        level: "auto-corrected",
        category: "invalid-position",
        message: `Repaired invalid position for node ${node.id}.`,
        path: `nodes.${index}.position`
      });
      nextNode = {
        ...nextNode,
        position: {
          x: isFiniteNumber(nextPosition.x) ? nextPosition.x : 0,
          y: isFiniteNumber(nextPosition.y) ? nextPosition.y : 0
        }
      };
    }

    const data = nextNode.data as Record<string, unknown> | undefined;
    if (data && "dimensions" in data && !isValidDimension(data.dimensions)) {
      issues.push({
        level: "auto-corrected",
        category: "invalid-dimensions",
        message: `Removed invalid dimensions for node ${node.id}.`,
        path: `nodes.${index}.data.dimensions`
      });
      nextNode = {
        ...nextNode,
        data: {
          ...data,
          dimensions: undefined
        }
      };
    }

    nodes.push(nextNode);
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: E[] = [];

  input.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        level: "dropped",
        category: "dangling-edge",
        message: `Dropped edge ${edge.id} because an endpoint is missing.`,
        path: `edges.${index}`
      });
      return;
    }

    const data = (edge.data ?? {}) as Record<string, unknown>;
    const proxyKind = data.proxyKind;
    if ((proxyKind === "incoming" || proxyKind === "outgoing") && typeof data.originalEdgeId !== "string") {
      issues.push({
        level: "dropped",
        category: "invalid-proxy-edge",
        message: `Dropped proxy edge ${edge.id} because originalEdgeId is missing.`,
        path: `edges.${index}.data.originalEdgeId`
      });
      return;
    }

    const normalizedWeight = normalizeEdgeWeight(data.weight, DEFAULT_USER_EDGE_WEIGHT);
    const hasValidWeight = typeof data.weight === "number" && Number.isFinite(data.weight) && data.weight >= 0 && data.weight <= 1;
    if (!hasValidWeight) {
      issues.push({
        level: "auto-corrected",
        category: "invalid-weight",
        message: `Repaired invalid weight for edge ${edge.id}.`,
        path: `edges.${index}.data.weight`
      });
    }

    edges.push({
      ...edge,
      data: {
        ...data,
        weight: normalizedWeight
      }
    });
  });

  if (nodes.length === 0) {
    issues.push({
      level: "fatal",
      category: "empty-graph",
      message: "Graph has no renderable nodes after repair."
    });
  }

  return { nodes, edges, issues };
}
