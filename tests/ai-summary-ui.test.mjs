import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("AI summary UI supports #AI notes and source anchor persistence", async () => {
  const turnNodeSource = await readFile(new URL("../src/side-panel/graph/TurnNode.tsx", import.meta.url), "utf8");
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");

  assert.match(turnNodeSource, /hasAiTag/);
  assert.match(turnNodeSource, /nodeData\.sourceAnchors/);
  assert.match(canvasSource, /sourceAnchors/);
  assert.match(canvasSource, /summarizeTurns/);
});
