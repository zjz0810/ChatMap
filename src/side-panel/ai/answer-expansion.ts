import type { Turn } from "../../shared/types.ts";
import { loadAiSettings } from "../settings/ai-settings-storage.ts";
import { extractJsonObject } from "./json-output.ts";
import { requestChatCompletion } from "./openai-compatible.ts";

export type MiniLinkRelationship = "section" | "subpoint" | "summary";
export type MiniNodeRole = "branch" | "point" | "detail" | "summary";
export type MiniMapLayoutDirection = "left" | "right";

export type AnswerMiniNode = {
  id: string;
  title: string;
  role: MiniNodeRole;
  parentId?: string;
  branchId: string;
  color?: string;
  important?: boolean;
};

export type AnswerMiniLink = {
  id: string;
  source: string;
  target: string;
  relationship?: MiniLinkRelationship;
  weight?: number;
};

export type AnswerExpansion = {
  schemaVersion: 2;
  displayMode: "expanded" | "original";
  layoutDirection: MiniMapLayoutDirection;
  inputSource: "assistant" | "summary";
  createdAt: string;
  updatedAt: string;
  nodes: AnswerMiniNode[];
  links: AnswerMiniLink[];
};

export const MAX_MINI_NODES = 80;
export const TARGET_MINI_NODES = "8-22";
export const MAX_MINI_DEPTH = 5;
export const MINI_MAP_NODE_WIDTH = 218;
export const MINI_MAP_NODE_HEIGHT = 40;
export const MINI_MAP_X_GAP = 44;
export const MINI_MAP_Y_GAP = 10;
export const MINI_MAP_PADDING = 20;
export const MINI_MAP_MIN_WIDTH = 480;
export const MINI_MAP_MIN_HEIGHT = 280;
export const MINI_MAP_MAX_AUTO_WIDTH = 2000;
const MAX_TITLE_LENGTH = 80;
const MAX_OUTLINE_HINTS = 42;
const RELATIONSHIPS: MiniLinkRelationship[] = ["section", "subpoint", "summary"];
const ROLES: MiniNodeRole[] = ["branch", "point", "detail", "summary"];
const BRANCH_COLORS = ["red", "amber", "emerald", "cyan", "blue", "violet", "rose", "slate"];
const GENERIC_STRUCTURE_TITLES = new Set([
  "learning content",
  "content",
  "fit",
  "alignment",
  "compatibility",
  "time risk",
  "risk",
  "reason",
  "conclusion",
  "suggestion",
  "recommendation",
  "summary",
  "学习内容",
  "内容",
  "契合度",
  "匹配度",
  "适配度",
  "时间风险",
  "风险",
  "原因",
  "结论",
  "建议",
  "推荐",
  "总结"
]);

export type AnswerExpansionProgressStage = "prepare" | "outline" | "request" | "validate";

type NormalizeOptions = {
  now?: string;
  inputSource?: "assistant" | "summary";
  displayMode?: "expanded" | "original";
  layoutDirection?: MiniMapLayoutDirection;
  previousCreatedAt?: string;
};

function compactId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || fallback
  );
}

function compactTitle(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH) : "";
}

function normalizedWeight(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function normalizedRelationship(value: unknown): MiniLinkRelationship | undefined {
  return typeof value === "string" && RELATIONSHIPS.includes(value as MiniLinkRelationship)
    ? (value as MiniLinkRelationship)
    : undefined;
}

function normalizedRole(value: unknown): MiniNodeRole | undefined {
  return typeof value === "string" && ROLES.includes(value as MiniNodeRole) ? (value as MiniNodeRole) : undefined;
}

function normalizedLayoutDirection(value: unknown): MiniMapLayoutDirection {
  return value === "left" ? "left" : "right";
}

function parentIdFromValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  return compactId(value, "");
}

function depthForNode(
  nodeId: string,
  nodeById: Map<string, AnswerMiniNode>,
  stack: string[] = []
): number {
  const node = nodeById.get(nodeId);
  if (!node) return 0;
  if (!node.parentId) return 1;
  if (stack.includes(nodeId)) {
    throw new Error("AI expansion response contains a mini-node cycle.");
  }
  return 1 + depthForNode(node.parentId, nodeById, [...stack, nodeId]);
}

