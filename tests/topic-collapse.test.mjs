import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollapsedTopic,
  buildTopicGroupRecord,
  buildTopicProxyEdges,
  topicGroupHasNestedSelection
} from "../src/side-panel/graph/topic-collapse.ts";

const selectedNodes = [
  { id: "turn-1", title: "First", summary: "First answer", position: { x: 0, y: 0 }, turnIndex: 0 },
  { id: "turn-2", title: "Second", summary: "Second answer", position: { x: 300, y: 0 }, turnIndex: 1 }
];

test("topic group records preserve selected nodes and original edges", () => {
  const topic = buildCollapsedTopic({ selectedNodes, now: 1000 });
  const record = buildTopicGroupRecord({
    topic,
    selectedNodes,
    now: 1000,
    edges: [
      { id: "sequence-turn-1-turn-2", source: "turn-1", target: "turn-2", isAuto: true },
      { id: "user-turn-2-turn-3", source: "turn-2", target: "turn-3", label: "related" }
    ]
  });

  assert.deepEqual(record.memberNodeIds, ["turn-1", "turn-2"]);
  assert.equal(record.nodeSnapshots.length, 2);
  assert.equal(record.edgeSnapshots.length, 2);
  assert.equal(record.topicNodeId, topic.id);
});

test("topic proxy edges keep only boundary links and deduplicate endpoints", () => {
  const proxies = buildTopicProxyEdges({
    topicNodeId: "topic-1",
    topicGroupId: "topic-group-1",
    memberNodeIds: ["turn-1", "turn-2"],
    edges: [
      { id: "internal", source: "turn-1", target: "turn-2", label: "next" },
      { id: "incoming", source: "root", target: "turn-1", label: "topic", data: { weight: 0.82 } },
      { id: "incoming-duplicate", source: "root", target: "turn-2", label: "topic" },
      { id: "outgoing", source: "turn-2", target: "turn-3", label: "related", data: { weight: 0.64 } }
    ]
  });

  assert.deepEqual(
    proxies.map((edge) => [edge.source, edge.target, edge.proxyKind]),
    [
      ["root", "topic-1", "incoming"],
      ["topic-1", "turn-3", "outgoing"]
    ]
  );
  assert.equal(proxies[0].originalEdgeId, "incoming");
  assert.equal(proxies[0].topicGroupId, "topic-group-1");
  assert.equal(proxies[0].weight, 0.82);
  assert.equal(proxies[0].data.originalEdgeId, "incoming");
  assert.equal(proxies[0].data.topicGroupId, "topic-group-1");
  assert.equal(proxies[1].weight, 0.64);
});

test("topic group nested selections are rejected", () => {
  const topic = buildCollapsedTopic({ selectedNodes, now: 1000 });
  const record = buildTopicGroupRecord({ topic, selectedNodes, edges: [], now: 1000 });

  assert.equal(topicGroupHasNestedSelection({ selectedNodeIds: ["turn-1"], topicGroups: [record] }), true);
  assert.equal(topicGroupHasNestedSelection({ selectedNodeIds: [topic.id], topicGroups: [record] }), true);
  assert.equal(topicGroupHasNestedSelection({ selectedNodeIds: ["turn-3"], topicGroups: [record] }), false);
});
