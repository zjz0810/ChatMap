import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

class FixtureText {
  nodeType = 3;
  parentElement = null;

  constructor(data) {
    this.data = data;
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = value;
  }
}

function matchesSimple(element, selector) {
  let remaining = selector.trim();
  if (!remaining || remaining === "*") return Boolean(remaining);

  const tag = remaining.match(/^[a-z][a-z0-9-]*/i)?.[0];
  if (tag) {
    if (element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    remaining = remaining.slice(tag.length);
  }

  for (const classMatch of remaining.matchAll(/\.([a-z0-9_-]+)/gi)) {
    if (!element.className.split(/\s+/).includes(classMatch[1])) return false;
  }
  for (const idMatch of remaining.matchAll(/#([a-z0-9_-]+)/gi)) {
    if (element.getAttribute("id") !== idMatch[1]) return false;
  }

  for (const attrMatch of remaining.matchAll(/\[([^\]]+)\]/g)) {
    const expression = attrMatch[1].trim();
    const parsed = expression.match(/^([\w:-]+)\s*(~=|\*=|\^=|\$=|=)?\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))?\s*(?:i)?$/i);
    if (!parsed) return false;
    const [, name, operator, doubleQuoted, singleQuoted, bare] = parsed;
    const actual = element.getAttribute(name);
    if (actual === null) return false;
    const expected = doubleQuoted ?? singleQuoted ?? bare ?? "";
    if (!operator) continue;
    if (operator === "=" && actual !== expected) return false;
    if (operator === "~=" && !actual.split(/\s+/).includes(expected)) return false;
    if (operator === "*=" && !actual.includes(expected)) return false;
    if (operator === "^=" && !actual.startsWith(expected)) return false;
    if (operator === "$=" && !actual.endsWith(expected)) return false;
  }
  return true;
}

function matchesSelector(element, selector) {
  return selector.split(",").some((group) => {
    const parts = group.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0 || !matchesSimple(element, parts.at(-1))) return false;
    let ancestor = element.parentElement;
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      while (ancestor && !matchesSimple(ancestor, parts[index])) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

class FixtureElement {
  nodeType = 1;
  childNodes = [];
  parentElement = null;

  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
  }

  get className() {
    return this.getAttribute("class") ?? "";
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent ?? "").join("");
  }

  set textContent(value) {
    this.childNodes = [];
    if (value) this.appendChild(new FixtureText(value));
  }

  get innerText() {
    return this.textContent;
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }

  contains(candidate) {
    for (let current = candidate; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (parent) => {
      for (const child of parent.childNodes) {
        if (child.nodeType !== 1) continue;
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  cloneNode(deep = false) {
    const clone = new FixtureElement(this.tagName, Object.fromEntries(this.attributes));
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.nodeType === 3 ? new FixtureText(child.textContent) : child.cloneNode(true));
      }
    }
    return clone;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.childNodes = this.parentElement.childNodes.filter((child) => child !== this);
    this.parentElement = null;
  }

  getBoundingClientRect() {
    return { width: 100, height: 20, top: 0, bottom: 20, left: 0, right: 100 };
  }

  scrollIntoView() {}
  click() {}

  compareDocumentPosition(other) {
    const root = (node) => {
      let current = node;
      while (current.parentElement) current = current.parentElement;
      return current;
    };
    const order = [];
    const visit = (node) => {
      if (node.nodeType === 1) order.push(node);
      for (const child of node.childNodes ?? []) visit(child);
    };
    visit(root(this));
    return order.indexOf(other) > order.indexOf(this) ? 4 : 2;
  }
}

class FixtureDocument {
  constructor() {
    this.body = new FixtureElement("body");
    this.documentElement = new FixtureElement("html");
    this.documentElement.appendChild(this.body);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function parseFixture(html) {
  const document = new FixtureDocument();
  const stack = [document.body];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tokens = html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) ?? [];

  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("</")) {
      const tag = token.match(/^<\/\s*([^\s>]+)/)?.[1]?.toLowerCase();
      const closeIndex = stack.map((element) => element.tagName.toLowerCase()).lastIndexOf(tag);
      if (closeIndex > 0) stack.length = closeIndex;
      continue;
    }
    if (token.startsWith("<")) {
      const tag = token.match(/^<\s*([^\s/>]+)/)?.[1]?.toLowerCase();
      if (!tag) continue;
      const attributeText = token.slice(tag.length + 1, token.lastIndexOf(">"));
      const attributes = {};
      for (const match of attributeText.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
      }
      const element = stack.at(-1).appendChild(new FixtureElement(tag, attributes));
      if (!voidTags.has(tag) && !token.endsWith("/>")) stack.push(element);
      continue;
    }
    stack.at(-1).appendChild(new FixtureText(token.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")));
  }
  return document;
}

async function fixture(name) {
  return parseFixture(await readFile(fixturePath(name), "utf8"));
}

function installBrowserGlobals(document, conversationId) {
  const saved = new Map();
  for (const name of ["window", "document", "chrome", "fetch", "Node"]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 }
  });
  globalThis.document = document;
  globalThis.window = {
    location: {
      href: `https://chatgpt.com/c/${conversationId}`,
      pathname: `/c/${conversationId}`,
      origin: "https://chatgpt.com"
    },
    setTimeout,
    clearTimeout
  };
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

test("new ChatGPT fixture produces ordered user/assistant turns without legacy attributes", async () => {
  const document = await fixture("chatgpt-modern.html");
  const { extractTurns } = await import("../src/content/turn-extractor.ts");

  assert.equal(document.querySelectorAll('[data-message-author-role="user"]').length, 0);
  assert.equal(document.querySelectorAll("[data-message-id]").length, 0);

  const turns = extractTurns(document);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((turn) => turn.userText), [
    "How should I organize a research project?",
    "Can you show a second example?"
  ]);
  assert.deepEqual(turns.map((turn) => turn.assistantText), [
    "Start with questions, sources, and decisions.",
    "Use a short decision log."
  ]);
  assert.deepEqual(turns.map((turn) => turn.turnIndex), [0, 1]);
});

