import type { Edge, Node } from "@xyflow/react";
import { loadAiSettings } from "../settings/ai-settings-storage";
import { tryExtractJsonObject } from "./json-output";
import { requestChatCompletion } from "./openai-compatible";

type EdgeRelationship =
  | "related"
  | "depends_on"
  | "extends"
  | "supports"
  | "contradicts"
  | "duplicates"
  | "references"
  | "todo";

type SuggestionNode = {
  id: string;
  order: number;
  title: string;
  summary: string;
};

type SuggestedEdge = {
  source: string;
  target: string;
  relationship: EdgeRelationship;
  label: string;
  important?: boolean;
  confidence?: number;
  reason?: string;
};

const RELATIONSHIPS: EdgeRelationship[] = [
  "related",
  "depends_on",
  "extends",
  "supports",
  "contradicts",
  "duplicates",
  "references",
  "todo"
];

function isRelationship(value: unknown): value is EdgeRelationship {
  return typeof value === "string" && RELATIONSHIPS.includes(value as EdgeRelationship);
}

function normalizedConfidence(value: unknown, important: boolean): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return important ? 0.76 : 0.62;
}

function requiredConfidence(edge: SuggestedEdge, intermediateGap: number): number {
  const base = edge.relationship === "related" ? 0.86 : 0.74;
  return Math.min(0.96, base + intermediateGap * 0.04);
}

function nodeOrderMap(nodes: SuggestionNode[]): Map<string, number> {
  return new Map(nodes.map((node) => [node.id, node.order]));
}

function intermediateGap(edge: Pick<SuggestedEdge, "source" | "target">, orderById: Map<string, number>): number | null {
  const sourceOrder = orderById.get(edge.source);
  const targetOrder = orderById.get(edge.target);
  if (sourceOrder == null || targetOrder == null) return null;
  return Math.max(0, Math.abs(sourceOrder - targetOrder) - 1);
}

function normalizeSuggestions(value: unknown, nodes: SuggestionNode[]): SuggestedEdge[] {
  const edges = (value as { edges?: unknown }).edges;
  if (!Array.isArray(edges)) return [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const orderById = nodeOrderMap(nodes);

  return edges
    .map((edge) => edge as Record<string, unknown>)
    .filter((edge) => typeof edge.source === "string" && typeof edge.target === "string")
    .filter((edge) => nodeIds.has(edge.source as string) && nodeIds.has(edge.target as string))
    .filter((edge) => edge.source !== edge.target)
    .map((edge) => {
      const relationship = isRelationship(edge.relationship) ? edge.relationship : "related";
      const important = Boolean(edge.important);
      const confidence = normalizedConfidence(edge.confidence, important);
      return {
        source: edge.source as string,
        target: edge.target as string,
        relationship,
        label: typeof edge.label === "string" ? edge.label.slice(0, 48) : relationship,
        important,
        confidence,
        reason: typeof edge.reason === "string" ? edge.reason.slice(0, 240) : undefined
      };
    })
    .filter((edge) => {
      const gap = intermediateGap(edge, orderById);
      if (gap == null) return false;
      if (gap < 1 || gap > 4) return false;
      return edge.confidence >= requiredConfidence(edge, gap);
    })
    .sort((a, b) => {
      const importantDelta = Number(b.important) - Number(a.important);
      return importantDelta || b.confidence - a.confidence;
    })
    .slice(0, 8);
}

function buildPrompt(nodes: SuggestionNode[]): string {
  return `You are helping organize an AI conversation into a learning mind map.

Return strict JSON only with this shape:
{"edges":[{"source":"node-id","target":"node-id","relationship":"related|depends_on|extends|supports|contradicts|duplicates|references|todo","label":"short label","important":false,"confidence":0.0,"reason":"short reason"}]}

Create at most 8 links, and only include strong semantic relationships. Do not link nodes just because they are adjacent in time. Prefer dependencies, extensions, contradictions, repeated ideas, references, or todo/follow-up items that materially help a learner understand the map. Use confidence from 0 to 1; omit weak or speculative links below 0.74.

Same-chain skip links:
- Nodes include an order field for their position in the current chain.
- Suggest links only between non-adjacent nodes on that chain.
- The number of intermediate nodes must be 1 to 4.
- The farther apart two nodes are, the stronger the evidence must be.
- Use confidence >= 0.78 for 1 intermediate node, >= 0.82 for 2, >= 0.86 for 3, and >= 0.90 for 4. Use even higher confidence for generic "related" links.

Nodes:
${JSON.stringify(nodes, null, 2)}`;
}

export async function suggestSemanticEdges(nodes: Node[]): Promise<Edge[]> {
  const settings = await loadAiSettings();
  const suggestionNodes: SuggestionNode[] = nodes
    .filter((node) => node.id !== "conversation-root")
    .map((node, fallbackOrder) => {
      const turnIndex = (node.data as { turn?: { turnIndex?: unknown } } | undefined)?.turn?.turnIndex;
      return {
        id: node.id,
        order: typeof turnIndex === "number" ? turnIndex : fallbackOrder,
        title: String(node.data?.title ?? ""),
        summary: String(node.data?.summary ?? "")
      };
    })
    .filter((node) => node.title || node.summary)
    .sort((left, right) => left.order - right.order)
    .slice(-40);

  if (suggestionNodes.length < 2) {
    throw new Error("At least two turn nodes are needed.");
  }

  const content = await requestChatCompletion(
    settings,
    [
      {
        role: "system",
        content: "Return strict JSON only. Do not include markdown fences."
      },
      {
        role: "user",
        content: buildPrompt(suggestionNodes)
      }
    ],
    { temperature: 0.1, maxTokens: 2400, jsonMode: true }
  );

  const parsed = tryExtractJsonObject(content);
  if (!parsed) return [];

  const suggestions = normalizeSuggestions(parsed, suggestionNodes);

  return suggestions.map((suggestion, index) => ({
    id: `ai-${suggestion.source}-${suggestion.target}-${Date.now()}-${index}`,
    source: suggestion.source,
    target: suggestion.target,
    label: suggestion.label,
    data: {
      relationship: suggestion.relationship,
      important: suggestion.important,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      createdBy: "ai"
    }
  }));
}
