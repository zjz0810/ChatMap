import test from "node:test";
import assert from "node:assert/strict";

import { graphToObsidianVaultMarkdownFiles, graphToOpml } from "../src/side-panel/graph/export-formats.ts";

const nodes = [
  {
    id: "conversation-root",
    title: "Research Plan",
    summary: "A conversation about a research workflow.",
    isConversationRoot: true
  },
  {
    id: "turn-1",
    title: "Collect sources",
    summary: "Find primary papers and extract metadata.",
    status: "review",
    tags: ["research", "sources"],
    color: "emerald",
    collapsed: true,
    important: true,
    turn: {
      id: "turn-1",
      turnIndex: 0,
      userText: "How should I collect sources?",
      assistantText: "Start with primary papers and record metadata."
    }
  },
  {
    id: "note-1",
    title: "Synthesis note",
    summary: "Group papers by method and claim.",
    status: "open",
    tags: ["note"]
  }
];

const edges = [
  {
    id: "edge-1",
    source: "turn-1",
    target: "note-1",
    label: "feeds",
    relationship: "supports",
    important: true,
    weight: 0.74,
    confidence: 0.86,
    reason: "The source collection feeds the synthesis note."
  }
];

const appearance = {
  theme: "night",
  resolvedTheme: "night",
  nodeColorRendering: {
    mode: "solid",
    strength: 86
  }
};

test("graphToOpml exports nodes and relationship metadata", () => {
  const opml = graphToOpml("Research Plan", nodes, edges);

  assert.match(opml, /<opml version="2.0">/);
  assert.match(opml, /<title>Research Plan<\/title>/);
  assert.match(opml, /<outline text="Collect sources"/);
  assert.match(opml, /Status: review/);
  assert.match(opml, /Tags: #research #sources/);
  assert.match(opml, /Color: emerald/);
  assert.match(opml, /Collapsed: true/);
  assert.match(opml, /Important: true/);
  assert.match(opml, /Turn: 1/);
  assert.match(opml, /<outline text="Links">/);
  assert.match(opml, /Collect sources -&gt; Synthesis note/);
  assert.match(opml, /supports/);
  assert.match(opml, /weight 74%/);
  assert.match(opml, /86%/);
});

test("graphToObsidianVaultMarkdownFiles creates an index and node notes", () => {
  const files = graphToObsidianVaultMarkdownFiles("Research Plan", nodes, edges, appearance);
  const byPath = new Map(files.map((file) => [file.path, file.content]));

  assert.ok(byPath.has("index.md"));
  assert.ok(byPath.has("nodes/turn-1-collect-sources.md"));
  assert.ok(byPath.has("nodes/note-1-synthesis-note.md"));

  const index = byPath.get("index.md") ?? "";
  assert.match(index, /# Research Plan/);
  assert.match(index, /theme: night/);
  assert.match(index, /node_color_render_mode: solid/);
  assert.match(index, /node_color_render_strength: 86/);
  assert.match(index, /\[\[nodes\/turn-1-collect-sources\|Collect sources\]\]/);
  assert.match(index, /Collect sources \| Synthesis note \| supports \| feeds \| 74% \| 86%/);

  const turnNote = byPath.get("nodes/turn-1-collect-sources.md") ?? "";
  assert.match(turnNote, /tags:\n  - research\n  - sources/);
  assert.match(turnNote, /status: review/);
  assert.match(turnNote, /color: emerald/);
  assert.match(turnNote, /collapsed: true/);
  assert.match(turnNote, /important: true/);
  assert.match(turnNote, /## Source Turn/);
  assert.match(turnNote, /How should I collect sources\?/);
  assert.match(turnNote, /\[\[nodes\/note-1-synthesis-note\|Synthesis note\]\]/);
});
