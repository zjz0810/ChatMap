import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function loadProfiles() {
  return await import("../src/shared/custom-site-profiles.ts");
}

async function loadAdapter() {
  try {
    return await import("../src/content/custom-site-adapter.ts");
  } catch (error) {
    assert.fail(`missing custom site adapter: ${error.message}`);
  }
}

async function enabledProfile() {
  const { createCustomSiteProfile } = await loadProfiles();
  return {
    ...createCustomSiteProfile(
      {
        displayName: "Example Assistant",
        origin: "https://assistant.example.com",
        pathPattern: "/chat/*",
        conversationRootSelector: "main",
        userSelector: "[data-role='user']",
        assistantSelector: "[data-role='assistant']",
        titleSelector: "h1",
        scrollContainerSelector: "main",
        messageIdAttributes: ["data-message-id", "id"]
      },
      { idFactory: () => "profile-1", now: 1 }
    ),
    enabled: true,
    disabledReason: undefined
  };
}

test("custom profile maps to a scoped non-scrolling web conversation profile", async () => {
  const { customSiteProfileToWebProfile } = await loadAdapter();
  const web = customSiteProfileToWebProfile(await enabledProfile());

  assert.equal(web.site.id, "custom:profile-1");
  assert.equal(web.site.displayName, "Example Assistant");
  assert.equal(web.conversationRootSelector, "main");
  assert.deepEqual(web.userSelectors, ["[data-role='user']"]);
  assert.deepEqual(web.assistantSelectors, ["[data-role='assistant']"]);
  assert.deepEqual(web.messageIdAttributes, ["data-message-id", "id"]);
  assert.equal("nativeToc" in web, false);
});

test("custom adapter selection ignores disabled and nonmatching profiles", async () => {
  const { selectCustomConversationAdapterFromProfiles } = await loadAdapter();
  const enabled = await enabledProfile();
  const disabled = { ...enabled, id: "disabled", enabled: false, disabledReason: "permission-denied" };

  assert.equal(
    selectCustomConversationAdapterFromProfiles(new URL("https://assistant.example.com/chat/123"), [disabled]),
    null
  );
  assert.equal(
    selectCustomConversationAdapterFromProfiles(new URL("https://assistant.example.com/other"), [enabled]),
    null
  );
  const selected = selectCustomConversationAdapterFromProfiles(
    new URL("https://assistant.example.com/chat/123"),
    [enabled]
  );
  assert.equal(selected.site.id, "custom:profile-1");
  assert.equal(selected.capabilities.userIndex, "mounted-dom");
  assert.equal(selected.capabilities.directJump, "mounted-only");
});

test("content startup awaits custom adapter selection while built-ins keep priority", () => {
  const source = readFileSync(new URL("../src/content/index.ts", import.meta.url), "utf8");

  assert.match(source, /selectConversationAdapterAsync/);
  assert.match(source, /let activeAdapter:/);
  assert.match(source, /activeAdapterReady/);
  assert.match(source, /await activeAdapterReady/);
  assert.doesNotMatch(source, /const activeAdapter = selectConversationAdapter\(\)/);
});

test("custom preview uses a fixed content message and returns bounded samples", () => {
  const typesSource = readFileSync(new URL("../src/shared/types.ts", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../src/content/custom-site-adapter.ts", import.meta.url), "utf8");
  const messagingSource = readFileSync(new URL("../src/shared/messaging.ts", import.meta.url), "utf8");
  const indexSource = readFileSync(new URL("../src/content/index.ts", import.meta.url), "utf8");

  assert.match(typesSource, /TURNMAP_VALIDATE_CUSTOM_SITE/);
  assert.match(contentSource, /previewCustomSiteProfile/);
  assert.match(contentSource, /slice\(0,\s*120\)/);
  assert.match(messagingSource, /previewCustomSiteOnActiveTab/);
  assert.match(messagingSource, /requestExactHostAccess/);
  assert.match(indexSource, /TURNMAP_VALIDATE_CUSTOM_SITE/);
  assert.doesNotMatch(contentSource, /eval\(|new Function|script\.src|fetch\(/);
});