function branchIdForNode(node: AnswerMiniNode, nodeById: Map<string, AnswerMiniNode>): string {
  if (!node.parentId) return node.id;
  const parent = nodeById.get(node.parentId);
  return parent ? branchIdForNode(parent, nodeById) : node.branchId;
}

function titleKey(title: string): string {
  return title
    .replace(/[：:：].*$/, "")
    .replace(/[，,。、；;（）()[\]{}"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isGenericStructureTitle(title: string): boolean {
  const key = titleKey(title);
  if (GENERIC_STRUCTURE_TITLES.has(key)) return true;
  return /^(learning content|content|fit|alignment|time risk|risk|reason|summary) ?\d*$/i.test(key);
}

function assertInformativeMiniNodes(nodes: AnswerMiniNode[]): void {
  const childrenByParent = new Map<string, number>();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    childrenByParent.set(node.parentId, (childrenByParent.get(node.parentId) ?? 0) + 1);
  });
  const leafNodes = nodes.filter((node) => !childrenByParent.has(node.id));
  const titleCounts = new Map<string, number>();
  leafNodes.forEach((node) => {
    const key = titleKey(node.title);
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  });

  const repeatedGenericTitle = [...titleCounts.entries()].some(
    ([key, count]) => count >= 3 && GENERIC_STRUCTURE_TITLES.has(key)
  );
  const genericLeafCount = leafNodes.filter((node) => isGenericStructureTitle(node.title)).length;
  const genericLeafRatio = leafNodes.length === 0 ? 0 : genericLeafCount / leafNodes.length;
  if (repeatedGenericTitle || (genericLeafCount >= 4 && genericLeafRatio >= 0.3)) {
    throw new Error("AI expansion response used repeated structural labels without answer-specific details.");
  }
}