test("modern ChatGPT extraction uses the enclosing turn shell as the stable identity", async () => {
  const document = await fixture("chatgpt-modern.html");
  const roots = document.querySelectorAll("[data-virtualized-turn-content]");
  roots[0].attributes.set("data-turn-id", "attachment-turn-1");
  roots[1].attributes.set("data-turn-id", "attachment-turn-2");
  const { extractTurns } = await import("../src/content/turn-extractor.ts");

  const turns = extractTurns(document);
  assert.deepEqual(turns.map((turn) => turn.sourceAnchor.userMessageId), [
    "attachment-turn-1",
    "attachment-turn-2"
  ]);
});

test("modern extraction follows visible message order when virtualized DOM order is stale", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-reverse-visual-order");
  try {
    const roots = document.querySelectorAll("[data-virtualized-turn-content]");
    roots.forEach((root, index) => {
      root.getBoundingClientRect = () => ({ top: (roots.length - index) * 100, bottom: (roots.length - index) * 100 + 80,
        left: 0, right: 100, width: 100, height: 80 });
    });
    const { extractModernChatGptTurns } = await import("../src/content/turn-extractor.ts");
    const turns = extractModernChatGptTurns(document);
    assert.deepEqual(turns.map((turn) => turn.userText), [
      "Can you show a second example?",
      "How should I organize a research project?"
    ]);
  } finally { restore(); }
});

test("modern extraction prefers stable virtualized turn indexes over reused DOM and screen order", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-virtualized-order");
  try {
    const roots = document.querySelectorAll("[data-virtualized-turn-content]");
    roots[0].attributes.set("data-index", "2");
    roots[1].attributes.set("data-index", "1");
    roots.forEach((root, index) => {
      root.getBoundingClientRect = () => ({ top: (roots.length - index) * 100, bottom: (roots.length - index) * 100 + 80,
        left: 0, right: 100, width: 100, height: 80 });
    });
    const { extractModernChatGptTurns } = await import("../src/content/turn-extractor.ts");
    const turns = extractModernChatGptTurns(document);
    assert.deepEqual(turns.map((turn) => turn.userText), [
      "Can you show a second example?",
      "How should I organize a research project?"
    ]);
  } finally { restore(); }
});

