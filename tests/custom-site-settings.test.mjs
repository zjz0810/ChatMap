import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("settings page renders a dedicated custom sites workspace", () => {
  const main = readFileSync(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/settings-page/CustomSitesSettingsPanel.tsx", import.meta.url), "utf8");

  assert.match(main, /CustomSitesSettingsPanel/);
  assert.match(main, /<CustomSitesSettingsPanel\s*\/?>/);
  assert.match(panel, /loadCustomSiteProfiles/);
  assert.match(panel, /saveCustomSiteProfiles/);
  assert.match(panel, /createCustomSiteProfile/);
  assert.match(panel, /validateCustomSiteProfileDraft/);
});

test("custom sites UI exposes permission-gated preview and complete local profile actions", () => {
  const panel = readFileSync(new URL("../src/settings-page/CustomSitesSettingsPanel.tsx", import.meta.url), "utf8");

  assert.match(panel, /requestExactHostAccess/);
  assert.match(panel, /previewCustomSiteOnActiveTab/);
  assert.match(panel, /disabledReason:\s*"permission-denied"/);
  assert.match(panel, /disabledReason:\s*"preview-failed"/);
  assert.match(panel, /enabled:\s*true/);
  assert.match(panel, /enabled:\s*false/);
  assert.match(panel, /saveDraft/);
  assert.match(panel, /validateAndEnable/);
  assert.match(panel, /disableProfile/);
  assert.match(panel, /deleteProfile/);
  assert.doesNotMatch(panel, /window\.prompt|eval\(|new Function/);
});

test("custom sites UI supports separate merge or replace import and JSON export", () => {
  const panel = readFileSync(new URL("../src/settings-page/CustomSitesSettingsPanel.tsx", import.meta.url), "utf8");

  assert.match(panel, /exportCustomSiteProfiles/);
  assert.match(panel, /importCustomSiteProfiles/);
  assert.match(panel, /"merge"\s*\|\s*"replace"/);
  assert.match(panel, /turnmap-custom-sites\.json/);
  assert.match(panel, /application\/json/);
});

test("custom sites settings copy is bilingual and describes local permission boundaries", () => {
  const i18n = readFileSync(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/settings-page/CustomSitesSettingsPanel.tsx", import.meta.url), "utf8");
  const keys = [
    "settings.customSites.title",
    "settings.customSites.hint",
    "settings.customSites.origin",
    "settings.customSites.pathPattern",
    "settings.customSites.validateEnable",
    "settings.customSites.permissionDenied",
    "settings.customSites.previewFailed",
    "settings.customSites.import",
    "settings.customSites.export"
  ];

  for (const key of keys) {
    assert.equal(i18n.split(`"${key}":`).length, 3, `${key} must exist in English and Chinese maps`);
    assert.match(panel, new RegExp(key.replaceAll(".", "\\.")));
  }
  assert.match(i18n, /stored locally|仅保存在本地/);
  for (const reason of ["permission-required", "preview-required", "permission-denied", "preview-failed"]) {
    const key = `settings.customSites.reason.${reason}`;
    assert.equal(i18n.split(`"${key}":`).length, 3, `${key} must exist in English and Chinese maps`);
    assert.match(panel, new RegExp(key.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(panel, /return reason \?\? "preview-required"/);
});

test("manifest keeps custom site access optional rather than broad required host access", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));

  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(manifest.optional_host_permissions.includes("http://localhost/*"));
  assert.equal(manifest.host_permissions.includes("https://*/*"), false);
});
