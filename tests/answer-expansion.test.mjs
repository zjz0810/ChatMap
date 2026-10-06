import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAnswerExpansion,
  updateMiniNode,
  deleteMiniNode,
  miniNodeDescendantIds,
  calculateMiniMapLayout,
  renderableMiniLinks,
  extractMarkdownOutlineHints,
  MINI_MAP_NODE_WIDTH,
  MINI_MAP_NODE_HEIGHT
} from "../src/side-panel/ai/answer-expansion.ts";

test("normalizeAnswerExpansion keeps schema v2 tree mini nodes and valid links", () => {
  const expansion = normalizeAnswerExpansion(
    {
      schemaVersion: 2,
      layoutDirection: "left",
      nodes: [
        { id: " intro ", title: "  Overall structure  ", role: "branch", parentId: null, branchId: "intro" },
        { id: "point-a", title: "A".repeat(120), role: "point", parentId: "intro", branchId: "intro", color: "blue", important: true },
        { id: "point-b", title: "Supporting detail", role: "summary", parentId: "intro", branchId: "wrong-branch" }
      ],
      links: [
        { id: "l-1", source: "intro", target: "point-a", relationship: "section", weight: 0.9 },
        { id: "bad", source: "intro", target: "missing", relationship: "cross", weight: 0.2 },
        { id: "self", source: "intro", target: "intro" }
      ]
    },
    { now: "2026-05-29T00:00:00.000Z", inputSource: "assistant" }
  );

  assert.equal(expansion.schemaVersion, 2);
  assert.equal(expansion.displayMode, "expanded");
  assert.equal(expansion.layoutDirection, "left");
  assert.equal(expansion.nodes.length, 3);
  assert.equal(expansion.nodes[0].id, "intro");
  assert.equal(expansion.nodes[0].title, "Overall structure");
  assert.equal("summary" in expansion.nodes[0], false);
  assert.equal(expansion.nodes[1].title.length, 80);
  assert.equal(expansion.nodes[2].branchId, "intro");
  assert.deepEqual(expansion.links.map((link) => link.id), ["l-1"]);
});

test("normalizeAnswerExpansion rejects structurally useless or oversized output", () => {
  assert.throws(
    () => normalizeAnswerExpansion({ schemaVersion: 2, nodes: [{ id: "only", title: "Only point", role: "branch", parentId: null, branchId: "only" }] }),
    /at least two/i
  );

  assert.throws(
    () =>
      normalizeAnswerExpansion({
        schemaVersion: 2,
        nodes: Array.from({ length: 81 }, (_, index) => ({
          id: `n-${index}`,
          title: `Point ${index}`,
          role: "branch",
          parentId: null,
          branchId: `n-${index}`
        }))
      }),
    /80/
  );
});

test("normalizeAnswerExpansion rejects repeated generic leaf labels without concrete details", () => {
  assert.throws(
    () =>
      normalizeAnswerExpansion({
        schemaVersion: 2,
        nodes: [
          { id: "db", title: "数据库原理", role: "branch", parentId: null, branchId: "db" },
          { id: "db-content", title: "学习内容", role: "point", parentId: "db", branchId: "db" },
          { id: "db-fit", title: "契合度", role: "point", parentId: "db", branchId: "db" },
          { id: "db-risk", title: "时间风险", role: "point", parentId: "db", branchId: "db" },
          { id: "ds", title: "数据结构", role: "branch", parentId: null, branchId: "ds" },
          { id: "ds-content", title: "学习内容", role: "point", parentId: "ds", branchId: "ds" },
          { id: "ds-fit", title: "契合度", role: "point", parentId: "ds", branchId: "ds" },
          { id: "ds-risk", title: "时间风险", role: "point", parentId: "ds", branchId: "ds" }
        ]
      }),
    /structural labels/i
  );

  const informative = normalizeAnswerExpansion({
    schemaVersion: 2,
    nodes: [
      { id: "db", title: "数据库原理", role: "branch", parentId: null, branchId: "db" },
      { id: "db-content", title: "学习内容：数据库设计与SQL", role: "point", parentId: "db", branchId: "db" },
      { id: "db-fit", title: "契合度：生信数据库管理", role: "point", parentId: "db", branchId: "db" },
      { id: "network", title: "计算机网络", role: "branch", parentId: null, branchId: "network" },
      { id: "network-risk", title: "时间风险：边际收益较低", role: "point", parentId: "network", branchId: "network" }
    ]
  });
  assert.equal(informative.nodes.length, 5);
});

test("normalizeAnswerExpansion rejects unsupported legacy and broken tree structures", () => {
  assert.throws(
    () =>
      normalizeAnswerExpansion({
        schemaVersion: 1,
        nodes: [
          { id: "root", title: "Root" },
          { id: "child", title: "Child" }
        ]
      }),
    /unsupported/i
  );

  assert.throws(
    () =>
      normalizeAnswerExpansion({
        schemaVersion: 2,
        nodes: [
          { id: "root", title: "Root", role: "branch", parentId: null, branchId: "root" },
          { id: "orphan", title: "Orphan", role: "point", parentId: "missing", branchId: "root" }
        ]
      }),
    /missing parent/i
  );

  assert.throws(
    () =>
      normalizeAnswerExpansion({
        schemaVersion: 2,
        nodes: [
          { id: "a", title: "A", role: "point", parentId: "b", branchId: "a" },
          { id: "b", title: "B", role: "point", parentId: "a", branchId: "b" }
        ]
      }),
    /cycle/i
  );
});

