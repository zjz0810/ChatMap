export type ExportTurn = {
  id: string;
  turnIndex: number;
  userText: string;
  assistantText: string;
};

export type ExportNode = {
  id: string;
  title: string;
  summary: string;
  status?: "open" | "review" | "done";
  tags?: string[];
  color?: string;
  collapsed?: boolean;
  important?: boolean;
  dimensions?: { width: number; height: number; manual: boolean };
  answerExpansion?: {
    schemaVersion?: number;
    displayMode: "expanded" | "original";
    layoutDirection?: "left" | "right";
    nodes: Array<{
      id: string;
      title: string;
      role?: string;
      parentId?: string;
      branchId?: string;
      color?: string;
      important?: boolean;
    }>;
    links?: Array<{ id?: string; source: string; target: string; relationship?: string; weight?: number }>;
  };
  turn?: ExportTurn;
  isConversationRoot?: boolean;
  position?: { x: number; y: number };
};

export type ExportEdge = {
  id?: string;
  source: string;
  target: string;
  label?: unknown;
  relationship?: string;
  important?: boolean;
  weight?: number;
  confidence?: number;
  reason?: string;
};

export type VaultMarkdownFile = {
  path: string;
  content: string;
};

export type ExportAppearance = {
  theme?: string;
  resolvedTheme?: string;
  nodeColorRendering?: {
    mode?: "gradient" | "solid";
    strength?: number;
  };
};

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function cleanTags(tags: string[] | undefined): string[] {
  return (tags ?? []).map((tag) => tag.trim()).filter(Boolean);
}

function tagLine(tags: string[] | undefined): string {
  const clean = cleanTags(tags);
  return clean.length ? clean.map((tag) => `#${tag.replace(/^#+/, "")}`).join(" ") : "";
}

function nodeOrder(left: ExportNode, right: ExportNode): number {
  if (left.isConversationRoot && !right.isConversationRoot) return -1;
  if (!left.isConversationRoot && right.isConversationRoot) return 1;
  const leftTurn = left.turn?.turnIndex ?? Number.POSITIVE_INFINITY;
  const rightTurn = right.turn?.turnIndex ?? Number.POSITIVE_INFINITY;
  if (leftTurn !== rightTurn) return leftTurn - rightTurn;
  const leftY = left.position?.y ?? 0;
  const rightY = right.position?.y ?? 0;
  if (leftY !== rightY) return leftY - rightY;
  return (left.position?.x ?? 0) - (right.position?.x ?? 0);
}

function visibleNodes(nodes: ExportNode[]): ExportNode[] {
  return [...nodes].filter((node) => !node.isConversationRoot).sort(nodeOrder);
}

function noteLines(node: ExportNode): string[] {
  return [
    node.summary,
    node.turn ? `Turn: ${node.turn.turnIndex + 1}` : "",
    node.status ? `Status: ${node.status}` : "",
    tagLine(node.tags) ? `Tags: ${tagLine(node.tags)}` : "",
    node.color ? `Color: ${node.color}` : "",
    typeof node.collapsed === "boolean" ? `Collapsed: ${node.collapsed}` : "",
    node.important ? "Important: true" : "",
    node.dimensions ? `Size: ${node.dimensions.width}x${node.dimensions.height}` : "",
    node.answerExpansion?.displayMode === "expanded"
      ? `Answer expansion (${node.answerExpansion.layoutDirection ?? "right"}):\n${node.answerExpansion.nodes
          .map((miniNode) =>
            `- ${miniNode.title}${miniNode.role ? ` [${miniNode.role}]` : ""}${
              miniNode.branchId ? ` branch:${miniNode.branchId}` : ""
            }${miniNode.parentId ? ` parent:${miniNode.parentId}` : ""}`
          )
          .join("\n")}`
      : "",
    node.turn?.userText ? `User: ${node.turn.userText.trim()}` : "",
    node.turn?.assistantText ? `Assistant: ${node.turn.assistantText.trim()}` : ""
  ].filter(Boolean);
}

function edgeRelationship(edge: ExportEdge): string {
  return edge.relationship || "related";
}

function edgeLabel(edge: ExportEdge): string {
  return typeof edge.label === "string" && edge.label.trim() ? edge.label.trim() : "";
}

function edgeConfidence(edge: ExportEdge): string {
  return typeof edge.confidence === "number" ? `${Math.round(edge.confidence * 100)}%` : "";
}

function edgeWeight(edge: ExportEdge): string {
  return typeof edge.weight === "number" ? `${Math.round(Math.max(0, Math.min(1, edge.weight)) * 100)}%` : "";
}