test("modern ChatGPT streaming updates the same two turns instead of duplicating nodes", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-stream");
  try {
    const { attachOphelNavigationToTurns } = await import("../src/content/chatgpt-ophel-navigation.ts");
    const { extractTurns, mergeTurns } = await import("../src/content/turn-extractor.ts");

    const initial = mergeTurns([], attachOphelNavigationToTurns(extractTurns(document)));
    const firstId = initial[0].id;
    document.querySelector("#answer-1").textContent = "Start with questions, sources, and decisions, then record each decision.";
    const streamed = attachOphelNavigationToTurns(extractTurns(document));
    const updated = mergeTurns(initial, streamed);

    assert.equal(updated.length, 2);
    assert.equal(updated[0].id, firstId);
    assert.equal(updated[0].assistantText, "Start with questions, sources, and decisions, then record each decision.");
    assert.equal(updated[1].assistantText, "Use a short decision log.");
  } finally {
    restore();
  }
});

test("repeated prompts keep separate node identities and a short streamed answer replaces its placeholder", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-repeat");
  try {
    const { attachOphelNavigationToTurns } = await import("../src/content/chatgpt-ophel-navigation.ts");
    const { extractTurns, mergeTurns } = await import("../src/content/turn-extractor.ts");
    const userMarkers = document.querySelectorAll('[class~="group/user-message"]');
    userMarkers[1].textContent = userMarkers[0].textContent;
    document.querySelector("#answer-1").textContent = "";

    const initial = mergeTurns([], attachOphelNavigationToTurns(extractTurns(document)));
    assert.equal(initial.length, 2);
    assert.equal(initial[0].assistantText, "无文字回复");
    assert.notEqual(initial[0].navigation.navigationId, initial[1].navigation.navigationId);

    document.querySelector("#answer-1").textContent = "OK";
    const streamed = attachOphelNavigationToTurns(extractTurns(document));
    const updated = mergeTurns(initial, streamed);

    assert.equal(updated.length, 2);
    assert.equal(updated[0].assistantText, "OK");
    assert.equal(updated[0].id, initial[0].id);
    assert.equal(updated[1].assistantText, "Use a short decision log.");
  } finally {
    restore();
  }
});

test("legacy ChatGPT role, message id, whitespace-pre-wrap, and markdown selectors remain supported", async () => {
  const document = await fixture("chatgpt-legacy.html");
  const restore = installBrowserGlobals(document, "fixture-legacy");
  try {
    const { extractTurns } = await import("../src/content/turn-extractor.ts");
    const turns = extractTurns(document);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].userText, "Keep legacy ChatGPT selector support.");
    assert.equal(turns[0].assistantText, "The older page structure still works.");
    assert.equal(turns[0].sourceAnchor.userMessageId, "legacy-user-1");
    assert.equal(turns[0].sourceAnchor.assistantMessageId, "legacy-assistant-1");
  } finally {
    restore();
  }
});

test("API 404 skips a duplicate page fetch and falls through to modern DOM extraction", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-api-404");
  let apiRequests = 0;
  let pageRequests = 0;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        assert.equal(message.type, "TURNMAP_FETCH_CONVERSATION_API");
        apiRequests += 1;
        return { ok: false, status: 404 };
      }
    }
  };
  globalThis.fetch = async () => {
    pageRequests += 1;
    throw new Error("same-origin duplicate API request should not be attempted after 404");
  };

  try {
    const { getNonDisruptiveTurns } = await import("../src/content/chatgpt-observer.ts");
    const first = await getNonDisruptiveTurns();
    const second = await getNonDisruptiveTurns();

    assert.equal(first.length, 2);
    assert.deepEqual(first.map((turn) => turn.assistantText), [
      "Start with questions, sources, and decisions.",
      "Use a short decision log."
    ]);
    assert.equal(second.length, 2);
    assert.equal(apiRequests, 1);
    assert.equal(pageRequests, 0);
  } finally {
    restore();
  }
});

