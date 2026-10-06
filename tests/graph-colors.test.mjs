import test from "node:test";
import assert from "node:assert/strict";

import { NODE_COLOR_OPTIONS, colorForRelationship } from "../src/side-panel/graph/graph-colors.ts";

test("node color palette has eight distinct standard colors", () => {
  assert.equal(NODE_COLOR_OPTIONS.length, 8);
  assert.equal(new Set(NODE_COLOR_OPTIONS.map((item) => item.value)).size, 8);
});

test("relationship colors reuse the node palette", () => {
  const palette = new Set(NODE_COLOR_OPTIONS.map((item) => item.value));
  assert.equal(palette.has(colorForRelationship("depends_on")), true);
  assert.equal(palette.has(colorForRelationship("todo")), true);
});

test("palette uses high contrast yellow and dark brown options", () => {
  const colors = Object.fromEntries(NODE_COLOR_OPTIONS.map((item) => [item.name, item.value]));
  assert.equal(colors.amber, "#facc15");
  assert.equal(colors.rose, "#5c4033");
});
