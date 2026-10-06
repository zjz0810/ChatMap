import assert from "node:assert/strict";
import test from "node:test";

async function loadModule() {
  try {
    return await import("../src/shared/custom-site-profiles.ts");
  } catch (error) {
    assert.fail(`missing custom site profile model: ${error.message}`);
  }
}

function validDraft(overrides = {}) {
  return {
    displayName: "Example Assistant",
    origin: "https://assistant.example.com",
    pathPattern: "/chat/*",
    conversationRootSelector: "main[data-conversation]",
    userSelector: "[data-role='user']",
    assistantSelector: "[data-role='assistant']",
    titleSelector: "header h1",
    scrollContainerSelector: "main[data-conversation]",
    messageIdAttributes: ["data-message-id", "id"],
    ...overrides
  };
}

test("custom profiles normalize an exact origin and never accept wildcard hosts", async () => {
  const { validateCustomSiteProfileDraft } = await loadModule();
  const valid = validateCustomSiteProfileDraft(validDraft());
  const wildcard = validateCustomSiteProfileDraft(validDraft({ origin: "https://*.example.com" }));
  const credentialed = validateCustomSiteProfileDraft(validDraft({ origin: "https://user:pass@example.com" }));

  assert.equal(valid.ok, true);
  assert.equal(valid.normalized.origin, "https://assistant.example.com");
  assert.equal(valid.normalized.permissionPattern, "https://assistant.example.com/*");
  assert.equal(wildcard.ok, false);
  assert.ok(wildcard.errors.some((error) => error.field === "origin"));
  assert.equal(credentialed.ok, false);
});

test("custom profiles cannot shadow a built-in TurnMap adapter origin", async () => {
  const { validateCustomSiteProfileDraft } = await loadModule();
  const result = validateCustomSiteProfileDraft(validDraft({ origin: "https://chat.deepseek.com" }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "built-in-origin"));
});

test("custom selectors reject executable or unbounded expressions", async () => {
  const { validateCustomSiteProfileDraft } = await loadModule();
  const cases = [
    validDraft({ userSelector: "*:has([data-role='user'])" }),
    validDraft({ userSelector: "div::before" }),
    validDraft({ userSelector: "*" }),
    validDraft({ userSelector: "script" }),
    validDraft({ userSelector: "[data-role='user'" }),
    validDraft({ userSelector: ".x".repeat(300) })
  ];

  for (const draft of cases) {
    const result = validateCustomSiteProfileDraft(draft);
    assert.equal(result.ok, false, draft.userSelector);
    assert.ok(result.errors.some((error) => error.field === "userSelector"));
  }
});

test("custom profile creation stores disabled state until permission and preview succeed", async () => {
  const { createCustomSiteProfile } = await loadModule();
  const profile = createCustomSiteProfile(validDraft(), {
    now: 1234,
    idFactory: () => "profile-1"
  });

  assert.equal(profile.id, "profile-1");
  assert.equal(profile.enabled, false);
  assert.equal(profile.disabledReason, "permission-required");
  assert.equal(profile.createdAt, 1234);
  assert.equal(profile.updatedAt, 1234);
  assert.deepEqual(profile.messageIdAttributes, ["data-message-id", "id"]);
  assert.equal("script" in profile, false);
});

test("custom profile URL matching requires exact origin and bounded path glob", async () => {
  const { createCustomSiteProfile, customSiteProfileMatchesUrl } = await loadModule();
  const profile = createCustomSiteProfile(validDraft(), { idFactory: () => "profile-1", now: 1 });

  assert.equal(customSiteProfileMatchesUrl(profile, new URL("https://assistant.example.com/chat/abc")), true);
  assert.equal(customSiteProfileMatchesUrl(profile, new URL("https://assistant.example.com/other")), false);
  assert.equal(customSiteProfileMatchesUrl(profile, new URL("https://sub.assistant.example.com/chat/abc")), false);
});

test("custom site backup is separate from graph JSON and import cannot replace built-ins", async () => {
  const { createCustomSiteProfile, exportCustomSiteProfiles, importCustomSiteProfiles } = await loadModule();
  const profile = createCustomSiteProfile(validDraft(), { idFactory: () => "profile-1", now: 1 });
  const backup = exportCustomSiteProfiles([profile], 99);
  const imported = importCustomSiteProfiles(backup, [], "replace");

  assert.equal(backup.app, "ChatMap");
  assert.equal(backup.kind, "custom-sites");
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.exportedAt, 99);
  assert.equal("turns" in backup, false);
  assert.equal(imported.profiles.length, 1);
  assert.equal(imported.profiles[0].enabled, false);
  assert.throws(
    () =>
      importCustomSiteProfiles(
        { ...backup, profiles: [{ ...profile, origin: "https://chatgpt.com", permissionPattern: "https://chatgpt.com/*" }] },
        [],
        "replace"
      ),
    /built-in/i
  );
});

test("custom profile storage normalizes corrupt data and writes one versioned library", async () => {
  const { CUSTOM_SITE_STORAGE_KEY, createCustomSiteProfile, loadCustomSiteProfiles, saveCustomSiteProfiles } =
    await loadModule();
  const profile = createCustomSiteProfile(validDraft(), { idFactory: () => "profile-1", now: 1 });
  let stored = { [CUSTOM_SITE_STORAGE_KEY]: { schemaVersion: 1, profiles: [profile, { broken: true }] } };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => stored,
        set: async (value) => {
          stored = value;
        }
      }
    }
  };

  const loaded = await loadCustomSiteProfiles();
  await saveCustomSiteProfiles(loaded);

  assert.equal(loaded.length, 1);
  assert.equal(stored[CUSTOM_SITE_STORAGE_KEY].schemaVersion, 1);
  assert.equal(stored[CUSTOM_SITE_STORAGE_KEY].profiles.length, 1);
});