export function graphToOpml(conversationTitle: string, nodes: ExportNode[], edges: ExportEdge[]): string {
  const titleById = new Map(nodes.map((node) => [node.id, node.title || node.id]));
  const nodeOutlines = visibleNodes(nodes)
    .map((node) => {
      const note = noteLines(node).join("\n\n");
      return `    <outline text="${escapeXml(node.title || node.id)}" _note="${escapeXml(note)}" />`;
    })
    .join("\n");
  const linkOutlines = edges
    .map((edge) => {
      const source = titleById.get(edge.source) ?? edge.source;
      const target = titleById.get(edge.target) ?? edge.target;
      const metadata = [
        edgeRelationship(edge),
        edge.important ? "important" : "",
        edgeWeight(edge) ? `weight ${edgeWeight(edge)}` : "",
        edgeConfidence(edge),
        edgeLabel(edge),
        edge.reason || ""
      ]
        .filter(Boolean)
        .join(" | ");
      return `      <outline text="${escapeXml(`${source} -> ${target}`)}" _note="${escapeXml(metadata)}" />`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(conversationTitle)}</title>
  </head>
  <body>
    <outline text="${escapeXml(conversationTitle)}">
${nodeOutlines}
    </outline>
    <outline text="Links">
${linkOutlines}
    </outline>
  </body>
</opml>`;
}

function slugPart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "note";
}

function nodeFilename(node: ExportNode): string {
  return `${slugPart(node.id)}-${slugPart(node.title)}`.slice(0, 96);
}

function nodePath(node: ExportNode): string {
  return `nodes/${nodeFilename(node)}.md`;
}

function obsidianLink(node: ExportNode): string {
  return `[[${nodePath(node).replace(/\.md$/, "")}|${node.title || node.id}]]`;
}

function frontmatter(node: ExportNode): string {
  const lines = ["---", `id: ${yamlString(node.id)}`, `title: ${yamlString(node.title || node.id)}`];
  if (node.status) lines.push(`status: ${node.status}`);
  if (node.turn) lines.push(`turn: ${node.turn.turnIndex + 1}`);
  if (node.color) lines.push(`color: ${node.color}`);
  if (typeof node.collapsed === "boolean") lines.push(`collapsed: ${node.collapsed}`);
  if (node.important) lines.push("important: true");
  const tags = cleanTags(node.tags);
  if (tags.length) {
    lines.push("tags:");
    tags.forEach((tag) => lines.push(`  - ${tag}`));
  }
  lines.push("---");
  return lines.join("\n");
}

function nodeEdgeSection(node: ExportNode, nodesById: Map<string, ExportNode>, edges: ExportEdge[]): string {
  const related = edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  if (related.length === 0) return "";

  const lines = [
    "## Links",
    "",
    "| Direction | Node | Relationship | Label | Weight | Confidence |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  related.forEach((edge) => {
    const outgoing = edge.source === node.id;
    const other = nodesById.get(outgoing ? edge.target : edge.source);
    if (!other) return;
    lines.push(
      `| ${outgoing ? "out" : "in"} | ${obsidianLink(other)} | ${edgeRelationship(edge)} | ${edgeLabel(edge)} | ${edgeWeight(edge)} | ${edgeConfidence(edge)} |`
    );
  });
  return lines.join("\n");
}

function nodeMarkdown(node: ExportNode, nodesById: Map<string, ExportNode>, edges: ExportEdge[]): string {
  const sections = [
    frontmatter(node),
    `# ${node.title || node.id}`,
    node.summary,
    nodeEdgeSection(node, nodesById, edges)
  ].filter(Boolean);

  if (node.turn) {
    sections.push(
      ["## Source Turn", "", "**User**", "", node.turn.userText.trim(), "", "**Assistant**", "", node.turn.assistantText.trim()].join(
        "\n"
      )
    );
  }

  return `${sections.join("\n\n")}\n`;
}

function appearanceFrontmatter(appearance?: ExportAppearance): string {
  if (!appearance) return "";
  const lines = ["---"];
  if (appearance.theme) lines.push(`theme: ${appearance.theme}`);
  if (appearance.resolvedTheme) lines.push(`resolved_theme: ${appearance.resolvedTheme}`);
  if (appearance.nodeColorRendering?.mode) {
    lines.push(`node_color_render_mode: ${appearance.nodeColorRendering.mode}`);
  }
  if (typeof appearance.nodeColorRendering?.strength === "number") {
    lines.push(`node_color_render_strength: ${appearance.nodeColorRendering.strength}`);
  }
  lines.push("---");
  return lines.length > 2 ? `${lines.join("\n")}\n\n` : "";
}

