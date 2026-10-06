import { BUILT_IN_CONTENT_MATCHES } from "./shared/built-in-sites.ts";
import type { Manifest } from "./shared/chrome-types";

const manifest: Manifest = {
  manifest_version: 3,
  minimum_chrome_version: "116",
  name: "ChatMap",
  version: "1.0.0",
  description: "Map long ChatGPT conversations into an editable, navigable knowledge graph.",
  icons: {
    "16": "icons/chatmap-16.png",
    "32": "icons/chatmap-32.png",
    "48": "icons/chatmap-48.png",
    "128": "icons/chatmap-128.png"
  },
  action: {
    default_title: "Open ChatMap",
    default_icon: {
      "16": "icons/chatmap-16.png",
      "32": "icons/chatmap-32.png",
      "48": "icons/chatmap-48.png",
      "128": "icons/chatmap-128.png"
    }
  },
  options_page: "src/settings-page/index.html",
  permissions: ["activeTab", "scripting", "sidePanel", "storage", "tabs", "webRequest"],
  host_permissions: [
    ...BUILT_IN_CONTENT_MATCHES,
    "https://chatgpt.com/backend-api/*",
    "https://api.openai.com/*",
    "https://api.deepseek.com/*",
    "https://openrouter.ai/*",
    "https://dashscope-intl.aliyuncs.com/*",
    "https://api.moonshot.ai/*",
    "https://ark.cn-beijing.volces.com/*",
    "https://open.bigmodel.cn/*",
    "https://api.mistral.ai/*"
  ],
  optional_host_permissions: [
    "https://*/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  background: {
    service_worker: "background/service-worker.js",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["https://chat.deepseek.com/*"],
      js: ["deepseek-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://www.kimi.com/*", "https://kimi.com/*"],
      js: ["kimi-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://claude.ai/*", "https://*.claude.ai/*"],
      js: ["claude-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://grok.com/*", "https://*.grok.com/*", "https://x.com/*"],
      js: ["grok-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://doubao.com/*", "https://*.doubao.com/*"],
      js: ["doubao-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: [
        "https://chat.qwen.ai/*",
        "https://qianwen.com/*",
        "https://www.qianwen.com/*",
        "https://*.qianwen.com/*",
        "https://tongyi.aliyun.com/*",
        "https://*.tongyi.aliyun.com/*",
        "https://qianwen.aliyun.com/*",
        "https://*.qianwen.aliyun.com/*"
      ],
      js: ["qwen-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://gemini.google.com/*"],
      js: ["gemini-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://chat.z.ai/*", "https://z.ai/*"],
      js: ["glm-conversation-observer.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: BUILT_IN_CONTENT_MATCHES,
      js: ["content/index.js"],
      run_at: "document_idle"
    }
  ],
  web_accessible_resources: [
    {
      resources: ["icons/chatmap-128.png"],
      matches: BUILT_IN_CONTENT_MATCHES
    }
  ],
  side_panel: {
    default_path: "src/side-panel/index.html"
  }
};

export default manifest;
