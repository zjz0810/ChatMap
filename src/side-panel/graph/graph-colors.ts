export type NodeColorName =
  | "slate"
  | "blue"
  | "emerald"
  | "amber"
  | "red"
  | "violet"
  | "cyan"
  | "rose";

export type EdgeRelationship =
  | "related"
  | "depends_on"
  | "extends"
  | "supports"
  | "contradicts"
  | "duplicates"
  | "references"
  | "todo";

export type NodeColorOption = {
  name: NodeColorName;
  value: string;
};

export const NODE_COLOR_OPTIONS: NodeColorOption[] = [
  { name: "slate", value: "#64748b" },
  { name: "blue", value: "#2563eb" },
  { name: "emerald", value: "#059669" },
  { name: "amber", value: "#facc15" },
  { name: "red", value: "#dc2626" },
  { name: "violet", value: "#8b5cf6" },
  { name: "cyan", value: "#0891b2" },
  { name: "rose", value: "#5c4033" }
];

const COLOR_BY_NAME = Object.fromEntries(NODE_COLOR_OPTIONS.map((color) => [color.name, color.value])) as Record<
  NodeColorName,
  string
>;

const RELATIONSHIP_COLOR_NAMES: Record<EdgeRelationship, NodeColorName> = {
  related: "slate",
  depends_on: "violet",
  extends: "blue",
  supports: "emerald",
  contradicts: "red",
  duplicates: "amber",
  references: "cyan",
  todo: "rose"
};

export function isNodeColorName(value: unknown): value is NodeColorName {
  return typeof value === "string" && value in COLOR_BY_NAME;
}

export function colorValue(name?: NodeColorName): string | undefined {
  return name ? COLOR_BY_NAME[name] : undefined;
}

export function colorForRelationship(relationship: EdgeRelationship): string {
  return COLOR_BY_NAME[RELATIONSHIP_COLOR_NAMES[relationship]];
}
