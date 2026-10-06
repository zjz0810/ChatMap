# ChatMap

[English](README.md) | [中文](README.zh-CN.md)

Turn AI conversations into editable, jumpable, exportable mind maps.

> ChatMap is a derivative project based on [Zhaimiaoyizhi/TurnMap](https://github.com/Zhaimiaoyizhi/TurnMap). The upstream MIT license and original copyright notice are retained.

> **ChatGPT-focused release.** This fork prioritizes long conversations on the ChatGPT website. Other LLM sites have adapters, but their history and jump behavior are not verified to the same level. Need a particular LLM site supported? Open an issue in this repository and tell me which one.

ChatMap is a Chromium Manifest V3 browser extension for Chrome and Edge. Its primary focus is mapping long ChatGPT conversations into a visual graph. Each question-answer turn becomes a node that can jump back to the source message, be edited, linked, colored, collapsed, exported, and restored later.

> Status: ChatMap 1.0.0 GitHub preview. It is not yet published to Edge Add-ons or the Chrome Web Store. Install it manually from source or a GitHub Release package.

ChatMap keeps the original chat close by while giving you a map you can scan, edit, color, expand, and export.

## What It Is For

ChatMap is designed for:

- Personal learning and review.
- Long AI conversation navigation.
- Research, writing, and knowledge organization inside a single conversation.

It currently maps the active conversation on supported AI websites. Cross-conversation knowledge graphs are out of scope for the first release.

## Highlights

- **Long conversation map**: turn a sprawling web AI conversation into a node map you can actually scan.
- **Jump back to source**: right-click node text to return to the original answer in the source website.
- **Identity-first navigation**: keep repeated prompts distinct with stable site/message identities and fail safely when an exact target cannot be resolved.
- **Floating navigator and favorites**: browse user turns from the page launcher, preserve the floating list position during refreshes, and keep favorite turns by navigation identity.
- **Prompt Workbench**: manage reusable local prompts beside the ChatGPT composer, fill dynamic variables, optimize only the current input, and build image prompts without sending the full conversation.
- **Answer mini mind maps**: expand one long assistant answer into a compact, title-only map inside the original node.
- **Topic organization**: collapse selected turns into restorable topic groups and review local Topic Analysis candidates.
- **Editable knowledge graph**: edit titles, summaries, tags, statuses, notes, hidden nodes, and relationship links.
- **Visual structure controls**: resize nodes, color nodes, mark important nodes, fold long content, and tune gradient or solid color rendering.
- **Semantic links and weights**: distinguish relationship types with consistent colors and make stronger links visually heavier.
- **Multiple layouts and views**: use Single-side, Radial, Matrix, or Two-sided layouts in Side Panel, Full Page, or Float.
- **ChatGPT-first navigation**: ChatGPT has the verified native indexing and direct-jump path. Other built-in LLM adapters remain available with site-specific capability limits.
- **Export and restore**: export ChatMap JSON, Obsidian Canvas, OPML, Obsidian vault Markdown, Markdown, SVG, and PNG. Use ChatMap JSON for the most complete editable backup.
- **Local-first storage**: keep graph state, UI preferences, and generated language packs in the local browser profile.
- **Safe custom sites**: add selector-only profiles that stay disabled until exact-origin permission and an active-page preview succeed; back them up separately from maps.

## What Changed From Upstream TurnMap

This release starts from [Zhaimiaoyizhi/TurnMap v0.9.2](https://github.com/Zhaimiaoyizhi/TurnMap/tree/v0.9.2). It keeps the upstream MIT license and copyright notice, the editable graph workflow, export formats, and the existing site-adapter foundation. ChatMap is an independently maintained derivative, not an official upstream release.

ChatMap-specific changes in this release:

- **ChatGPT history order:** reconcile overlapping virtualized message windows by stable message identity; older turns loaded while scrolling are inserted before newer turns and indexes are recalculated. This addresses the frozen first turns, newly loaded history being appended at the end, and the newest turn appearing in the middle.
- **Duplicate prompts and repeated reads:** identical prompt text remains distinct when it came from different messages. Streaming updates enrich the matching turn, and stale or partial reads cannot silently replace a newer, fuller index.
- **Refresh Index:** perform a full ChatGPT history scan and rebuild the map from the resulting ordered index. The scan restores the conversation page's original scroll position. Refresh Index regenerates map nodes; export ChatMap JSON first if you need to preserve manual graph edits.
- **Source navigation:** resolve jumps by stable message identity and fail safely when the exact target cannot be found, rather than guessing from similar text.
- **Canvas polish:** lower the zoom-out limit so large maps can fit on screen, and use a restrained white, gray, and blue palette.

The fixes above target ChatGPT. Other LLM website adapters are not claimed to have equivalent long-conversation validation. For another platform or provider, please open an issue and contact the maintainer.

## Changes Since 0.7.2

### Chrome Migration And ChatGPT Navigation (0.8.0–0.8.2)

- Migrated the extension to Chrome/Edge Manifest V3 with a Chrome 116+ side-panel baseline, typed manifest generation, safe reinjection, and release packaging for unpacked installs.
- Rebuilt ChatGPT long-conversation navigation as a clean-room native index with stable turn/message anchors, direct target resolution, bounded shell revive, and no legacy harvest scrolling.
- Added the hover-triggered floating conversation navigator, then stabilized refresh behavior so the source page and floating list do not unexpectedly move.
- Added the local Prompt Workbench beside the ChatGPT composer: reusable templates, variables, import/export, AI rewriting of the current input only, image-prompt controls, localization, and theme-aware settings.

### Identity-First Multi-Site Navigation (0.8.3)

- Added site-scoped navigation identities and multi-site floating navigation across the 13 built-in adapters.
- Replaced non-ChatGPT long-distance extraction scrolling and SourceAnchor text-search jumps with non-scrolling mounted-DOM refresh, exact identity resolution, and explicit safe failure.
- Preserved repeated prompts as separate turns, enriched streaming answers without changing identity, and added identity-backed floating favorites.

### Evidence Registry And Safe Custom Sites (0.8.4)

- Added a repository-backed capability registry, dated per-site QA reports, screenshots, and evidence-gated labels so DOM smoke tests cannot be presented as native support.
- Renamed Deep Scan to Refresh Index, removed retired reading/jump controls, and kept missing-middle-turn merge behavior without searching or scrolling the page.
- Added selector-only custom-site profiles with exact-origin permission, bounded path matching, selector validation, active-page preview, disabled-by-default storage, and separate JSON import/export.

### Silent Structured Indexes (0.9.0–0.9.2)

- Added passive structured indexes for Gemini, Doubao, DeepSeek, Qwen, Claude, Kimi, Grok, and Z.ai by reusing conversation responses or client state already available to each page.
- Added stable conversation/message identities, repeated-prompt separation, active-branch handling, streaming enrichment, SPA/session isolation, and exact mounted-target validation without extraction-time scrolling.
- Added deterministic, user-triggered native revival where the site exposes a verified controller path: DeepSeek keyed virtual items, Doubao virtual rows, and Kimi previous segments. Unsupported or mismatched targets fail without fuzzy text matching or scroll search.
- Added site-specific correctness handling: Kimi segment/attachment aggregation, Grok prompt-echo and nested-response deduplication, Claude UUID branch handling, and host-scoped ChatGLM/Z.ai variants.
- Integrated all eight retained high-frequency site adaptations into the `0.9.2` build while preserving the capability registry's real-browser evidence boundaries.

## Supported Site Capabilities

ChatGPT is ChatMap's verified native reference route. The other built-in adapters now use the same identity-first safety rules, but remain labeled DOM fallback until long-conversation browser evidence proves a site-native full index and off-screen remount route. An ordinary DOM extraction success is not enough to claim native support.

| Site | Extraction tier | Jump tier | Assistant text | Known limitation |
| --- | --- | --- | --- | --- |
| ChatGPT | Verified native user index | Verified native direct jump + bounded shell revive | Best effort | The page may not expose every assistant answer cheaply. |
| DeepSeek | Evidence-gated structured history index; capability remains mounted-DOM | Exact strong-ID jump; native revive remains evidence-gated | Best effort | Authenticated long/off-screen acceptance remains blocked. |
| Kimi | Evidence-gated paged message index; capability remains mounted-DOM | Exact strong-ID jump; native previous-segment revive remains evidence-gated | Best effort | Authenticated long/off-screen acceptance remains blocked. |
| Doubao | Evidence-gated structured message index; capability remains mounted-DOM | Exact strong-ID jump; deterministic virtual target remains evidence-gated | Best effort | Authenticated long/off-screen acceptance remains blocked. |
| Qwen | Evidence-gated structured index; capability remains mounted-DOM | Exact mounted strong-ID jump | Best effort | Two repeated mounted turns smoke-tested; no verified off-screen remount/native claim. |
| Gemini | Evidence-gated structured conversation index; capability remains mounted-DOM | Exact mounted strong-ID jump | Best effort | Two repeated mounted turns smoke-tested; no off-screen/native claim. |
| Google AI Studio | Identity-first mounted DOM fallback | Exact mounted-identity jump | Best effort | Unmounted turns fail safely; no scroll/text search. |
| Claude | Evidence-gated structured UUID index; capability remains mounted-DOM | Exact mounted UUID jump | Best effort | Cloudflare blocked authenticated long/off-screen acceptance. |
| Perplexity | Identity-first mounted DOM fallback | Exact mounted-identity jump | Best effort | Unmounted turns fail safely; no scroll/text search. |
| Grok | Evidence-gated response-graph index; capability remains mounted-DOM | Exact mounted response-ID jump | Best effort | Authenticated long/off-screen acceptance remains unavailable. |
| GLM / Z.ai | Host-scoped variants; Z.ai structured index remains evidence-gated | Exact mounted Z.ai message-ID jump | Best effort | ChatGLM and Z.ai retain separate evidence boundaries; no native claim. |
| Mistral Le Chat | Identity-first mounted DOM fallback | Exact mounted-identity jump | Best effort | Unmounted turns fail safely; no scroll/text search. |
| Arena / LMArena | Identity-first mounted DOM fallback | Exact mounted-identity jump | Best effort | Battle mode reads the selected answer side; unmounted turns fail safely. |

ChatMap's ChatGPT route is a clean-room implementation. ophel is referenced for product behavior and architecture; ChatMap does not copy GPL-licensed code.

## Current Views

| View | Purpose |
| --- | --- |
| Side Panel | Work beside a supported AI conversation in the browser side panel. |
| Full Page | Use a larger map canvas while staying linked to the source conversation tab. |
| Float | Use a compact in-page navigator on supported AI pages. |
| Page Launcher | Use a small right-side launcher on supported AI pages to open ChatMap or settings. |

## Planned Before Public Release

These items are planned before a wider public release:

- **Update Notice**: notify users when a new GitHub Release or store version is available.
- **More AI chat sites**: continue improving adapters for supported web AI products and add more sites as their page structures stabilize. Suggestions for additional sites are welcome.
- **More browsers**: extend compatibility beyond Chromium browsers, especially Firefox.
- **More AI providers**: broaden API key support for more OpenAI-compatible and mainstream model providers.
- **Stronger organization features**: improve local topic analysis, AI summaries, AI suggested links, provider compatibility, and task-log based troubleshooting.

## Install From Source

Requirements:

- Node.js
- Google Chrome 116+ or Microsoft Edge 116+
- A supported web AI session

Build:

```powershell
npm install
npm.cmd run build
```

Load in Chrome or Edge:

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `<project-root>\dist`.
5. Open a supported AI conversation.
6. Open ChatMap from the extension action or browser side panel.

## Install From GitHub Release

For preview builds, download the release zip from GitHub Releases, unzip it, and load the unpacked folder in Chrome or Edge developer mode.

GitHub/unpacked installs require manual updates. Store distribution is the right path for automatic browser-managed updates.

The local release archive is `release/chatmap-v1.0.0.zip`. ChatGPT is the primary target for this release. Other built-in site adapters remain available with the site-specific capability limits shown above. For long-term backup or transfer, export ChatMap JSON first because it preserves ChatMap-specific editing state more completely than visual formats.

## Basic Usage

1. Open a supported AI conversation.
2. Open ChatMap.
3. Click Refresh to read the available conversation index. ChatGPT uses its verified native route; supported sites may also reuse an evidence-gated structured index, while the capability table remains the source of truth for browser-verified native claims.
4. Choose a layout: Single-side, Radial, Matrix, or Two-sided.
5. Single-click a node to select it and use Node Actions.
6. Right-click node body text to jump back to the source page.
7. Edit nodes, color nodes, collapse long nodes, mark important nodes, or create links as needed.
8. Drag the left, right, or bottom handle, or the lower-left/lower-right corner, to resize a node.
9. Select a turn node and use Node Actions to expand the answer into a mini-map. This requires a configured API key.
10. Select multiple nodes to batch tag them or collapse them into a restorable topic node.
11. Select links to use Link Actions for color/type, weight, importance, labels, and notes. Multi-selected links can receive one shared weight.
12. Use Files to export or import a map. Use ChatMap JSON first for complete editable recovery.

## Appearance and Interface Settings

ChatMap has a dedicated settings page for global UI preferences:

- **Theme**: light, dark, eye-care, or follow browser.
- **Language**: follow browser, English, Chinese, and locally saved AI-generated custom UI translations.
- **Default layout**: Single-side, Radial, Matrix, or Two-sided.
- **Node color rendering**: choose gradient or solid background rendering and adjust color intensity.
- **Link style**: choose curved or angled normal-node links. Mini nodes and their internal mini-map links keep their compact built-in style.
- **AI output budget**: adjust `max_tokens`, which caps output length but does not change the model's context window.
- **Entry points**: manage Side Panel, Full Page, Float, and page launcher preferences.
- **Custom sites**: save local selector profiles, request only their exact origin, validate against the active page, and import/export them as a separate JSON backup.

## AI Features

ChatMap supports providers that expose an OpenAI-compatible `/chat/completions` API. Provider presets are convenience defaults for fast, lower-cost, context-friendly models; users can still edit the base URL and model when their account, region, or endpoint requires a different value.

Supported presets:

- OpenAI
- DeepSeek
- OpenRouter
- Qwen / DashScope
- Kimi / Moonshot
- Doubao / Volcano Ark
- Zhipu / GLM
- Mistral
- Gemini compatible
- Custom OpenAI-compatible endpoint

AI features are currently preview capabilities and are not yet fully reliable across every provider:

- **Summarize**: generate compact node titles and summaries, with provider JSON/text response compatibility still being improved.
- **Analyze Topics**: locally preclassify likely topic-related link candidates from node titles, summaries, tags, distance, and existing links, then show them for review before changing the graph.
- **Suggest Links**: propose strong semantic links between non-adjacent related nodes, with thresholds and visual density still being tuned.
- **AI translation**: generate local UI language packs with the user's API key, import/export standard JSON language packs, and fall back to English for missing labels.
- **Auto summarize**: summarize new/default nodes when enabled.

Future versions will continue improving AI summaries, AI suggested links, provider compatibility, and task-log based troubleshooting.

API keys are saved in the browser extension's local storage under the user's local browser profile. Paste the raw key only, without a `Bearer ` prefix. Some providers use the model field as an endpoint ID, and the base URL is always the request entry point rather than part of the key.

ChatMap keeps larger task-level output budgets for summarization, link suggestions, and AI UI translation while leaving `maxTokens` configurable up to 24000. AI translation sends only ChatMap UI labels, may make one extra API call to repair malformed JSON, and stores generated/imported language packs locally. See [AI Provider Guide](docs/ai-provider-guide.md) for provider defaults, language-pack format, response-format requirements, and token-budget notes.

## Privacy

By default, ChatMap stores conversation maps locally in the browser extension storage. Analyze Topics runs locally and uses node metadata already present in the map. AI features send selected conversation text to the provider configured by the user. Exports are controlled by the user.

See [Privacy Statement](docs/privacy-statement.md).

## Permissions

ChatMap requests the minimum permissions currently needed for the preview build:

- `activeTab`, `tabs`, and `scripting` to find the active supported AI conversation tab, inject the content script when needed, open Full Page mode, and jump back to source turns.
- `sidePanel` to provide the Edge side panel UI.
- `storage` to save maps, settings, AI provider configuration, launcher position, and Float state locally.
- `webRequest` to support full conversation extraction from ChatGPT backend requests when available.
- Host access to supported AI chat websites and built-in AI provider API hosts.
- Optional host access for custom-site profiles, requested as one exact origin only when the user chooses Validate & Enable.

See [Permission Review](docs/permissions-review.md).

## Development

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package
```

`npm.cmd run package` creates a zip package in `release/`.

## Project Structure

```text
src/content       Site adapters, extraction, jumping, Float, launcher-related code
src/side-panel    Main ChatMap UI
src/full-page     Full Page entrypoint
src/background    MV3 service worker
src/shared        Shared message and type definitions
docs              User, developer, privacy, and release docs
scripts           Build and packaging helpers
```

## Documentation

- [User Guide](docs/user-guide.md)
- [Developer Guide](docs/developer-guide.md)
- [AI Provider Guide](docs/ai-provider-guide.md)
- [Privacy Statement](docs/privacy-statement.md)
- [Permission Review](docs/permissions-review.md)
- [Release Readiness](docs/release-readiness.md)
- [GitHub Release Plan](docs/github-release-plan.html)

## Known Limitations

- AI website page structures can change without notice.
- Repeated identical prompts can reduce jump precision in some conversations.
- GitHub/unpacked installs cannot be silently auto-updated by the extension itself.
- Store submission may require PNG icons and additional privacy materials.
- AI translation, AI summaries, and AI suggested links depend on provider request and response behavior and remain preview features.

## Roadmap

- `0.1.x`: stabilize AI fallback and Float / Full Page small-screen behavior while keeping current extraction and jumping stable.
- `0.2.0`: add GitHub Release checks, ignored versions, remind-later update notices, and redacted debug reports.
- `0.3.0`: add collaboration and advanced export paths. OPML and Obsidian vault Markdown are implemented; XMind remains the next priority before Anki CSV.
- `0.4.0`: add adapters for ChatGPT, Gemini, Claude.ai, DeepSeek, Kimi, Doubao, Qwen, Google AI Studio, Perplexity, Grok, GLM / Z.ai / Zhipu Qingyan, Mistral Le Chat, and Arena / LMArena. After the current plan is complete, continue with MiniMax Agent.
- `0.5.0`: expand API key and provider compatibility with cost-aware presets for OpenAI, DeepSeek, OpenRouter, Qwen, Kimi, Doubao, Zhipu, Mistral, Gemini-compatible Vertex endpoints, and Custom OpenAI-compatible endpoints.
- `0.5.1`: complete AI UI translation language packs with generation, import/export, JSON repair, local storage, and layout-safety safeguards.
- `0.6.0`: add local Topic Analysis that preclassifies high-confidence candidate links for review without provider embeddings.
- `0.7.0`: improve knowledge organization with answer mini mind maps, smarter links, batch link review, topic collapse, bulk tags, and saved node sizing.
- `0.7.1`: refine mini mind maps and appearance customization while hardening graph hygiene and automatic link reliability with stable new turn IDs, link weights, topic proxy metadata, and local repair logs.
- `0.7.2`: stabilize 0.7.x reading, jumping, launcher startup, map switching, default node sizing, and settings layout before the next larger feature phase.
- `0.8.0`: migrate compatibility to Chrome; Firefox is reserved for a later sidebar-specific phase.
- `0.8.2`: add the ChatGPT native navigation preview, floating conversation navigator, and local Prompt Workbench.
- `0.8.3`: migrate built-in sites to identity-first, non-scrolling refresh and exact mounted-target navigation.
- `0.8.4`: add evidence-tracked capability records, per-site QA reports, Refresh Index, and permission-gated selector-only custom sites.
- `0.9.0`: Gemini passive native indexing, stable request/response identities, deterministic mounted-turn binding, and evidence-gated navigation.
- `0.9.1`: Doubao passive native indexing, stable conversation/message identities, deterministic virtual-list targeting, and exact-ID remount verification.
- `0.9.2`: upstream TurnMap baseline integrating evidence-gated structured indexes and exact-identity navigation for eight high-frequency sites.
- `1.0.0`: first ChatMap-focused release; adds ChatGPT long-history order reconciliation, safer refresh/jump identity, new branding, updated light theme, and a lower canvas zoom limit.

Release details:

- [0.6.0 release notes](docs/release-notes-0.6.0.md) describe the changes since the previous GitHub push.

## Contributing

Bug reports, feature requests, and AI provider compatibility reports are welcome through GitHub Issues.

Before opening a pull request, run:

```powershell
npm.cmd run typecheck
npm.cmd run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Do not commit API keys, private conversation exports, browser profile data, or screenshots containing private conversations.

See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