test("mini-node edits update titles and remove descendant subtree on delete", () => {
  const expansion = normalizeAnswerExpansion({
    schemaVersion: 2,
    nodes: [
      { id: "root", title: "Root", role: "branch", parentId: null, branchId: "root" },
      { id: "child", title: "Child", role: "point", parentId: "root", branchId: "root" },
      { id: "grandchild", title: "Grandchild", role: "detail", parentId: "child", branchId: "root" },
      { id: "sibling", title: "Sibling", role: "point", parentId: "root", branchId: "root" }
    ],
    links: [
      { id: "a", source: "root", target: "child" },
      { id: "c", source: "child", target: "grandchild" },
      { id: "b", source: "root", target: "sibling" }
    ]
  });

  const renamed = updateMiniNode(expansion, "child", { title: "  Better child  ", color: "emerald", important: true });
  assert.equal(renamed.nodes.find((node) => node.id === "child")?.title, "Better child");
  assert.equal(renamed.nodes.find((node) => node.id === "child")?.color, "emerald");
  assert.deepEqual(miniNodeDescendantIds(renamed, "child"), ["child", "grandchild"]);

  const deleted = deleteMiniNode(renamed, "child");
  assert.deepEqual(deleted.nodes.map((node) => node.id), ["root", "sibling"]);
  assert.deepEqual(deleted.links.map((link) => link.id), ["b"]);
});

test("calculateMiniMapLayout mirrors child nodes for left expansion", () => {
  const expansion = normalizeAnswerExpansion(
    {
      schemaVersion: 2,
      nodes: [
        { id: "branch", title: "Branch", role: "branch", parentId: null, branchId: "branch" },
        { id: "child", title: "Child", role: "point", parentId: "branch", branchId: "branch" }
      ],
      links: [{ id: "l", source: "branch", target: "child", relationship: "subpoint" }]
    },
    { layoutDirection: "left" }
  );

  const layout = calculateMiniMapLayout(expansion);
  assert.ok(layout.nodes.branch.x > layout.nodes.child.x);
  assert.equal(layout.nodes.branch.width, 218);
  assert.equal(layout.nodes.branch.height, 40);
  assert.equal(MINI_MAP_NODE_WIDTH, 218);
  assert.equal(MINI_MAP_NODE_HEIGHT, 40);
  assert.ok(layout.width >= 480);
  assert.ok(layout.height >= 280);
});

test("renderableMiniLinks keeps mini-map lines tied to the visible tree", () => {
  const expansion = normalizeAnswerExpansion({
    schemaVersion: 2,
    nodes: [
      { id: "lipids", title: "主要磷脂类别", role: "branch", parentId: null, branchId: "lipids" },
      { id: "pc", title: "PC：常作为背景脂质", role: "point", parentId: "lipids", branchId: "lipids" },
      { id: "pe", title: "PE：影响膜曲率", role: "point", parentId: "lipids", branchId: "lipids" },
      { id: "lipid-summary", title: "类别影响识别与命名", role: "summary", parentId: "lipids", branchId: "lipids" },
      { id: "mechanism", title: "内在调控机制", role: "branch", parentId: null, branchId: "mechanism" },
      { id: "binding", title: "直接结合改变功能", role: "point", parentId: "mechanism", branchId: "mechanism" }
    ],
    links: [
      { id: "cross-1", source: "pc", target: "binding", relationship: "subpoint" },
      { id: "cross-2", source: "lipids", target: "mechanism", relationship: "section" },
      { id: "summary-a", source: "pc", target: "lipid-summary", relationship: "summary" },
      { id: "summary-b", source: "pe", target: "lipid-summary", relationship: "summary" },
      { id: "summary-cross", source: "binding", target: "lipid-summary", relationship: "summary" }
    ]
  });

  const rendered = renderableMiniLinks(expansion);
  assert.deepEqual(
    rendered.map((link) => `${link.source}->${link.target}:${link.visualKind}`),
    [
      "lipids->pc:tree",
      "lipids->pe:tree",
      "lipids->lipid-summary:tree",
      "mechanism->binding:tree",
      "pc->lipid-summary:summary",
      "pe->lipid-summary:summary"
    ]
  );
});

test("extractMarkdownOutlineHints preserves headings, bold labels, and label details", () => {
  const hints = extractMarkdownOutlineHints(`
## 2. 单门课优先级判断

**第一优先级：数据库原理、数据结构、功能基因组学。**
数据库原理直接贴近生物信息数据库管理和工具开发。

**第二优先级：细胞生物学。**

**第三优先级：计算机网络。**

- 只选一门 CS：优先 CS0501 数据结构
  - 原因：更贴近 coding 与 AI 开发路径
`);

  assert.match(hints, /单门课优先级判断 \(heading\)/);
  assert.match(hints, /第一优先级 \(bold-label\)/);
  assert.match(hints, /数据库原理、数据结构、功能基因组学。 \(label-detail\)/);
  assert.match(hints, /第二优先级 \(bold-label\)/);
  assert.match(hints, /第三优先级 \(bold-label\)/);
  assert.match(hints, /只选一门 CS \(list\)/);
  assert.match(hints, /原因 \(list\)/);
});
