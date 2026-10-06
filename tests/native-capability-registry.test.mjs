import assert from "node:assert/strict";
import test from "node:test";

import { adapterSites } from "../src/content/adapter-registry.ts";

async function loadRegistry() {
  try {
    return await import("../src/content/native-capability-registry.ts");
  } catch (error) {
    assert.fail(`missing native capability evidence registry: ${error.message}`);
  }
}

test("native capability registry covers every built-in site exactly once", async () => {
  const { BUILT_IN_NATIVE_CAPABILITY_RECORDS } = await loadRegistry();
  const expected = adapterSites.map((site) => site.id);
  const actual = BUILT_IN_NATIVE_CAPABILITY_RECORDS.map((record) => record.siteId);

  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, 13);
});

test("verified native capabilities require dated real-browser evidence", async () => {
  const { BUILT_IN_NATIVE_CAPABILITY_RECORDS } = await loadRegistry();

  for (const record of BUILT_IN_NATIVE_CAPABILITY_RECORDS) {
    const claimsVerified = record.userIndex === "verified-native" || record.directJump === "verified-native";
    if (!claimsVerified) continue;
    assert.match(record.verifiedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(record.realBrowserEvidence.length > 0, `${record.siteId} lacks real browser evidence`);
    assert.ok(record.realBrowserEvidence.every((path) => path.startsWith("docs/qa/native-navigation/")));
  }
});

test("ChatGPT is the only verified native baseline until other site reports graduate", async () => {
  const { BUILT_IN_NATIVE_CAPABILITY_RECORDS } = await loadRegistry();
  const verified = BUILT_IN_NATIVE_CAPABILITY_RECORDS.filter((record) => record.userIndex === "verified-native");

  assert.deepEqual(verified.map((record) => record.siteId), ["chatgpt"]);
  assert.equal(verified[0].directJump, "verified-native");
  assert.equal(verified[0].shellRevive, "bounded-native");
  assert.ok(
    BUILT_IN_NATIVE_CAPABILITY_RECORDS.filter((record) => record.siteId !== "chatgpt").every(
      (record) => record.qaStatus !== "verified" && record.userIndex === "mounted-dom"
    )
  );
});

test("every built-in site has a dated browser report and smoke claims stay below native", async () => {
  const { BUILT_IN_NATIVE_CAPABILITY_RECORDS } = await loadRegistry();

  for (const record of BUILT_IN_NATIVE_CAPABILITY_RECORDS) {
    assert.notEqual(record.qaStatus, "not-run", `${record.siteId} still lacks browser QA`);
    assert.ok(record.realBrowserEvidence.length > 0, `${record.siteId} lacks a browser report`);
  }

  const smokeVerified = BUILT_IN_NATIVE_CAPABILITY_RECORDS.filter((record) => record.qaStatus === "smoke-verified");
  assert.deepEqual(smokeVerified.map((record) => record.siteId), ["qwen", "gemini", "glm"]);
  assert.ok(smokeVerified.every((record) => record.userIndex === "mounted-dom" && record.directJump === "mounted-only"));
});

test("capabilities derived from evidence preserve limitations without mutable sharing", async () => {
  const { BUILT_IN_NATIVE_CAPABILITY_RECORDS, capabilitiesForBuiltInSite } = await loadRegistry();
  const deepSeekRecord = BUILT_IN_NATIVE_CAPABILITY_RECORDS.find((record) => record.siteId === "deepseek");
  const first = capabilitiesForBuiltInSite("deepseek");
  const second = capabilitiesForBuiltInSite("deepseek");

  assert.deepEqual(first.limitations, deepSeekRecord.limitations);
  assert.notEqual(first.limitations, second.limitations);
  first.limitations.push("mutated by caller");
  assert.doesNotMatch(second.limitations.join(" "), /mutated by caller/);
});

test("GLM capability evidence keeps ChatGLM and Z.ai verification boundaries separate", async () => {
  const { BUILT_IN_NATIVE_CAPABILITY_RECORDS } = await loadRegistry();
  const glmRecord = BUILT_IN_NATIVE_CAPABILITY_RECORDS.find((record) => record.siteId === "glm");

  assert.ok(glmRecord);
  assert.equal(glmRecord.qaStatus, "smoke-verified");
  assert.equal(glmRecord.userIndex, "mounted-dom");
  assert.equal(glmRecord.directJump, "mounted-only");
  assert.match(glmRecord.limitations.join(" "), /ChatGLM/i);
  assert.match(glmRecord.limitations.join(" "), /Z\.ai/i);
  assert.match(glmRecord.limitations.join(" "), /slider|verification|blocked/i);
});
