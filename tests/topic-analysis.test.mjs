import test from "node:test";
import assert from "node:assert/strict";

import { buildTopicCandidatePairs } from "../src/side-panel/ai/topic-analysis.ts";

test("buildTopicCandidatePairs prefers high-signal distant pairs and explains shared terms", () => {
  const candidates = buildTopicCandidatePairs(
    [
      {
        id: "turn-1",
        title: "Provider compatibility plan",
        summary: "Discusses OpenAI-compatible provider presets, maxTokens, JSON mode, and API base URL handling.",
        tags: ["provider"],
        order: 0
      },
      {
        id: "turn-2",
        title: "Theme polish",
        summary: "Updates the map colors and interface layout.",
        tags: ["ui"],
        order: 1
      },
      {
        id: "turn-3",
        title: "API provider failure logs",
        summary: "Keeps provider id, host, model, JSON mode category, and maxTokens while redacting API keys.",
        tags: ["provider"],
        order: 4
      }
    ],
    { maxCandidates: 8 }
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, "turn-1");
  assert.equal(candidates[0].target, "turn-3");
  assert.equal(candidates[0].relationship, "related");
  assert.equal(candidates[0].label, "topic");
  assert.ok(candidates[0].score >= 0.74);
  assert.match(candidates[0].reason, /provider/i);
  assert.match(candidates[0].reason, /maxtokens/i);
});

test("buildTopicCandidatePairs filters weak adjacent and existing links", () => {
  const candidates = buildTopicCandidatePairs(
    [
      {
        id: "turn-1",
        title: "Export OPML",
        summary: "Adds OPML export from the Files menu.",
        tags: ["export"],
        order: 0
      },
      {
        id: "turn-2",
        title: "Export Markdown",
        summary: "Adds Markdown export and clipboard copy.",
        tags: ["export"],
        order: 1
      },
      {
        id: "turn-3",
        title: "Obsidian export",
        summary: "Exports vault Markdown and OPML metadata for review.",
        tags: ["export"],
        order: 3
      }
    ],
    {
      existingLinks: [{ source: "turn-1", target: "turn-3" }],
      maxCandidates: 8
    }
  );

  assert.deepEqual(candidates, []);
});

test("buildTopicCandidatePairs caps results and node participation", () => {
  const nodes = [
    "Provider presets",
    "Provider JSON mode",
    "Provider maxTokens",
    "Provider host permissions",
    "Provider task logs",
    "Provider privacy"
  ].map((title, index) => ({
    id: `turn-${index + 1}`,
    title,
    summary: "Provider compatibility, API settings, model defaults, host diagnostics, and task log privacy.",
    tags: ["provider"],
    order: index * 2
  }));

  const candidates = buildTopicCandidatePairs(nodes, {
    maxCandidates: 4,
    maxPairsPerNode: 2
  });

  assert.equal(candidates.length, 4);
  const counts = new Map();
  for (const candidate of candidates) {
    counts.set(candidate.source, (counts.get(candidate.source) ?? 0) + 1);
    counts.set(candidate.target, (counts.get(candidate.target) ?? 0) + 1);
  }
  assert.ok([...counts.values()].every((count) => count <= 2));
});
