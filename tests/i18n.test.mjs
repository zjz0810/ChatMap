import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("built-in Chinese translations are readable text, not replacement question marks", async () => {
  const source = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");
  const zhBlock = source.slice(source.indexOf("export const ZH_TRANSLATIONS"));
  const keySamples = [
    "app.kicker",
    "toolbar.suggestLinks",
    "panel.nodeActions",
    "panel.linkTitle",
    "settings.customTranslationHint",
    "ai.privacy"
  ];

  for (const key of keySamples) {
    const match = zhBlock.match(new RegExp(`"${key}":\\s*"([^"]*)"`));
    assert.ok(match, `${key} should exist`);
    assert.match(match[1], /[\u4e00-\u9fff]/, `${key} should contain Chinese text`);
    assert.doesNotMatch(match[1], /\?{2,}/, `${key} should not be damaged replacement text`);
  }

  for (const match of zhBlock.matchAll(/"([^"]+)":\s*"([^"]*)"/g)) {
    assert.doesNotMatch(match[2], /\?{2,}/, `${match[1]} should not contain repeated question marks`);
    assert.doesNotMatch(match[2], /[�]|[鐞鎬瀵锛鏂鏈鎵閲鍒澶缂寮鏅閫]/, `${match[1]} should not contain mojibake`);
  }
});

test("custom AI translation interface remains an overlay on built-in labels", async () => {
  const source = await readFile(new URL("../src/localization/index.ts", import.meta.url), "utf8");

  assert.match(source, /export async function generateCustomLanguage/);
  assert.match(source, /CUSTOM_LANGUAGES_STORAGE_KEY/);
  assert.match(source, /return \{ \.\.\.EN_TRANSLATIONS, \.\.\.\(custom\?\.translations \?\? \{\}\) \};/);
});
