import assert from "node:assert/strict";
import test from "node:test";

import { requestChatCompletion, testAiConnection } from "../src/side-panel/ai/openai-compatible.ts";
import {
  AI_PROVIDER_METADATA,
  aiProviderOptions,
  defaultsForProvider
} from "../src/side-panel/settings/ai-settings-storage.ts";

function withChromePermissions() {
  globalThis.chrome = {
    permissions: {
      contains: async () => true,
      request: async () => true
    }
  };
}

function settings(overrides = {}) {
  return {
    ...defaultsForProvider("custom"),
    provider: "custom",
    baseUrl: "https://api.example.test/v1",
    model: "reasoning-model",
    apiKey: "test-key",
    ...overrides
  };
}

test("testAiConnection sends enough max_tokens for reasoning models", async () => {
  withChromePermissions();
  let body = {};
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };

  await testAiConnection(settings({ maxTokens: 64 }));

  assert.equal(body.model, "reasoning-model");
  assert.ok(body.max_tokens >= 256);
});

test("requestChatCompletion uses saved max_tokens when the task does not override it", async () => {
  withChromePermissions();
  let body = {};
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
  };

  await requestChatCompletion(
    settings({ maxTokens: 4096 }),
    [{ role: "user", content: "Say hello" }],
    { temperature: 0 }
  );

  assert.equal(body.max_tokens, 4096);
});

test("requestChatCompletion keeps task-specific max_tokens above a low saved value", async () => {
  withChromePermissions();
  let body = {};
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
  };

  await requestChatCompletion(
    settings({ maxTokens: 512 }),
    [{ role: "user", content: "Return long JSON" }],
    { temperature: 0, maxTokens: 1800 }
  );

  assert.equal(body.max_tokens, 1800);
});

test("requestChatCompletion can prefer a fast task max_tokens below the saved value", async () => {
  withChromePermissions();
  let body = {};
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
  };

  await requestChatCompletion(
    settings({ maxTokens: 4096 }),
    [{ role: "user", content: "Rewrite this prompt quickly." }],
    { temperature: 0.2, maxTokens: 800, preferRequestedMaxTokens: true }
  );

  assert.equal(body.max_tokens, 800);
});

test("provider metadata includes 0.5.0 presets with cost-aware default models", () => {
  const providerIds = aiProviderOptions.map((provider) => provider.id);

  assert.deepEqual(providerIds, [
    "openai",
    "deepseek",
    "openrouter",
    "qwen",
    "kimi",
    "doubao",
    "zhipu",
    "mistral",
    "gemini-compatible",
    "custom"
  ]);
  assert.equal(defaultsForProvider("openai").model, "gpt-5.4-nano");
  assert.equal(defaultsForProvider("deepseek").model, "deepseek-v4-flash");
  assert.equal(defaultsForProvider("openrouter").model, "qwen/qwen3.5-flash-02-23");
  assert.equal(defaultsForProvider("qwen").model, "qwen3.5-flash");
  assert.equal(defaultsForProvider("doubao").baseUrl, "https://ark.cn-beijing.volces.com/api/v3");
  assert.equal(defaultsForProvider("zhipu").model, "glm-4.7-flash");
  assert.equal(defaultsForProvider("mistral").model, "mistral-small-2603");
  assert.equal(defaultsForProvider("gemini-compatible").baseUrl, "");
  assert.equal(defaultsForProvider("gemini-compatible").model, "gemini-2.5-flash-lite");
  assert.equal(defaultsForProvider("custom").model, "");
  assert.equal(AI_PROVIDER_METADATA["mistral"].supportsJsonMode, true);
});

test("requestChatCompletion uses provider chat path and suppresses unsupported JSON mode", async () => {
  withChromePermissions();
  let requestedUrl = "";
  let body = {};
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
  };

  await requestChatCompletion(
    settings({
      provider: "doubao",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-1-6-flash-250828"
    }),
    [{ role: "user", content: "Say hello" }],
    { jsonMode: true }
  );

  assert.equal(requestedUrl, "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  assert.equal(body.model, "doubao-seed-1-6-flash-250828");
  assert.equal(body.response_format, undefined);
});

test("requestChatCompletion parses provider final text but ignores reasoning-only content", async () => {
  withChromePermissions();
  const responses = [
    { choices: [{ message: { reasoning_content: "hidden chain of thought", content: "visible final" } }] },
    { choices: [{ message: { reasoning_content: "hidden only" } }] },
    { choices: [{ message: { reasoning_content: "hidden only again" } }] }
  ];
  globalThis.fetch = async () =>
    new Response(JSON.stringify(responses.shift()), {
      status: 200
    });

  const content = await requestChatCompletion(
    settings({ provider: "zhipu", model: "glm-4.7-flash" }),
    [{ role: "user", content: "Summarize" }]
  );
  assert.equal(content, "visible final");

  await assert.rejects(
    () =>
      requestChatCompletion(
        settings({ provider: "zhipu", model: "glm-4.7-flash" }),
        [{ role: "user", content: "Summarize" }]
      ),
    /empty-response|readable text|final answer/i
  );
});

test("requestChatCompletion expands token budget on empty response retry", async () => {
  withChromePermissions();
  const maxTokens = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    maxTokens.push(body.max_tokens);
    if (maxTokens.length === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "retry content" } }] }), { status: 200 });
  };

  const content = await requestChatCompletion(
    settings({ maxTokens: 1200 }),
    [{ role: "user", content: "Return content" }],
    { jsonMode: true }
  );

  assert.equal(content, "retry content");
  assert.ok(maxTokens[1] > maxTokens[0]);
});