test("ChatGPT conversation id parsing accepts default, custom GPT, and legacy chat routes", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-url");
  try {
    const { getChatGptConversationIdFromUrl } = await import("../src/content/conversation-api-extractor.ts");
    assert.equal(getChatGptConversationIdFromUrl("https://chatgpt.com/c/main-id"), "main-id");
    assert.equal(getChatGptConversationIdFromUrl("https://chatgpt.com/g/gpt-123/c/custom-id?model=x"), "custom-id");
    assert.equal(getChatGptConversationIdFromUrl("https://chatgpt.com/chat/legacy-id"), "legacy-id");
    assert.equal(getChatGptConversationIdFromUrl("https://chatgpt.com/share/shared-id"), null);
  } finally {
    restore();
  }
});

test("modern navigation resolves back to the mounted ChatGPT turn", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-jump");
  try {
    const { attachOphelNavigationToTurns, resolveChatGptOphelTarget } =
      await import("../src/content/chatgpt-ophel-navigation.ts");
    const { extractTurns } = await import("../src/content/turn-extractor.ts");
    const [turn] = attachOphelNavigationToTurns(extractTurns(document));
    const target = await resolveChatGptOphelTarget(turn.navigation, 0, document);

    assert.equal(target.ok, true);
    assert.equal(target.source, "visible-user");
    assert.equal(target.element.matches('[class~="group/user-message"]'), true);
  } finally {
    restore();
  }
});

test("modern navigation finds a visible virtualized prompt by saved text when turn indices drift", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-stale-index-jump");
  try {
    const { resolveChatGptOphelTarget } = await import("../src/content/chatgpt-ophel-navigation.ts");
    const target = await resolveChatGptOphelTarget({
      kind: "ophel_notSourceAnchor",
      site: "chatgpt",
      navigationId: "chatgpt-native-user-query:17:old-hash",
      nativeTocIndex: 17,
      turnIndex: 17,
      textHash: "stale-hash",
      userPreview: "Can you show a second example?"
    }, 0, document);

    assert.equal(target.ok, true);
    assert.equal(target.source, "visible-user");
    assert.equal(target.element.textContent.includes("Can you show a second example?"), true);
  } finally {
    restore();
  }
});

test("modern navigation scrolls older history until an unloaded virtualized prompt mounts", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-history-scroll-jump");
  try {
    const { resolveChatGptOphelTarget } = await import("../src/content/chatgpt-ophel-navigation.ts");
    const oldPrompt = "A prompt that only appears after scrolling back through history";
    const scroller = {
      scrollTop: 480,
      scrollHeight: 1200,
      clientHeight: 300,
      scrollTo({ top }) {
        this.scrollTop = top;
        if (top === 0 && !document.querySelector('[class~="group/user-message"][data-old-fixture]')) {
          const wrapper = new FixtureElement("div", { "data-virtualized-turn-content": "" });
          const user = new FixtureElement("div", { class: "group/user-message", "data-old-fixture": "" });
          user.appendChild(new FixtureText(oldPrompt));
          wrapper.appendChild(user);
          document.querySelector("main").appendChild(wrapper);
        }
      }
    };
    const target = await resolveChatGptOphelTarget({
      kind: "ophel_notSourceAnchor",
      site: "chatgpt",
      navigationId: "chatgpt-native-user-query:0:old-prompt",
      nativeTocIndex: 0,
      turnIndex: 0,
      textHash: "old-prompt-hash",
      userPreview: oldPrompt
    }, 0, document, scroller);

    assert.equal(target.ok, true);
    assert.equal(target.source, "history-scroll");
    assert.equal(target.element.textContent, oldPrompt);
  } finally {
    restore();
  }
});

