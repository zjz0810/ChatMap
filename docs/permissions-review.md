# TurnMap Permission Review

This document explains the permissions used by TurnMap `v0.9.1`.

## Required Extension Permissions

| Permission | Why TurnMap Uses It | Data Scope |
| --- | --- | --- |
| `activeTab` | Identify and communicate with the currently active supported AI conversation tab when the user opens or refreshes TurnMap. | Current active tab. |
| `tabs` | Open Full Page mode, activate the source conversation tab for jump-to-source, and route map actions back to the correct tab. | Tab id, URL, and activation state needed for navigation. |
| `scripting` | Inject the content script if TurnMap opens before the content script is already available on the supported AI conversation page. | Current supported AI conversation tab. |
| `sidePanel` | Provide the Chrome/Edge side panel interface. TurnMap declares Chrome 116+ because it calls `sidePanel.open()`. | Extension UI only. |
| `storage` | Save graph state, UI preferences, AI settings, launcher position, Float state, and custom-site profiles locally. | Browser extension profile. |
| `webRequest` | Capture an explicit allowlist of replayable ChatGPT backend request headers so TurnMap can fetch the full current ChatGPT conversation without visible page scrolling when possible. Captured values stay in memory only and are discarded when the service worker stops. | ChatGPT backend requests only. |

## Required Host Permissions

| Host | Why TurnMap Uses It |
| --- | --- |
| Supported AI chat websites | Read the current conversation page, show the launcher/Float UI, and jump back to source turns. |
| `https://chatgpt.com/backend-api/*` | Fetch the full current ChatGPT conversation through the user's existing ChatGPT session when available. |
| `https://api.openai.com/*` | Send AI requests when the user selects the OpenAI preset. |
| `https://api.deepseek.com/*` | Send AI requests when the user selects the DeepSeek preset. |
| `https://openrouter.ai/*` | Send AI requests when the user selects the OpenRouter preset. |
| `https://dashscope-intl.aliyuncs.com/*` | Send AI requests when the user selects the Qwen / DashScope preset. |
| `https://api.moonshot.ai/*` | Send AI requests when the user selects the Kimi / Moonshot preset. |
| `https://ark.cn-beijing.volces.com/*` | Send AI requests when the user selects the Doubao / Volcano Ark preset. |
| `https://open.bigmodel.cn/*` | Send AI requests when the user selects the Zhipu / GLM preset. |
| `https://api.mistral.ai/*` | Send AI requests when the user selects the Mistral preset. |

## Optional Host Permissions

| Host Pattern | Why It Is Optional |
| --- | --- |
| `https://*/*` | Allows TurnMap to request one exact HTTPS origin for a custom provider or selector-only custom site. The broad pattern is optional; TurnMap's custom-site flow submits only the validated exact origin to `chrome.permissions.request`. |
| `http://localhost/*` | Exact local custom-provider or custom-site origins during development/private testing. |
| `http://127.0.0.1/*` | Exact loopback custom-provider or custom-site origins during development/private testing. |

## Review Notes

- TurnMap is current-conversation scoped. It does not build a cross-conversation graph in `v0.9.1`.
- Conversation maps, raw API keys, layout preferences, and UI preferences are stored locally in the browser extension profile.
- AI features send selected conversation content only to the provider configured by the user.
- API key values are redacted from task logs and debug reports; task logs may keep non-secret diagnostics such as provider id, model, host, and error category.
- Topic Analysis runs locally from node metadata and does not add provider host permissions or embedding-model permissions.
- Built-in provider presets are convenience defaults, not a guarantee that every account, region, or future model catalog will expose the same model forever.
- Custom provider permissions are requested at runtime through `chrome.permissions.request`.
- Custom-site profiles are selector-only, cannot shadow a built-in origin, are saved disabled, and request their exact origin only when the user clicks Validate & Enable. Imports remain disabled until revalidated.
- ChatGPT request headers use an explicit allowlist: standard representation headers plus `oai-` and `x-openai-` names. Cookies, authorization headers, arbitrary custom headers, and `sec-` headers are not replayed. Header values are memory only and are never written to extension storage.
- The complete Chrome feature baseline is Chrome 116+ because `chrome.sidePanel.open()` was introduced in that release.
- GitHub/unpacked preview installs do not auto-update themselves. Store builds should use browser-managed updates later.

## Release Decision

The current permission set is acceptable for the local GitHub `v0.9.1` preview.
Before store submission, revisit whether `webRequest` and broad optional custom
provider host access need additional store-review wording or narrower defaults.
