import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getContentLifecycleState, startContentPhase } from "../src/content/content-lifecycle.ts";

test("content lifecycle state survives repeated entry evaluation", () => {
  const host = {};
  const first = getContentLifecycleState(host);
  const second = getContentLifecycleState(host);

  assert.equal(first, second);
});

test("content lifecycle starts each phase once", () => {
  const state = getContentLifecycleState({});
  let starts = 0;

  assert.equal(startContentPhase(state, "observer", () => starts++), true);
  assert.equal(startContentPhase(state, "observer", () => starts++), false);
  assert.equal(starts, 1);
});

test("content lifecycle allows retry after startup throws", () => {
  const state = getContentLifecycleState({});

  assert.throws(() => startContentPhase(state, "messages", () => { throw new Error("registration failed"); }));
  assert.equal(startContentPhase(state, "messages", () => undefined), true);
});

test("content entry uses one lifecycle module for UI, listeners, and observer startup", async () => {
  const source = await readFile(new URL("../src/content/index.ts", import.meta.url), "utf8");

  assert.match(source, /content-lifecycle/);
  assert.match(source, /startContentPhase\([^)]*["']observer["']/s);
  assert.doesNotMatch(source, /__chatMapContent[A-Za-z]+Started/);
});
