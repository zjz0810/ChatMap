import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_AI_EDGE_WEIGHT,
  DEFAULT_USER_EDGE_WEIGHT,
  edgeStrokeOpacity,
  edgeStrokeWidth,
  normalizeEdgeWeight,
  weightFromConfidence,
  weightPercent
} from "../src/side-panel/graph/edge-weight.ts";

test("edge weights clamp and default predictably", () => {
  assert.equal(normalizeEdgeWeight(undefined), DEFAULT_USER_EDGE_WEIGHT);
  assert.equal(normalizeEdgeWeight(-1), 0);
  assert.equal(normalizeEdgeWeight(2), 1);
  assert.equal(normalizeEdgeWeight("0.333"), 0.33);
});

test("confidence maps to visible weights", () => {
  assert.equal(weightFromConfidence(undefined), DEFAULT_AI_EDGE_WEIGHT);
  assert.equal(weightFromConfidence(0.9), 0.89);
  assert.equal(weightPercent(0.615), 62);
});

test("weight affects stroke width and opacity", () => {
  assert.ok(edgeStrokeWidth(1) > edgeStrokeWidth(0));
  assert.ok(edgeStrokeWidth(1) >= 9);
  assert.ok(edgeStrokeOpacity(1) > edgeStrokeOpacity(0));
  assert.ok(edgeStrokeWidth(0.5, true) > edgeStrokeWidth(0.5, false));
});
