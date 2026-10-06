import test from "node:test";
import assert from "node:assert/strict";

import { graphIssuesSummary, repairGraphSnapshot } from "../src/side-panel/graph/graph-health.ts";

test("graph health repairs positions, dimensions, and weights", () => {
  const repaired = repairGraphSnapshot({
    nodes: [
      {
        id: "a",
        position: { x: Number.NaN, y: 4 },
        data: { dimensions: { width: Number.NaN, height: 200, manual: true } }
      },
      { id: "b", position: { x: 10, y: 10 }, data: {} }
    ],
    edges: [{ id: "ab", source: "a", target: "b", data: { relationship: "related", weight: 2 } }]
  });

  assert.equal(repaired.nodes[0].position.x, 0);
  assert.equal(repaired.nodes[0].data.dimensions, undefined);
  assert.equal(repaired.edges[0].data.weight, 1);
  assert.deepEqual(graphIssuesSummary(repaired.issues), { corrected: 3, dropped: 0, fatal: 0 });
});

test("graph health drops dangling, invalid proxy, and duplicate nodes", () => {
  const repaired = repairGraphSnapshot({
    nodes: [
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "a", position: { x: 1, y: 1 }, data: {} },
      { id: "b", position: { x: 2, y: 2 }, data: {} }
    ],
    edges: [
      { id: "dangling", source: "a", target: "missing", data: { weight: 0.2 } },
      { id: "proxy", source: "a", target: "b", data: { proxyKind: "incoming", weight: 0.5 } },
      { id: "valid", source: "a", target: "b", data: { weight: 0.8 } }
    ]
  });

  assert.deepEqual(repaired.nodes.map((node) => node.id), ["a", "b"]);
  assert.deepEqual(repaired.edges.map((edge) => edge.id), ["valid"]);
  assert.equal(graphIssuesSummary(repaired.issues).dropped, 3);
});

test("graph health reports fatal when no renderable nodes remain", () => {
  const repaired = repairGraphSnapshot({ nodes: [], edges: [] });

  assert.deepEqual(graphIssuesSummary(repaired.issues), { corrected: 0, dropped: 0, fatal: 1 });
});
