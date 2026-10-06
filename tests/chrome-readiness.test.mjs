import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Chrome package declares the sidePanel.open minimum version", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));

  assert.equal(manifest.minimum_chrome_version, "116");
});

test("release instructions support loading the unpacked build in Chrome", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const readmeZh = await readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8");
  const packageScript = await readFile(new URL("../scripts/package-extension.mjs", import.meta.url), "utf8");

  assert.match(readme, /chrome:\/\/extensions/i);
  assert.match(readmeZh, /chrome:\/\/extensions/i);
  assert.match(packageScript, /chrome:\/\/extensions/i);
});

test("integrated eight-site preview metadata uses the fresh 0.9.2 package version", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const readmeZh = await readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8");
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");

  assert.equal(packageJson.version, "0.9.2");
  assert.equal(packageLock.version, "0.9.2");
  assert.equal(packageLock.packages[""].version, "0.9.2");
  assert.equal(manifest.version, "0.9.2");
  assert.match(readme, /Latest local preview package: `chatmap-v0\.9\.2\.zip`/);
  assert.match(readmeZh, /最新本地预览包：`chatmap-v0\.9\.2\.zip`/);
  assert.match(changelog, /^## \[0\.9\.2\] - Eight-Site Silent Navigation Integration$/m);
});

test("permission review documents the memory-only ChatGPT header policy", async () => {
  const permissionReview = await readFile(new URL("../docs/permissions-review.md", import.meta.url), "utf8");

  assert.match(permissionReview, /memory only/i);
  assert.match(permissionReview, /explicit allowlist/i);
  assert.match(permissionReview, /Chrome 116\+/i);
});

test("the typed manifest source regenerates and verifies the public manifest", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const result = spawnSync(process.execPath, ["scripts/write-manifest.mjs", "--check"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /manifest source is synchronized/i);
  assert.match(packageJson.scripts.build, /^node scripts\/write-manifest\.mjs &&/);
});

test("content script build is wrapped for safe Chrome reinjection", async () => {
  const config = await readFile(new URL("../vite.content.config.ts", import.meta.url), "utf8");

  assert.match(config, /format:\s*"iife"/);
});

test("ChatGPT backend headers stay in memory and use an explicit replay policy", async () => {
  let beforeSendHeadersListener;
  let runtimeMessageListener;
  const sessionWrites = [];
  let fetchHeaders;

  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          runtimeMessageListener = listener;
        }
      },
      async openOptionsPage() {}
    },
    sidePanel: {
      async setPanelBehavior() {},
      async open() {}
    },
    storage: {
      session: {
        async set(value) {
          sessionWrites.push(value);
        },
        async get() {
          return {};
        }
      }
    },
    webRequest: {
      onBeforeSendHeaders: {
        addListener(listener) {
          beforeSendHeadersListener = listener;
        }
      }
    }
  };

  globalThis.fetch = async (_url, options) => {
    fetchHeaders = options?.headers;
    return {
      ok: true,
      status: 200,
      async json() {
        return { title: "Conversation" };
      }
    };
  };

  try {
    await import(`../src/background/service-worker.ts?chrome-readiness=${Date.now()}`);
    assert.equal(typeof beforeSendHeadersListener, "function");
    assert.equal(typeof runtimeMessageListener, "function");

    beforeSendHeadersListener({
      requestHeaders: [
        { name: "Accept", value: "application/json" },
        { name: "Accept-Language", value: "zh-CN" },
        { name: "Content-Type", value: "application/json" },
        { name: "OAI-Language", value: "zh-CN" },
        { name: "X-OpenAI-Sentinel-Proof-Token", value: "sentinel" },
        { name: "Authorization", value: "Bearer must-not-replay" },
        { name: "Cookie", value: "must-not-replay" },
        { name: "X-Secret", value: "must-not-replay" },
        { name: "Sec-Fetch-Site", value: "same-origin" }
      ]
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sessionWrites, []);

    const response = await new Promise((resolve, reject) => {
      const keepChannelOpen = runtimeMessageListener(
        { type: "TURNMAP_FETCH_CONVERSATION_API", conversationId: "conversation-1" },
        {},
        resolve
      );
      if (!keepChannelOpen) reject(new Error("Background message channel was not kept open."));
    });

    assert.equal(response.ok, true);
    assert.deepEqual(fetchHeaders, {
      accept: "application/json",
      "accept-language": "zh-CN",
      "content-type": "application/json",
      "oai-language": "zh-CN",
      "x-openai-sentinel-proof-token": "sentinel"
    });
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  }
});