export function normalizeAnswerExpansion(value: unknown, options: NormalizeOptions = {}): AnswerExpansion {
  const record = (value ?? {}) as {
    schemaVersion?: unknown;
    nodes?: unknown;
    links?: unknown;
    displayMode?: unknown;
    inputSource?: unknown;
    layoutDirection?: unknown;
  };
  if (record.schemaVersion != null && record.schemaVersion !== 2) {
    throw new Error("AI expansion response uses an unsupported mini-map schema.");
  }
  if (!Array.isArray(record.nodes)) {
    throw new Error("AI expansion response missed mini nodes.");
  }
  if (record.nodes.length > MAX_MINI_NODES) {
    throw new Error(`AI expansion response exceeded the ${MAX_MINI_NODES} mini-node limit.`);
  }

  const seenIds = new Set<string>();
  const nodes: AnswerMiniNode[] = record.nodes
    .map((node, index) => {
      const item = node as Record<string, unknown>;
      let id = compactId(item.id, `mini-${index + 1}`);
      while (seenIds.has(id)) {
        id = `${id}-${index + 1}`;
      }
      seenIds.add(id);
      return {
        id,
        title: compactTitle(item.title),
        role: normalizedRole(item.role) ?? (!parentIdFromValue(item.parentId) ? "branch" : "point"),
        parentId: parentIdFromValue(item.parentId),
        branchId: compactId(item.branchId, ""),
        color: typeof item.color === "string" && item.color.trim() ? item.color.trim().slice(0, 32) : undefined,
        important: typeof item.important === "boolean" ? item.important : undefined
      };
    })
    .filter((node) => node.title);

  if (nodes.length < 2) {
    throw new Error("AI expansion response needs at least two meaningful mini nodes.");
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  nodes.forEach((node) => {
    if (node.parentId && !nodeIds.has(node.parentId)) {
      throw new Error("AI expansion response contains a mini node with a missing parent.");
    }
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  nodes.forEach((node) => {
    const depth = depthForNode(node.id, nodeById);
    if (depth > MAX_MINI_DEPTH) {
      throw new Error(`AI expansion response exceeded the ${MAX_MINI_DEPTH}-level mini-map depth limit.`);
    }
  });

  const branchIds = new Set(nodes.filter((node) => !node.parentId).map((node) => node.id));
  let branchIndex = 0;
  nodes.forEach((node) => {
    node.branchId = branchIdForNode(node, nodeById);
    if (!branchIds.has(node.branchId)) {
      throw new Error("AI expansion response contains an invalid branch id.");
    }
    if (!node.parentId) {
      node.role = node.role === "summary" ? "summary" : "branch";
      node.color = node.color ?? BRANCH_COLORS[branchIndex % BRANCH_COLORS.length];
      branchIndex += 1;
    } else {
      const branch = nodeById.get(node.branchId);
      node.color = node.color ?? branch?.color;
    }
  });
  assertInformativeMiniNodes(nodes);

  const seenLinks = new Set<string>();
  const links: AnswerMiniLink[] = [];
  (Array.isArray(record.links) ? record.links : []).forEach((link, index) => {
      const item = link as Record<string, unknown>;
      const source = compactId(item.source, "");
      const target = compactId(item.target, "");
      const key = `${source}->${target}`;
      if (!source || !target || source === target || !nodeIds.has(source) || !nodeIds.has(target) || seenLinks.has(key)) {
        return;
      }
      seenLinks.add(key);
      links.push({
        id: compactId(item.id, `mini-link-${index + 1}`),
        source,
        target,
        relationship: normalizedRelationship(item.relationship),
        weight: normalizedWeight(item.weight)
      });
    });

  const now = options.now ?? new Date().toISOString();
  return {
    schemaVersion: 2,
    displayMode:
      options.displayMode ??
      (record.displayMode === "original" || record.displayMode === "expanded" ? record.displayMode : "expanded"),
    layoutDirection: options.layoutDirection ?? normalizedLayoutDirection(record.layoutDirection),
    inputSource:
      options.inputSource ??
      (record.inputSource === "summary" || record.inputSource === "assistant" ? record.inputSource : "assistant"),
    createdAt: options.previousCreatedAt ?? now,
    updatedAt: now,
    nodes,
    links
  };
}

export function updateMiniNode(
  expansion: AnswerExpansion,
  nodeId: string,
  updates: Partial<Pick<AnswerMiniNode, "title" | "color" | "important">>
): AnswerExpansion {
  return {
    ...expansion,
    updatedAt: new Date().toISOString(),
    nodes: expansion.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            title: updates.title != null ? compactTitle(updates.title) || node.title : node.title,
            color: updates.color,
            important: updates.important
          }
        : node
    )
  };
}

export function miniNodeDescendantIds(expansion: AnswerExpansion, nodeId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  expansion.nodes.forEach((node) => {
    if (!node.parentId) return;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  });
  const ids: string[] = [];
  const visit = (currentId: string) => {
    ids.push(currentId);
    (childrenByParent.get(currentId) ?? []).forEach(visit);
  };
  visit(nodeId);
  return ids;
}

export function deleteMiniNode(expansion: AnswerExpansion, nodeId: string): AnswerExpansion {
  const deleteIds = new Set(miniNodeDescendantIds(expansion, nodeId));
  return {
    ...expansion,
    updatedAt: new Date().toISOString(),
    nodes: expansion.nodes.filter((node) => !deleteIds.has(node.id)),
    links: expansion.links.filter((link) => !deleteIds.has(link.source) && !deleteIds.has(link.target))
  };
}

type MiniLayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
};

export type MiniMapLayout = {
  width: number;
  height: number;
  nodes: Record<string, MiniLayoutNode>;
};

export type RenderableMiniLink = AnswerMiniLink & {
  visualKind: "tree" | "summary";
};

function nodeMap(expansion: AnswerExpansion): Map<string, AnswerMiniNode> {
  return new Map(expansion.nodes.map((node) => [node.id, node]));
}

