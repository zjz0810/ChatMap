import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildApiTaskLogExport, sanitizeTaskLogEntry } from "../src/side-panel/task-log.ts";

test("sanitizeTaskLogEntry keeps progress bounded and trims sensitive-sized messages", () => {
  const entry = sanitizeTaskLogEntry({
    id: "task-1",
    kind: "summarize",
    status: "running",
    message: "x".repeat(260),
    progress: 140,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:01.000Z"
  });

  assert.equal(entry.progress, 100);
  assert.equal(entry.message.length, 200);
  assert.equal(entry.kind, "summarize");
});

test("buildApiTaskLogExport returns portable JSON payload", () => {
  const payload = buildApiTaskLogExport([
    sanitizeTaskLogEntry({
      id: "task-1",
      kind: "summarize",
      status: "success",
      message: "Done",
      progress: 100,
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:01.000Z"
    })
  ]);

  assert.equal(payload.version, 1);
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].kind, "summarize");
});

test("sanitizeTaskLogEntry redacts provider secrets and keeps host-level diagnostics", () => {
  const entry = sanitizeTaskLogEntry({
    id: "test-connection-openai-secret-key",
    kind: "test-connection",
    status: "error",
    message:
      "invalid-api-key provider=openai host=api.openai.com model=gpt-5.4-nano key=sk-proj-secret https://api.openai.com/v1/chat/completions private user text",
    progress: 100
  });

  assert.equal(entry.id.includes("secret-key"), false);
  assert.match(entry.message, /invalid-api-key/);
  assert.match(entry.message, /host=api\.openai\.com/);
  assert.doesNotMatch(entry.message, /sk-proj-secret/);
  assert.doesNotMatch(entry.message, /\/v1\/chat\/completions/);
  assert.doesNotMatch(entry.message, /private user text/);
});

test("API task log supports local topic analysis entries", async () => {
  const source = await readFile(new URL("../src/side-panel/task-log.ts", import.meta.url), "utf8");
  assert.match(source, /"analyze-topics"/);

  const entry = sanitizeTaskLogEntry({
    id: "analyze-topics-conversation-1",
    kind: "analyze-topics",
    status: "success",
    message: "Topic analysis found 4 candidate links from local node metadata.",
    progress: 100
  });

  assert.equal(entry.kind, "analyze-topics");
  assert.doesNotMatch(entry.message, /private user text|sk-/);
});
