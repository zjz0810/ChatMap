import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI settings form renders provider options from metadata and clears API key on provider switch", async () => {
  const source = await readFile(new URL("../src/side-panel/settings/AiSettingsForm.tsx", import.meta.url), "utf8");

  assert.match(source, /aiProviderOptions\.map/);
  assert.doesNotMatch(source, /<option value="deepseek">DeepSeek<\/option>/);
  assert.match(source, /apiKey:\s*""/);
  assert.match(source, /maxTokens:\s*current\.maxTokens/);
  assert.match(source, /autoSummarize:\s*current\.autoSummarize/);
  assert.match(source, /providerNoteKey/);
});

test("AI max token settings keep a conservative default and higher cap", async () => {
  const storageSource = await readFile(new URL("../src/side-panel/settings/ai-settings-storage.ts", import.meta.url), "utf8");
  const compatibleSource = await readFile(new URL("../src/side-panel/ai/openai-compatible.ts", import.meta.url), "utf8");
  const formSource = await readFile(new URL("../src/side-panel/settings/AiSettingsForm.tsx", import.meta.url), "utf8");

  assert.match(storageSource, /DEFAULT_MAX_TOKENS\s*=\s*4000/);
  assert.match(storageSource, /MAX_MAX_TOKENS\s*=\s*24000/);
  assert.match(compatibleSource, /MAX_REQUEST_MAX_TOKENS\s*=\s*24000/);
  assert.match(formSource, /max=\{MAX_MAX_TOKENS\}/);
});

test("AI provider i18n explains raw API key, preset limits, and endpoint ids", async () => {
  const source = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  for (const key of [
    "ai.apiKeyRawHint",
    "ai.providerNote.openai",
    "ai.providerNote.doubao",
    "ai.providerNote.geminiCompatible",
    "ai.providerPresetLimit"
  ]) {
    assert.match(source, new RegExp(`"${key}":`), `${key} should exist`);
  }
  assert.match(source, /raw API key/);
  assert.match(source, /endpoint ID/);
  assert.match(source, /Bearer/);
  assert.match(source, /API Key 原文/);
});
