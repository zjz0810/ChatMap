import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cloneGraphDocument, graphDocumentKey } from "../src/side-panel/graph/graph-document.ts";

function snapshot() {
  return {
    nodes: [
      {
        id: "turn-1",
        position: { x: 10, y: 20 },
        selected: false,
        data: {
          title: "Question",
          summary: "Answer",
          tags: ["review"],
          sourceAnchors: []
        }
      }
    ],
    edges: [],
    hiddenRoot: false,
    hiddenAutoEdgeIds: [],
    hiddenNodeIds: [],
    topicGroups: []
  };
}

test("graph history identity includes document edits", () => {
  const base = snapshot();
  const baseKey = graphDocumentKey(base);
  const edits = [
    ["color", "blue"],
    ["collapsed", true],
    ["important", true],
    ["dimensions", { width: 420, height: 260, manual: true }],
    [
      "answerExpansion",
      {
        schemaVersion: 2,
        displayMode: "expanded",
        layoutDirection: "right",
        inputSource: "assistant",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
        nodes: [{ id: "mini-1", title: "Point", role: "branch", branchId: "mini-1", color: "blue" }],
        links: []
      }
    ],
    ["topicGroupId", "topic-1"]
  ];

  for (const [field, value] of edits) {
    const edited = cloneGraphDocument(base);
    edited.nodes[0].data[field] = value;
    assert.notEqual(graphDocumentKey(edited), baseKey, `${field} must participate in history identity`);
  }
});

test("graph history identity excludes transient selection", () => {
  const base = snapshot();
  const selected = cloneGraphDocument(base);
  selected.nodes[0].selected = true;

  assert.equal(graphDocumentKey(selected), graphDocumentKey(base));
});

test("graph document cloning isolates nested editable state", () => {
  const base = snapshot();
  const clone = cloneGraphDocument(base);

  clone.nodes[0].position.x = 999;
  clone.nodes[0].data.tags.push("changed");

  assert.equal(base.nodes[0].position.x, 10);
  assert.deepEqual(base.nodes[0].data.tags, ["review"]);
});

test("TurnMapCanvas consumes the graph document module", async () => {
  const source = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");

  assert.match(source, /from "\.\/graph-document\.ts"/);
  assert.doesNotMatch(source, /function snapshotKey/);
  assert.doesNotMatch(source, /function cloneSnapshot/);
});