export function renderableMiniLinks(expansion: AnswerExpansion): RenderableMiniLink[] {
  const byId = nodeMap(expansion);
  const links: RenderableMiniLink[] = [];
  const seen = new Set<string>();

  for (const node of expansion.nodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue;
    const relationship: MiniLinkRelationship = node.role === "summary" ? "summary" : "subpoint";
    const key = `${node.parentId}->${node.id}->tree`;
    seen.add(key);
    links.push({
      id: `mini-tree-${node.parentId}-${node.id}`,
      source: node.parentId,
      target: node.id,
      relationship,
      weight: relationship === "summary" ? 0.35 : 0.78,
      visualKind: "tree"
    });
  }

  for (const link of expansion.links) {
    if (link.relationship !== "summary") continue;
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target || source.id === target.id) continue;
    if (target.role !== "summary") continue;
    if (!target.parentId || source.parentId !== target.parentId) continue;
    if (source.branchId !== target.branchId || source.role === "summary") continue;
    const key = `${source.id}->${target.id}->summary`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      ...link,
      id: link.id || `mini-summary-${source.id}-${target.id}`,
      visualKind: "summary"
    });
  }

  return links;
}

function subtreeLeafCount(nodeId: string, childrenByParent: Map<string, AnswerMiniNode[]>): number {
  const children = childrenByParent.get(nodeId) ?? [];
  if (children.length === 0) return 1;
  return children.reduce((total, child) => total + subtreeLeafCount(child.id, childrenByParent), 0);
}

export function calculateMiniMapLayout(expansion: AnswerExpansion): MiniMapLayout {
  const childrenByParent = new Map<string, AnswerMiniNode[]>();
  expansion.nodes.forEach((node) => {
    if (!node.parentId) return;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  });
  const roots = expansion.nodes.filter((node) => !node.parentId);
  const maxDepth = Math.max(
    1,
    ...expansion.nodes.map((node) => {
      let depth = 1;
      let current = node;
      const seen = new Set<string>();
      while (current.parentId && !seen.has(current.id)) {
        seen.add(current.id);
        const parent = expansion.nodes.find((candidate) => candidate.id === current.parentId);
        if (!parent) break;
        current = parent;
        depth += 1;
      }
      return depth;
    })
  );
  const contentWidth = maxDepth * MINI_MAP_NODE_WIDTH + Math.max(0, maxDepth - 1) * MINI_MAP_X_GAP;
  const width = Math.max(MINI_MAP_MIN_WIDTH, Math.min(MINI_MAP_MAX_AUTO_WIDTH, contentWidth + MINI_MAP_PADDING * 2));
  const nodes: Record<string, MiniLayoutNode> = {};
  let cursorY = MINI_MAP_PADDING;

  const place = (node: AnswerMiniNode, depth: number, yTop: number): number => {
    const children = childrenByParent.get(node.id) ?? [];
    const leafCount = subtreeLeafCount(node.id, childrenByParent);
    const subtreeHeight = Math.max(
      MINI_MAP_NODE_HEIGHT,
      leafCount * MINI_MAP_NODE_HEIGHT + Math.max(0, leafCount - 1) * MINI_MAP_Y_GAP
    );
    const x =
      expansion.layoutDirection === "left"
        ? width - MINI_MAP_PADDING - depth * MINI_MAP_NODE_WIDTH - Math.max(0, depth) * MINI_MAP_X_GAP
        : MINI_MAP_PADDING + depth * (MINI_MAP_NODE_WIDTH + MINI_MAP_X_GAP);
    nodes[node.id] = {
      id: node.id,
      x,
      y: yTop + (subtreeHeight - MINI_MAP_NODE_HEIGHT) / 2,
      width: MINI_MAP_NODE_WIDTH,
      height: MINI_MAP_NODE_HEIGHT,
      depth: depth + 1
    };
    let childY = yTop;
    children.forEach((child) => {
      const childHeight =
        subtreeLeafCount(child.id, childrenByParent) * MINI_MAP_NODE_HEIGHT +
        Math.max(0, subtreeLeafCount(child.id, childrenByParent) - 1) * MINI_MAP_Y_GAP;
      place(child, depth + 1, childY);
      childY += Math.max(MINI_MAP_NODE_HEIGHT, childHeight) + MINI_MAP_Y_GAP;
    });
    return subtreeHeight;
  };

  roots.forEach((root) => {
    const height = place(root, 0, cursorY);
    cursorY += height + MINI_MAP_Y_GAP * 2;
  });

  const height = Math.max(MINI_MAP_MIN_HEIGHT, cursorY + MINI_MAP_PADDING);
  return { width, height, nodes };
}