function indexMarkdown(
  conversationTitle: string,
  nodes: ExportNode[],
  edges: ExportEdge[],
  appearance?: ExportAppearance
): string {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const lines = [
    `# ${conversationTitle}`,
    "",
    "Exported from ChatMap as an Obsidian vault markdown bundle.",
    "",
    "## Nodes",
    ""
  ];

  visibleNodes(nodes).forEach((node) => {
    const metadata = [
      node.turn ? `Turn ${node.turn.turnIndex + 1}` : "",
      node.status ? `Status: ${node.status}` : "",
      tagLine(node.tags)
    ]
      .filter(Boolean)
      .join(" | ");
    lines.push(`- ${obsidianLink(node)}${metadata ? ` - ${metadata}` : ""}`);
  });

  lines.push(
    "",
    "## Links",
    "",
    "| Source | Target | Relationship | Label | Weight | Confidence | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  );
  edges.forEach((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) return;
    lines.push(
      `| ${source.title} | ${target.title} | ${edgeRelationship(edge)} | ${edgeLabel(edge)} | ${edgeWeight(edge)} | ${edgeConfidence(edge)} | ${
        edge.reason ?? ""
      } |`
    );
  });

  return `${appearanceFrontmatter(appearance)}${lines.join("\n")}\n`;
}

export function graphToObsidianVaultMarkdownFiles(
  conversationTitle: string,
  nodes: ExportNode[],
  edges: ExportEdge[],
  appearance?: ExportAppearance
): VaultMarkdownFile[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return [
    { path: "index.md", content: indexMarkdown(conversationTitle, nodes, edges, appearance) },
    ...visibleNodes(nodes).map((node) => ({
      path: nodePath(node),
      content: nodeMarkdown(node, nodesById, edges)
    }))
  ];
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pushUint16(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function createZipFromTextFiles(files: VaultMarkdownFile[]): Blob {
  const encoder = new TextEncoder();
  const chunks: ArrayBuffer[] = [];
  const centralDirectory: number[] = [];
  let offset = 0;
  const timestamp = dosDateTime();

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path);
    const contentBytes = encoder.encode(file.content);
    const checksum = crc32(contentBytes);
    const localHeader: number[] = [];

    pushUint32(localHeader, 0x04034b50);
    pushUint16(localHeader, 20);
    pushUint16(localHeader, 0x0800);
    pushUint16(localHeader, 0);
    pushUint16(localHeader, timestamp.time);
    pushUint16(localHeader, timestamp.date);
    pushUint32(localHeader, checksum);
    pushUint32(localHeader, contentBytes.length);
    pushUint32(localHeader, contentBytes.length);
    pushUint16(localHeader, nameBytes.length);
    pushUint16(localHeader, 0);

    chunks.push(blobPart(Uint8Array.from(localHeader)), blobPart(nameBytes), blobPart(contentBytes));

    pushUint32(centralDirectory, 0x02014b50);
    pushUint16(centralDirectory, 20);
    pushUint16(centralDirectory, 20);
    pushUint16(centralDirectory, 0x0800);
    pushUint16(centralDirectory, 0);
    pushUint16(centralDirectory, timestamp.time);
    pushUint16(centralDirectory, timestamp.date);
    pushUint32(centralDirectory, checksum);
    pushUint32(centralDirectory, contentBytes.length);
    pushUint32(centralDirectory, contentBytes.length);
    pushUint16(centralDirectory, nameBytes.length);
    pushUint16(centralDirectory, 0);
    pushUint16(centralDirectory, 0);
    pushUint16(centralDirectory, 0);
    pushUint16(centralDirectory, 0);
    pushUint32(centralDirectory, 0);
    pushUint32(centralDirectory, offset);
    centralDirectory.push(...nameBytes);

    offset += localHeader.length + nameBytes.length + contentBytes.length;
  });

  const centralOffset = offset;
  const centralBytes = Uint8Array.from(centralDirectory);
  const endRecord: number[] = [];
  pushUint32(endRecord, 0x06054b50);
  pushUint16(endRecord, 0);
  pushUint16(endRecord, 0);
  pushUint16(endRecord, files.length);
  pushUint16(endRecord, files.length);
  pushUint32(endRecord, centralBytes.length);
  pushUint32(endRecord, centralOffset);
  pushUint16(endRecord, 0);

  return new Blob([...chunks, blobPart(centralBytes), blobPart(Uint8Array.from(endRecord))], {
    type: "application/zip"
  });
}
