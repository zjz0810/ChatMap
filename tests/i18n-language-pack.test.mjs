import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EN_TRANSLATIONS,
  exportLanguagePack,
  generateCustomLanguage,
  missingKeys,
  placeholderMismatch,
  translationsFor,
  validateLanguagePack
} from "../src/localization/index.ts";

const MINIMAL_PACK = {
  schemaVersion: 1,
  app: "ChatMap",
  languageCode: "fr-FR",
  languageName: "Français",
  sourceLocale: "en",
  createdAt: "2026-05-20T00:00:00.000Z",
  translations: {
    "app.action.refresh": "Actualiser",
    "task.summarizeProgress": "Progression IA : {current}/{total}"
  }
};

function withChromeStorage() {
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys === "turnmap.aiSettings" || (Array.isArray(keys) && keys.includes("turnmap.aiSettings"))) {
            return {
              "turnmap.aiSettings": {
                provider: "openai",
                baseUrl: "https://api.example.test/v1",
                model: "fast-json",
                apiKey: "sk-test",
                maxTokens: 6000,
                autoSummarize: false
              }
            };
          }
          return {};
        },
        async set() {}
      }
    },
    permissions: {
      contains: async () => true,
      request: async () => true
    }
  };
}

test("language pack validation accepts metadata packs and reports missing keys without failing", () => {
  const result = validateLanguagePack(MINIMAL_PACK);

  assert.equal(result.ok, true);
  assert.equal(result.pack.languageCode, "fr-FR");
  assert.equal(result.pack.languageName, "Français");
  assert.ok(result.missingKeys.includes("app.kicker"));
  assert.equal(result.errors.length, 0);
});

test("language pack validation rejects built-in language override and placeholder mismatches", () => {
  assert.equal(placeholderMismatch("AI task progress: {current}/{total}", "Progression IA : {current}"), true);

  const result = validateLanguagePack({
    ...MINIMAL_PACK,
    languageCode: "en-US",
    translations: {
      "task.summarizeProgress": "Progression IA : {current}"
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /built-in|placeholder/i);
});

test("exported custom language pack can be validated and used with English fallback", () => {
  const language = {
    id: "fr-fr",
    label: "Français",
    languageName: "Français",
    languageCode: "fr-FR",
    schemaVersion: 1,
    sourceLocale: "en",
    translations: {
      "app.action.refresh": "Actualiser"
    },
    createdAt: "2026-05-20T00:00:00.000Z"
  };

  const exported = exportLanguagePack(language);
  const result = validateLanguagePack(exported);
  const dictionary = translationsFor("custom:fr-fr", [language]);

  assert.equal(result.ok, true);
  assert.equal(exported.app, "ChatMap");
  assert.equal(dictionary["app.action.refresh"], "Actualiser");
  assert.equal(dictionary["app.action.settings"], EN_TRANSLATIONS["app.action.settings"]);
  assert.ok(missingKeys(exported.translations).includes("app.kicker"));
});

test("generateCustomLanguage repairs invalid translation JSON once and saves the repaired language", async () => {
  withChromeStorage();

  const repairedPack = {
    ...MINIMAL_PACK,
    translations: {
      "app.action.refresh": "Actualiser",
      "task.summarizeProgress": "Progression IA : {current}/{total}"
    }
  };
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    if (requests.length === 1) {
      return new Response("Here is the translation:\n{ not valid json", { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(repairedPack) } }] }), {
      status: 200
    });
  };

  const language = await generateCustomLanguage("Français");

  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[1].content, /"languageCode":"und-fran-ais"/);
  assert.match(requests[0].messages[1].content, /"labels"/);
  assert.doesNotMatch(requests[0].messages[1].content, /private conversation/i);
  assert.match(requests[1].messages[0].content, /repair/i);
  assert.equal(language.languageCode, "und-fran-ais");
  assert.equal(language.translations["app.action.refresh"], "Actualiser");
});

test("settings page exposes language pack import and export controls", async () => {
  const source = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /settings\.languageCode/);
  assert.doesNotMatch(source, /customLanguageCode/);
  assert.match(source, /generateCustomLanguage\(customLanguageName\)/);
  assert.match(source, /settings\.importLanguagePack/);
  assert.match(source, /settings\.exportLanguagePack/);
  assert.match(source, /settings\.languagePackChooseFile/);
  assert.match(source, /settings\.languagePackNoFile/);
  assert.match(source, /settings\.languagePackSelected/);
  assert.match(source, /type="file"/);
  assert.match(source, /className="file-input"/);
  assert.match(i18nSource, /settings\.translationRepairHint/);
  assert.match(i18nSource, /"settings\.languagePackChooseFile":/);
  assert.match(i18nSource, /"settings\.languagePackNoFile":/);
  assert.match(i18nSource, /"settings\.languagePackSelected":/);
});