function readableText(text: string, maxLength: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanMarkdownLabel(value: string): string {
  return value
    .replace(/^\s*#+\s*/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)、]|[一二三四五六七八九十]+[.)、])\s*/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLabelDetail(value: string): { label: string; detail?: string } {
  const cleaned = cleanMarkdownLabel(value);
  const colonIndex = cleaned.search(/[：:]/);
  if (colonIndex > 0 && colonIndex <= 28) {
    const label = cleaned.slice(0, colonIndex).trim();
    const detail = cleaned.slice(colonIndex + 1).trim();
    if (label && detail) return { label, detail };
  }
  return { label: cleaned };
}

function outlineLine(level: number, title: string, source: string): string {
  return `${"  ".repeat(Math.max(0, level - 1))}- ${title.slice(0, MAX_TITLE_LENGTH)} (${source})`;
}

export function extractMarkdownOutlineHints(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const hints: string[] = [];
  let inCodeBlock = false;

  const pushHint = (level: number, title: string, source: string, detail?: string) => {
    const cleanedTitle = cleanMarkdownLabel(title);
    if (!cleanedTitle || hints.length >= MAX_OUTLINE_HINTS) return;
    hints.push(outlineLine(level, cleanedTitle, source));
    const cleanedDetail = detail ? cleanMarkdownLabel(detail) : "";
    if (cleanedDetail && hints.length < MAX_OUTLINE_HINTS) {
      hints.push(outlineLine(Math.min(MAX_MINI_DEPTH, level + 1), cleanedDetail, "label-detail"));
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^```|^~~~/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const { label, detail } = splitLabelDetail(heading[2]);
      pushHint(Math.min(MAX_MINI_DEPTH, heading[1].length), label, "heading", detail);
      continue;
    }

    const listItem = /^(\s*)([-*+]|\d+[.)、]|[一二三四五六七八九十]+[.)、])\s+(.+)$/.exec(line);
    if (listItem) {
      const indentLevel = Math.floor(listItem[1].length / 2);
      const { label, detail } = splitLabelDetail(listItem[3]);
      pushHint(Math.min(MAX_MINI_DEPTH, indentLevel + 2), label, "list", detail);
      continue;
    }

    const bold = /^(?:\*\*|__)(.+?)(?:\*\*|__)(.*)$/.exec(trimmed);
    if (bold) {
      const tail = bold[2]?.trim() ?? "";
      const { label, detail } = splitLabelDetail(`${bold[1]}${tail.startsWith("：") || tail.startsWith(":") ? tail : ""}`);
      pushHint(2, label, "bold-label", detail || (tail && !tail.startsWith("：") && !tail.startsWith(":") ? tail : undefined));
      continue;
    }

    const plainLabel = /^(.{2,28}?[：:])\s*(.{1,160})$/.exec(trimmed);
    if (plainLabel && !/^https?:\/\//i.test(trimmed)) {
      const { label, detail } = splitLabelDetail(trimmed);
      pushHint(2, label, "label", detail);
    }
  }

  if (hints.length === 0) {
    return "No strong Markdown outline cues detected.";
  }
  return hints.join("\n");
}

function buildExpansionPrompt(input: { userText?: string; assistantText: string; inputSource: "assistant" | "summary" }): string {
  const outlineHints = extractMarkdownOutlineHints(input.assistantText);
  return `Decompose one assistant answer into a compact mini mind map for an editable knowledge map.

Return strict JSON only with this shape:
{"schemaVersion":2,"nodes":[{"id":"short-id","title":"short point title","role":"branch|point|detail|summary","parentId":null,"branchId":"top-branch-id"}],"links":[{"source":"short-id","target":"short-id","relationship":"section|subpoint|summary","weight":0.0}]}

Rules:
- Use the same language as the assistant answer.
- Decompose only the assistant answer. The user question is context only and must not become a mini node.
- Mini nodes have title only. Do not include summaries or long original text.
- Do not include a visible root/center node. Top-level nodes are first-level branches with parentId null.
- Every non-top-level node must have exactly one parentId.
- branchId must be the id of the top-level branch that contains the node.
- Treat Markdown headings, bold section starters, numbered lists, bullet indentation, and short "label: detail" lines as primary hierarchy cues.
- Preserve explicit document structure before inventing semantic groupings. Do not flatten a section heading and its bold/list items into unrelated sibling cards.
- For a line like "**First priority: A, B, C**" or "第一优先级：A、B、C", create a "First priority/第一优先级" node and put the course/items as a child or a concise next-level title when useful.
- Prefer deeper parent-child chains for priority judgments, decision criteria, causes, steps, evidence levels, and recommendations instead of a vertical list of same-level cards.
- The parenthetical cue labels in the detected outline, such as "(heading)" and "(bold-label)", are metadata only. Do not include them in mini-node titles.
- The mini-map must cover the answer's key information, not just its abstract outline. Include concrete entities, courses, methods, tradeoffs, reasons, numbers, or final recommendations from the answer.
- Do not use bare structural placeholders as leaf nodes, such as "learning content", "fit", "time risk", "学习内容", "契合度", or "时间风险". If those dimensions matter, merge them with concrete content, for example "契合度：数据库管理/AI 工具开发" or "时间风险：本学期压力低时可选".
- Repeated generic leaf titles are invalid. Each terminal node should carry answer-specific information that remains useful if read alone.
- Prefer ${TARGET_MINI_NODES} mini nodes for ordinary answers. Use fewer for short answers.
- Use more nodes only for information-dense answers with clear sections, categories, methods, evidence levels, or decision criteria.
- Never add nodes to approach the upper limit. Never split one simple sentence into multiple mini nodes.
- Dense research/background answers may use up to ${MAX_MINI_NODES} mini nodes. Never return more than ${MAX_MINI_NODES}.
- Use at most ${MAX_MINI_DEPTH} visible levels. The fifth level is only for necessary terminal points or summary nodes. Compress deeper details into fourth-level titles.
- Keep every title under ${MAX_TITLE_LENGTH} characters.
- Prefer section, subpoint, and summary links within the local structure.
- Summary links should stay inside one branch and point from two or more sibling/local source nodes to a concise summary node when appropriate.
- Avoid cross-branch links unless essential; keep the graph visually clean and with few line crossings.
- Do not include hidden reasoning, tool workflow, system instructions, or browser actions.

Input source: ${input.inputSource}

Detected Markdown / outline cues from the answer:
${outlineHints}

User question context:
${readableText(input.userText ?? "", 2600)}

Assistant answer to decompose:
${readableText(input.assistantText, 10000)}`;
}

export async function expandTurnAnswer(
  turn: Turn,
  fallbackSummary?: string,
  options: { onProgress?: (stage: AnswerExpansionProgressStage) => void } = {}
): Promise<AnswerExpansion> {
  options.onProgress?.("prepare");
  const settings = await loadAiSettings();
  const assistantText = turn.assistantText.trim() || fallbackSummary?.trim() || "";
  const inputSource = turn.assistantText.trim() ? "assistant" : "summary";
  if (!assistantText) {
    throw new Error("Node expansion needs readable answer text.");
  }

  options.onProgress?.("outline");
  const prompt = buildExpansionPrompt({ userText: turn.userText, assistantText, inputSource });
  options.onProgress?.("request");
  const content = await requestChatCompletion(
    settings,
    [
      {
        role: "system",
        content: "Return strict JSON only. Do not include markdown fences, commentary, or reasoning."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    { temperature: 0.1, maxTokens: 2400, jsonMode: true }
  );

  options.onProgress?.("validate");
  return normalizeAnswerExpansion(extractJsonObject(content), { inputSource });
}