test("modern navigation searches older prompts when a reverse-flow scroller starts at zero", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-reverse-flow-jump");
  const oldGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  try {
    const { resolveChatGptOphelTarget } = await import("../src/content/chatgpt-ophel-navigation.ts");
    const oldPrompt = "An earlier prompt in a reverse-flow virtualized conversation";
    const scroller = {
      scrollTop: 0,
      scrollHeight: 1400,
      clientHeight: 300,
      scrollTo({ top }) {
        this.scrollTop = top;
        if (top <= -800 && !document.querySelector('[class~="group/user-message"][data-old-fixture]')) {
          const wrapper = new FixtureElement("div", { "data-virtualized-turn-content": "" });
          const user = new FixtureElement("div", { class: "group/user-message", "data-old-fixture": "" });
          user.appendChild(new FixtureText(oldPrompt));
          wrapper.appendChild(user);
          document.querySelector("main").appendChild(wrapper);
        }
      }
    };
    const target = await resolveChatGptOphelTarget({
      kind: "ophel_notSourceAnchor",
      site: "chatgpt",
      navigationId: "chatgpt-native-user-query:0:reverse-old-prompt",
      nativeTocIndex: 0,
      turnIndex: 0,
      textHash: "old-prompt-hash",
      userPreview: oldPrompt
    }, 0, document, scroller);

    assert.equal(target.ok, true);
    assert.equal(target.source, "history-scroll");
    assert.equal(target.element.textContent, oldPrompt);
    assert.ok(scroller.scrollTop < 0);
  } finally {
    window.getComputedStyle = oldGetComputedStyle;
    restore();
  }
});

test("ChatGPT scroll bounds treat zero as the latest end in reverse-flow layouts", async () => {
  const { clampChatScrollTop, getChatScrollRange } = await import("../src/content/scroll-container.ts");
  const scroller = { scrollTop: 0, scrollHeight: 1800, clientHeight: 300 };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  globalThis.window = { getComputedStyle: () => ({ flexDirection: "column-reverse" }) };
  try {
    assert.deepEqual(getChatScrollRange(scroller), { min: -1500, max: 0 });
    assert.equal(clampChatScrollTop(scroller, -1600), -1500);
    assert.equal(clampChatScrollTop(scroller, 100), 0);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

test("navigation searches below the current viewport after reaching the oldest boundary", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-downward-jump");
  try {
    window.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
    const { resolveChatGptOphelTarget } = await import("../src/content/chatgpt-ophel-navigation.ts");
    const prompt = "A later message below the current viewport";
    const scroller = {
      scrollTop: 100, scrollHeight: 1400, clientHeight: 300,
      scrollTo({ top }) {
        this.scrollTop = top;
        if (top >= 800 && !document.querySelector("[data-later-fixture]")) {
          const wrapper = new FixtureElement("div", { "data-virtualized-turn-content": "" });
          const user = new FixtureElement("div", { class: "group/user-message", "data-later-fixture": "" });
          user.appendChild(new FixtureText(prompt));
          wrapper.appendChild(user);
          document.querySelector("main").appendChild(wrapper);
        }
      }
    };
    const target = await resolveChatGptOphelTarget({
      kind: "ophel_notSourceAnchor", site: "chatgpt", userPreview: prompt,
      turnIndex: 99, nativeTocIndex: 99, textHash: "stale-hash"
    }, 0, document, scroller);
    assert.equal(target.ok, true);
    assert.equal(target.source, "history-scroll");
    assert.equal(target.element.textContent, prompt);
    assert.ok(scroller.scrollTop >= 800);
  } finally { restore(); }
});

test("navigation restores the viewport if neither direction contains the target", async () => {
  const document = await fixture("chatgpt-modern.html");
  const restore = installBrowserGlobals(document, "fixture-missing-jump");
  try {
    window.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
    const { resolveChatGptOphelTarget } = await import("../src/content/chatgpt-ophel-navigation.ts");
    const visited = [];
    const scroller = { scrollTop: 250, scrollHeight: 1400, clientHeight: 300,
      scrollTo({ top }) { this.scrollTop = top; visited.push(top); } };
    const target = await resolveChatGptOphelTarget({
      kind: "ophel_notSourceAnchor", site: "chatgpt", userPreview: "This prompt does not exist anywhere",
      turnIndex: 99, nativeTocIndex: 99, textHash: "missing-hash"
    }, 0, document, scroller);
    assert.equal(target.ok, false);
    assert.ok(visited.includes(0));
    assert.ok(visited.includes(1100));
    assert.equal(scroller.scrollTop, 250);
  } finally { restore(); }
});
