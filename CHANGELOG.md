# Changelog

All notable changes to ChatMap are documented here. History inherited from Zhaimiaoyizhi/TurnMap is kept for attribution.

## [1.0.0] - ChatGPT-Focused ChatMap Release (2026-10-06)

### Source and Attribution

- Rebranded this independent derivative of [Zhaimiaoyizhi/TurnMap v0.9.2](https://github.com/Zhaimiaoyizhi/TurnMap/tree/v0.9.2) as ChatMap. The upstream MIT license and copyright notice remain in the repository; this is not an official TurnMap release.
- Retained the upstream graph-editing workflow, export formats, and built-in site-adapter foundation while documenting the capability boundary of each site.

### ChatGPT Long-Conversation Fixes

- Reconcile overlapping virtualized ChatGPT history windows by stable message identity and chronological overlap. Older turns loaded while scrolling are prepended and turn indexes are recalculated, fixing frozen leading nodes, out-of-order tails, and new history appearing at the end.
- Keep separate messages with identical prompt text as separate turns. Merge streamed answer updates into the existing turn instead of creating another node.
- Prevent stale asynchronous reads and partial mounted-window snapshots from overwriting a newer or more complete conversation index.
- Make **Refresh Index** perform a full history scan and rebuild the graph from the ordered result. Restore the ChatGPT page's original scroll position after scanning. This rebuild regenerates map nodes; export ChatMap JSON first if you need to retain manual graph edits.
- Resolve source jumps with stable message identities and fail explicitly when the exact target cannot be found, instead of guessing from similar text.

### Interface and Packaging

- Rename the extension, package, manifest, icons, and user-facing documentation to ChatMap while retaining source attribution.
- Replace the default light palette with a restrained white, gray, and blue theme; lower the minimum canvas zoom to fit larger graphs; hide the per-node AI button.
- Set the first ChatMap release version to `1.0.0`; produce Chrome/Edge unpacked and ZIP packages.

### Scope and Verification

- This release specifically prioritizes the ChatGPT website. Other built-in LLM adapters remain available, but their long-history and off-screen jump capabilities retain the site-specific verification limits in the README. Requests for another LLM platform are welcome through GitHub Issues.
- `npm run package` completed successfully for this release. The build does not claim new authenticated live-browser acceptance for every site.

## Unreleased

## [0.9.2] - Eight-Site Silent Navigation Integration

### Grok Silent Native Index

#### Added

- Added a clean-room Grok native response index that passively observes the site's existing conversation response stream at `document_start`, pairs human and assistant responses by `parentResponseId`, and assigns stable origin/conversation/response identities without scrolling the page.

#### Changed

- Grok now prefers structured `responseId`, `sender`, `message`, and `parentResponseId` data over mounted-DOM text. Assistant-side prompt echo fields and repeated nested response objects do not create duplicate turns, while longer streamed answers enrich the same navigation identity.
- Grok direct navigation reveals only an exact mounted backend response ID. A missing or mismatched target fails explicitly without selecting a neighboring response, text matching, or scroll search.
- `grok.com` and `x.com` native caches are origin-scoped. The X Grok shell retains safe mounted-DOM fallback because anonymous browser evidence reached the X login flow and did not prove protocol compatibility with `grok.com`.

#### Verification Boundary

- Synthetic prompt-echo, repeated-text identity, nested-response deduplication, streaming enrichment, origin isolation, exact-target, wrong-ID, safe-failure, adapter-routing, and eager passive-capture coverage is recorded in `tests/grok-native-navigation.test.mjs`.
- The current public `grok.com` page and production bundles confirmed `/c/:conversationId`, `GET/POST /rest/app-chat/conversations/:conversationId/responses`, and the `responseId` / `sender` / `message` / `parentResponseId` response graph. Authenticated long-conversation and off-screen acceptance remains unavailable, so Grok stays `blocked-auth` at the mounted-DOM capability tier.

### Kimi Silent Native Navigation

#### Added

- Added a clean-room Kimi conversation index that passively captures the existing `ListMessages` response at `document_start`, silently follows its pagination tokens, reconstructs the active `parent_id` chain, and assigns stable conversation/user-message identities without scrolling the page.
- Added exact Kimi segment binding through the page's Vue message objects so mounted turns keep their native message IDs across DOM remounts.

#### Changed

- Kimi now prefers structured message history over mounted-DOM extraction, merges consecutive assistant segments into one turn, enriches attachments and references without duplicate body text, and clears cached identities on SPA conversation changes.
- Kimi direct navigation now reveals only an exact `data-turnmap-kimi-message-id` target. It may ask Kimi's native client state to load older segments after an explicit user jump, but a missing or mismatched target fails safely without text matching or extraction-time scroll search.

#### Verification Boundary

- Synthetic paged-history, repeated-prompt identity, multi-assistant-segment merge, attachment/reference deduplication, streaming enrichment, SPA isolation, DOM remount, exact-target, wrong-ID, adapter-routing, and no-scroll observer coverage is recorded in `tests/kimi-native-navigation.test.mjs`.
- The current public Kimi production bundle confirmed `ListMessages` pagination, stable message and parent IDs, Vue segment identity, and the native previous-segment loader. An authenticated long/off-screen conversation was not available, so browser acceptance remains `blocked-auth` and the capability registry is unchanged.

### GLM / Z.ai Variant Split And Silent Index

#### Added

- Added a clean-room Z.ai conversation index that passively captures existing `/api/v1/chats/new` and chat-detail request/response pairs at `document_start`, follows the active `history.currentId` parent chain, and assigns stable conversation/message UUID identities without scrolling the page.

#### Changed

- Split the previous broad `glm` selector profile into host-scoped ChatGLM and Z.ai variants so their DOM selectors, native response handling, and cached identities cannot leak across frontends.
- Z.ai now prefers the structured UUID index when available, ignores reasoning/planning fields in final assistant text, enriches mounted turns only by exact `message-<UUID>` identity, and reveals only an exact mounted target. Missing or mismatched targets fail explicitly without text matching or scroll search.

#### Verification Boundary

- Synthetic active-branch, repeated-prompt UUID, streaming enrichment, planning exclusion, variant/host/conversation isolation, exact mounted target, safe-failure, adapter-routing, and passive-capture coverage is recorded in `tests/glm-native-navigation.test.mjs`.
- The 2026-07-13 browser investigation confirmed Z.ai's `chat.history.messages` payload and mounted `message-<UUID>` ids, but slider verification blocked completed streaming and long/off-screen acceptance. ChatGLM was blocked by slider verification before its application shell. The external `glm` capability therefore remains `smoke-verified` at the mounted-DOM tier, with per-host limitations documented separately.

### Qwen Silent Native Index

#### Added

- Added a clean-room Qwen conversation index that passively captures the existing `GET /chats/:id` response at `document_start`, follows the active `history.currentId` parent chain, and assigns stable conversation/user-message identities without scrolling the page.

#### Changed

- Qwen now prefers the structured active-branch history over mounted-DOM extraction, retains early turns when their DOM rounds are absent, enriches streamed answers on the same navigation identity, and clears cached identities on SPA conversation changes.
- Qwen direct navigation now reveals only an exact mounted `data-chat` or `data-message-id` round. An unmounted or mismatched target fails explicitly without text matching or scroll search.

#### Verification Boundary

- Synthetic complete-history, repeated-prompt identity, streaming enrichment, early-round retention, active regeneration branch, SPA isolation, exact mounted target, safe-failure, adapter-routing, and passive-capture coverage is recorded in `tests/qwen-native-navigation.test.mjs`.
- The current public Qwen bundle confirmed `GET /chats/:id`, `history.messages`, `currentId`, `parentId`, stable message IDs, and response branch IDs. The available browser session could not provide a policy-verifiable authenticated inspection, so 20-turn/off-screen acceptance remains incomplete and Qwen stays `smoke-verified` at the mounted-DOM capability tier.

### DeepSeek Silent Native Navigation

#### Added

- Added a clean-room DeepSeek conversation index that passively captures `/api/v0/chat/history_messages` at `document_start`, follows the active `parent_id` chain from `current_message_id`, and assigns stable conversation/message identities to repeated prompts without scrolling the page.
- Added a deterministic, user-triggered DeepSeek virtual-list bridge that targets the exact native message ID and revalidates the exact `[data-virtual-list-item-key]` after remount.

#### Changed

- DeepSeek now prefers the structured active-branch history over mounted-DOM extraction, excludes `THINK` fragments from assistant answers, and merges streamed response fragments without replacing stable turn identities.
- DeepSeek direct navigation now resolves an exact mounted message or invokes one exact native virtual-list target. Missing, wrong, or unremounted targets fail explicitly without similarity matching or scroll search.

#### Verification Boundary

- Synthetic full-history, repeated-prompt identity, active-branch, thinking exclusion, streaming enrichment, SPA isolation, exact remount, wrong-ID, timeout, adapter-routing, and passive-capture coverage is recorded in `tests/deepseek-native-navigation.test.mjs`.
- A real anonymous DeepSeek session and its production bundle confirmed the history schema, stable message IDs, active-parent chain, and native keyed virtual-list controller. The live page redirected to `/sign_in`, so authenticated long-conversation acceptance remains blocked and the capability registry stays `blocked-auth` at the mounted-DOM tier.

### Claude Silent Native Index

#### Added

- Added a clean-room Claude conversation index that passively captures the page's existing conversation-detail response at `document_start`, builds stable user/assistant UUID identities, and follows the selected message leaf for edit, retry, and branch changes without scrolling the page.

#### Changed

- Claude now prefers the structured UUID index over mounted-DOM extraction, keeps same-branch captures grow-only, replaces stale turns on an explicit branch switch, and clears cached identities when the SPA conversation changes.
- Claude direct navigation now resolves an exact mounted message UUID or a complete ordered UUID binding after DOM remount. If the target is off-screen and Claude exposes no verified native route or virtual-item control, TurnMap fails explicitly without text matching or scroll search.

#### Verification Boundary

- Synthetic full-history, repeated-text UUID, edit/retry branch, explicit-deletion, transient-partial, SPA isolation, DOM remount, streaming suffix, safe-failure, adapter-routing, and passive-capture coverage is recorded in `tests/claude-native-navigation.test.mjs`.
- The real browser check on 2026-07-13 remained blocked by Cloudflare security verification. Claude therefore remains `blocked-access` at the mounted-DOM capability tier until an authenticated long conversation proves full indexing and deterministic off-screen navigation.

## [0.9.1] - Doubao Silent Native Navigation

### Added

- Added a clean-room Doubao native conversation index that passively captures history and current-chain responses at `document_start`, preserves ghost turns by conversation/message identity, and enriches streamed answers without scrolling the page.
- Added a deterministic, user-triggered virtual-list bridge for off-screen Doubao turns using the site's mounted React list controller and stable `data-message-id` targets.

### Changed

- Doubao now prefers the native message index over the mounted DOM while retaining strong-ID mounted turns that have not yet appeared in captured history.
- Doubao direct navigation first reveals an exact mounted message. For an off-screen message it requests one native virtual target, waits for remount, revalidates the exact message ID, and otherwise fails safely without text matching or scroll search.
- Updated package, extension, permission-review, and local preview metadata to `0.9.1`.

### Verification Boundary

- Synthetic full-history, repeated-text identity, streaming enrichment, transient-empty retention, conversation isolation, virtual-target, exact-remount, timeout, wrong-ID, adapter-routing, and passive-capture coverage is recorded in `tests/doubao-native-navigation.test.mjs`.
- A real anonymous Doubao page and its current production bundles confirmed the early-load boundary, message endpoints, stable message IDs, and deterministic virtual-list controllers. Logged-in long-conversation/off-screen acceptance was not available, so Doubao remains `blocked-auth` at the mounted-DOM tier in the capability registry.

## [0.9.0] - Gemini Silent Native Navigation

### Added

- Added a clean-room Gemini native conversation index that passively captures the `hNvQHb` conversation response at `document_start`, derives stable request/response identities, and enriches streamed answers without scrolling the page.

### Changed

- Gemini now prefers the native conversation index for complete history extraction and uses deterministic ordered DOM binding for mounted turns. Repeated prompt text is resolved by native identity and position, never by similarity guessing.
- Gemini direct navigation now reveals only a deterministically bound mounted target and otherwise fails safely without extraction scrolling or text-search fallback.
- Updated package, extension, permission-review, and local preview metadata to `0.9.0`.

### Verification Boundary

- Synthetic protocol, repeated-turn, streaming-enrichment, remount, SPA-isolation, and safe-failure coverage is recorded in `tests/gemini-native-navigation.test.mjs`.
- A real anonymous Gemini page confirmed that the early MAIN-world observer and TurnMap launcher load together. Long-conversation/off-screen acceptance was not completed, so Gemini remains `smoke-verified` at the mounted-DOM tier and is not promoted in the capability registry.

## [0.8.4] - Evidence-Tracked Navigation And Safe Custom Sites

### Added

- Added a repository-backed capability and browser-evidence registry for all 13 built-in sites, with per-site redacted reports and screenshots.
- Added selector-only custom-site profiles with exact-origin validation, bounded path globs, safe CSS selector checks, local versioned storage, active-page preview, and separate merge/replace import/export.
- Added a dedicated bilingual Custom Sites settings workspace. Profiles are saved disabled and can be enabled only after exact-origin permission and preview succeed.

### Changed

- Removed the retired pre-0.8.0 smart-scroll harvest, directional SourceAnchor text search, and Reading and Jumping settings UI.
- Renamed the visible Deep Scan action to Refresh Index so the UI no longer promises scrolling behavior. Existing internal merge semantics still insert missing middle turns without searching the page.
- Made every built-in adapter consume its site-specific evidence record while retaining ChatGPT as the only verified native full-index/direct-jump implementation.
- Recorded Qwen and Gemini repeated-prompt mounted-DOM smoke evidence and a GLM / Z.ai one-turn smoke result without promoting any of them to native support.
- Updated package, extension, documentation, and capability metadata to `0.8.4`.

### Fixed

- Fixed streamed turns that were first mapped as `No text response` so a later completed answer can enrich the same navigation identity.
- Fixed generated turn titles and summaries being persisted as manual overrides, which previously allowed a placeholder answer to mask later source updates.
- Localized custom-site disabled reasons instead of exposing internal reason codes.

### Verification Boundary

- The unpacked build injected one TurnMap launcher on every built-in site in Chrome for Testing.
- Qwen completed two identical prompts and TurnMap mapped two distinct nodes with both answers after the streaming fix; Gemini mapped two repeated mounted turns; GLM / Z.ai mapped one complete anonymous turn.
- DeepSeek, Kimi, Doubao, Google AI Studio, Grok, Claude, Perplexity, Mistral, and Arena remain explicitly limited by authentication, challenge, response, or consent gates documented under `docs/qa/native-navigation/`.
- No Cloudflare challenge was bypassed, no Arena legal terms were accepted, and no non-ChatGPT adapter is labeled native without long-conversation/off-screen evidence.

## [0.8.3] - Multi-Site Identity-First Navigation

### Added

- Added a shared capability contract for user indexing, target identity, direct jumping, shell revival, and assistant-text completeness.
- Added site-scoped `ophel_notSourceAnchor` identities to DeepSeek, Kimi, Doubao, Qwen, Gemini, Google AI Studio, Claude, Perplexity, Grok, GLM / Z.ai, Mistral Le Chat, and Arena / LMArena.
- Added an explicit 13-site capability table to the English and Chinese documentation.
- Added multi-site floating navigation for every selected built-in adapter.

### Changed

- Migrated all non-ChatGPT built-in adapters away from the pre-0.8.0 long-distance scrolling extraction and SourceAnchor text-search jump route.
- Changed Refresh, complete refresh, and the existing Deep Scan entry point on non-ChatGPT sites to the same non-scrolling mounted-DOM identity refresh.
- Changed non-ChatGPT turn merging to use navigation identity, preserving repeated prompts that have different message identities.
- Changed non-ChatGPT jumps to resolve exact mounted identities only; unmounted targets now fail explicitly instead of jumping to similar text or a neighboring turn.
- Updated package and extension metadata to `0.8.3`.

### Verification Boundary

- ChatGPT remains the verified native full-index/direct-jump reference implementation with bounded shell revival.
- The other twelve built-in sites are labeled identity-first DOM fallback until real-account long-conversation evidence supports promotion to full native capability.
- The implementation is clean-room: ophel informs product behavior and architecture, but no GPL code is copied.

## [0.8.2] - ChatGPT Native Navigation And Prompt Workbench Preview

### Preview Scope

- This is a ChatGPT-only preview build. Existing non-ChatGPT adapters remain on their current extraction and jump paths, with broader migration reserved for later 0.8.x work.
- This release references ophel's ChatGPT native navigation and outline ideas, and my-prompt's input-side prompt workbench interaction model. TurnMap keeps its own implementation and does not copy GPL-licensed ophel code.

### Added

- Added a ChatGPT-focused ophel-style native turn index for quieter long-conversation reading and direct turn navigation.
- Added a hover-triggered floating conversation navigator that lists ChatGPT turns near the TurnMap floating button and updates as new Q&A turns appear.
- Added a ChatGPT prompt workbench next to the input box, with local prompt management, dynamic prompts, AI input optimization, image-prompt optimization, custom menu options, random option selection, and import/export.
- Added editable built-in prompt templates, language-aware defaults, and theme-aware prompt workbench settings.
- Added the 0.8.2 preview screenshot at `docs/assets/release-images/turnmap-v0.8.2-preview.png`.

### Changed

- Updated ChatGPT reading and jump behavior to prefer native page turn/message anchors before falling back to heavier legacy paths.
- Updated AI optimization to rewrite only the current input, without sending the full conversation context, and to return in the user's selected language.
- Updated image-prompt optimization so selected menu constraints are assembled into a professional prompt and written back to the input box.
- Updated prompt workbench tooltips, icon layout, popup placement, and settings surfaces to better match the selected language and theme.
- Updated package and extension metadata to `0.8.2`.

### Fixed

- Fixed prompt workbench content-script startup errors around missing settings fields.
- Fixed floating prompt/workbench tooltip overlap and off-screen popup placement issues.
- Reduced initial floating navigator scroll snap-back and right-click jump instability in the ChatGPT preview path.

## [0.7.2] - Reading, Jumping, And Settings Stability

### Added

- Added user-tunable Reading and Jumping controls for scan speed, edge wait time, and fallback jump search strength.
- Added a separate Reading and Jumping settings section after Interface settings and before Updates.
- Added default node-size controls for ordinary turn nodes.

### Changed

- Updated package and extension metadata to `0.7.2`.
- Updated Refresh and Deep Scan behavior so switching between AI conversations first resolves the current conversation map before replacing the visible graph.
- Tightened mini mind map link routing for cleaner corresponding mini-node connections.
- Polished settings layout and launcher synchronization.

### Fixed

- Fixed a content-script startup regression where reading/jump settings could be emitted as an extra bundle chunk, preventing the page launcher from appearing and blocking conversation reads.
- Fixed short-conversation lazy jump scrolling so failed jumps do not create long visible page jitter.
- Fixed default-node-size setting refresh loops that could reload the graph unexpectedly.
- Fixed collapsed/default node sizing regressions so node dimensions better fit the displayed content.

## [0.7.1] - Graph Hygiene And Link Reliability

### Added

- Added the 0.7.1 mini mind map polish path: clearer title-only answer expansion layout, persistent mini-map export rendering, and editing controls that stay in the existing actions panels instead of crowding mini nodes.
- Added stable turn ID generation for newly extracted conversations, using message IDs when available and content hashes when they are not.
- Added link weights across manual links, AI suggestions, topic-analysis candidates, automatic sequence links, and topic proxy links.
- Added a weight slider to single-link and multi-link Link Actions, with weight affecting line thickness and opacity while important links still receive extra emphasis.
- Added a global Interface setting for normal-node link style, with Curved as the default and Angled available for users who prefer elbow-like links.
- Added appearance refinements for graph editing controls, including themed layout selection and always-visible color previews in Node Actions, Mini Node Actions, and Link Actions.
- Added local graph health repair for layout, import, and export paths, including invalid weight repair, invalid position/dimension repair, dangling edge drops, invalid proxy edge drops, and task-log/status reporting.
- Added formal topic proxy metadata with `originalEdgeId`, `proxyKind`, `topicGroupId`, and inherited `weight`.
- Added unit coverage for stable IDs, edge weights, graph health repair, topic proxy metadata, export weight preservation, and i18n wiring.

### Changed

- Updated TurnMap JSON persistence/export schema to `schemaVersion: 4` while continuing to load schema 3 exports.
- Updated Markdown, OPML, Obsidian vault Markdown, Obsidian Canvas, SVG, and PNG exports to preserve or visually reflect link weights.
- Updated new answer expansions to always expand to the right; old saved left-direction expansion data is not migrated.
- Updated package and extension metadata to `0.7.1`.

### Fixed

- Fixed edited link weights forcing normal graph links back into the angled/smoothstep shape when the user wanted curved links.
- Fixed ChatGPT extraction reading only the first markdown block from a multi-block assistant answer.
- Fixed a default-node-size settings refresh loop that could repeatedly reload the graph and leave only the themed background visible after the side panel opened.

### Development Notes

- Lesson learned: storage-backed object settings must reuse the previous React state object when values are unchanged, especially when callback dependencies feed graph-loading effects. Equal-value refreshes should be idempotent, not a hidden reload trigger.

## [0.7.0] - Knowledge Organization And Node Editing

### Added

- Added API-only answer expansion that turns a turn's assistant answer into a structured title-only mini mind map inside the original node, with atomic no-write behavior when the AI call fails or returns invalid structure.
- Added the v2 answer-expansion schema with tree fields, left/right layout direction, up to 80 mini nodes for dense answers, automatic branch coloring, lightweight summary braces, and subtree deletion.
- Added saved node dimensions with resize handles on the left, right, bottom, lower-left, and lower-right of each node.
- Added saved answer-expansion data and Mini Node Actions for selected mini nodes, including title edits, color, importance, subtree deletion, and display mode restore.
- Added restorable topic groups that hide selected turns behind a topic node, proxy boundary links while collapsed, and restore original nodes and links when expanded.
- Added batch tag editing in Node Actions and batch link type/color/importance editing in Link Actions.
- Added schema v3 persistence and unit coverage for node dimensions, answer expansion, topic groups, batch tags, and i18n wiring.

### Changed

- Updated TurnMap JSON, PNG/SVG rendering, and Obsidian Canvas export to preserve or reflect answer expansion state, mini-map direction/tree metadata, and node sizing. TurnMap JSON remains the recommended full-fidelity backup format.
- Updated README, Chinese README, and user guide with 0.7.0 workflows and the resize-handle locations.
- Updated package and extension metadata to `0.7.0`.

## [0.6.0] - Topic Analysis MVP

Release notes: `docs/release-notes-0.6.0.md`.

### Added

- Added a local Topic Analysis action that preclassifies high-confidence candidate link pairs from node titles, summaries, tags, node distance, and existing links.
- Added review-first topic candidates to the existing link suggestion panel, so users can accept, reject, or edit candidates before the graph changes.
- Added sanitized task-log support and localized English/Chinese status copy for topic analysis runs.
- Added unit coverage for candidate scoring, adjacent/existing-link filtering, candidate caps, task-log support, and localized UI wiring.
- Added `CONTEXT.md` glossary entries for Topic Analysis, Candidate Link Pair, and API Refine to prevent future scope drift.
- Added regression coverage for suggestion-panel overflow, link-suggestion progress status, and ChatGPT deep-research-style jump fallback.

### Changed

- Updated package and extension metadata to `0.6.0`.
- Documented 0.6.0 as lightweight local topic analysis rather than provider embeddings or offline model embeddings.
- Improved the link suggestion review panel so long candidate lists scroll inside the panel instead of being clipped.
- Improved Suggest Links status updates so the status bar shows request, waiting, filtering, and review-ready phases.
- Improved accepted-link behavior so suggestions become user-confirmed graph links immediately and bulk accept applies them in one batch.
- Improved ChatGPT jump fallback for deep-research-style folded replies by allowing user-message anchors to locate a turn only when they can be mapped back to the target turn index.

### Security

- Topic Analysis runs locally and does not send node text, raw vectors, or provider responses to an external API.

## [0.5.1] - AI Translation Language Packs

### Added

- Added standard JSON language packs with metadata for AI-generated and community-shared UI translations.
- Added language code input, language pack import, and current custom language export in Settings.
- Added validation for language pack schema, built-in language protection, placeholder preservation, missing-key reporting, and English fallback.
- Added one automatic JSON repair request when AI translation returns malformed JSON, preventing common `Model did not return valid JSON` failures from ending the flow.
- Added `sourceAnchors` persistence for custom note nodes so AI-note summaries can trace back to original source turns across saves and JSON import/export.

### Changed

- AI UI translation now generates a full TurnMap language pack instead of a raw key-value overlay.
- Imported or AI-generated language packs can be selected from the language dropdown and remain stored locally.
- Settings controls now use tighter wrapping/min-width safeguards so longer translated labels are less likely to overflow compact controls.
- AI summary now protects user-edited turn titles and summaries, only filling fields that are still blank or default.
- Custom note nodes tagged `#AI` can now run manual AI summary from their tracked source turns, while notes without source anchors fail with a clear status instead of overwriting arbitrary text.
- AI summary and manual node text edits continue to preserve jump accuracy because jump resolution still uses stored source anchors instead of node display copy.

## [0.5.0] - Provider Compatibility

### Added

- Added provider metadata and Settings presets for OpenAI, DeepSeek, OpenRouter, Qwen / DashScope, Kimi / Moonshot, Doubao / Volcano Ark, Zhipu / GLM, Mistral, Gemini compatible, and Custom OpenAI-compatible endpoints.
- Added cost-aware default models that favor fast responses and large context windows, including `gpt-5.4-nano`, `deepseek-v4-flash`, `qwen/qwen3.5-flash-02-23`, `qwen3.5-flash`, `kimi-k2.6`, `doubao-seed-1-6-flash-250828`, `glm-4.7-flash`, `mistral-small-2603`, and `gemini-2.5-flash-lite` as the Gemini-compatible suggestion.
- Added provider-specific UI notes explaining raw API key input, endpoint-ID style model fields, Gemini-compatible OAuth/project-path requirements, and preset availability limits.
- Added unit coverage for provider metadata, provider switching, JSON-mode gating, empty-response retries, reasoning-only responses, sanitized task logs, and redacted debug reports.

### Changed

- Provider requests now build URLs from provider metadata with `stripTrailingSlash(baseUrl) + chatPath`.
- TurnMap sends `response_format` only for providers marked as JSON-mode compatible and keeps the fallback retry when JSON mode is rejected.
- Switching provider now clears the API key while preserving `maxTokens` and auto-summarize preferences.
- Raised task-level output budgets to 1200 for summaries, 2400 for suggested links, and 6000 for AI UI translations while keeping the configurable maximum at 12000.
- Updated README, Chinese README, AI Provider Guide, privacy, permissions, and package metadata for the 0.5.0 provider compatibility release.

### Security

- Task logs and debug reports now redact key-like values while preserving non-secret diagnostics such as provider id, host, model, and error category.

## [0.4.0] - Multi-Site AI Conversation Adapters

### Added

- Added a ConversationAdapter boundary for site detection, extraction refresh, deep scan, jump-to-turn, observer updates, and turn-message creation.
- Added ChatGPT as the first adapter while preserving the existing ChatGPT extraction and jump behavior.
- Added fully supported web conversation adapters for DeepSeek, Kimi, Doubao, Qwen, Gemini, Google AI Studio, Claude.ai, Perplexity, Grok, GLM / Z.ai / Zhipu Qingyan, Mistral Le Chat, and Arena / LMArena.
- Marked all 0.4.0 supported web conversation adapters as fully supported, including both `chatglm.cn` and `chat.z.ai` for GLM / Z.ai.
- Added Google AI Studio URL detection, manifest injection, and DOM-first prompt/model extraction coverage, with collapsed Thoughts / Thinking UI excluded from captured answers.
- Added unit coverage for adapter ordering, URL detection, and generic user-assistant turn pairing.

### Changed

- Routed content-script refresh, deep scan, observer, Float navigation, and jump commands through the active adapter.
- Updated app status text and Debug Report output so the UI can describe supported AI conversation sites instead of assuming ChatGPT everywhere.
- Expanded extension host permissions, content-script matches, and launcher icon access for the supported 0.4.0 web AI sites.

## [0.3.0] - Knowledge Organization

### Added

- Added a Collapse Topic bulk action that turns selected turns into one editable topic note while hiding the original nodes.
- Added unit coverage for topic-collapse behavior.
- Added OPML export from the Files menu, preserving node summaries, statuses, tags, source turns, and relationship metadata.
- Added Obsidian vault Markdown export from the Files menu as a zip bundle with `index.md` and per-node notes.
- Added unit coverage for OPML and Obsidian vault Markdown export formatting.

### Changed

- Enhanced Obsidian Canvas export with turn numbers, statuses, tags, relationship labels, confidence, importance, and relationship reasons.
- Documented XMind export as feasible via a dependency-free `.xmind` zip package, with Anki CSV remaining a later candidate.
- Kept strong-link and batch-link workflows as the default organization path, with manual editing available as a fallback.
- Localized node and link editing panels so built-in and AI-generated UI translations cover graph-editing controls.
- Changed node interaction so left-click selects, Ctrl/Shift-click supports multi-select, text double-click edits, and text right-click jumps to the source turn.
- Added link right-click endpoint highlighting while preserving left-click link selection.
- Added API task progress logging for summaries, link suggestions, provider tests, and AI UI translation generation.
- Added persistent node color, fold, and importance states with an eight-color palette shared by relationship types.
- Simplified Node Actions by removing split, duplicate-note, open, and review controls from the panel.

## [0.1.0] - GitHub Preview

### Added

- Edge side panel for ChatGPT conversation mapping.
- Full Page view and Float view.
- Turn-based map with click-to-jump navigation.
- Full conversation extraction through ChatGPT API, structured data, web storage, DOM, and deep-scan fallbacks.
- Editable nodes, notes, tags, statuses, hidden nodes, root/header edits, and relationship links.
- Layouts: Single-side, Radial, Matrix, and Two-sided.
- AI summaries and AI semantic link suggestions.
- OpenAI, DeepSeek, and custom OpenAI-compatible provider settings.
- Dedicated Settings Page for AI, interface, Float, launcher, and update preferences.
- ChatGPT Floating Launcher with left-click open, right-click settings, drag, and saved position.
- TurnMap JSON import/export.
- Obsidian Canvas, Markdown, SVG, and PNG export.
- Lightweight in-app SVG icon system for the side panel and graph toolbar.
- Icon-enhanced header, view menu, layout picker, graph actions, and file menu.
- Theme switcher in Settings with Day, Night, and Eye-care themes.
- Follow browser theme option that resolves to Day or Night from `prefers-color-scheme`.
- Built-in UI language switching for English and Chinese, with Follow browser language detection.
- AI-assisted custom UI translation generation for additional languages, saved locally as reusable language options.
- GitHub README preview screenshot and Chinese social launch copy.

### Changed

- Refined the main header into a clearer app brand block while preserving the light technology style.
- Improved toolbar scanability with consistent icon + label controls and responsive wrapping for narrow side panels.
- Kept Day as the default `0.1.2` theme and persist user theme selection locally.
- Kept language and custom translation text local in extension storage.
- Updated core app chrome, toolbar, Settings, AI settings, layout labels, and relationship labels to use localized UI text.
- Raised the View menu stacking layer so it appears above the graph toolbar.
- Restyled React Flow controls and MiniMap with theme-aware colors so Night mode controls remain visible.
- Updated README roadmap with future multi-AI-site, multi-browser, and broader API provider compatibility plans.
- Restored the Chinese README as readable UTF-8 documentation.
- Hardened AI summary parsing so labeled English or Chinese title/summary text can be recovered when a provider returns readable text instead of strict JSON.
- Made AI link suggestion parsing tolerate plain-text provider replies by returning no suggestions instead of interrupting the existing graph.
- Added a minimal unit-test script for AI JSON parsing fallbacks.
- Added a Debug Report export from the Debug panel with redacted conversation diagnostics for issue reports.

### Known Issues

- Identical repeated prompts can reduce jump precision.
- ChatGPT DOM or backend changes can affect extraction.
- GitHub/unpacked installs require manual updates.
- Store publication requires additional icon and listing assets.

## [0.1.1-local-preview] - Light Tech UI Preview

### Changed

- Restyled the side panel, full page map UI, graph nodes, toolbar, menus, panels, settings page, floating navigator, and launcher with a brighter minimal technology aesthetic.
- Shifted the visual system from warm beige surfaces to cool white, pale blue, cyan, and teal design tokens.
- Improved focus states, hover states, surface hierarchy, and reduced visual noise while keeping existing interactions unchanged.

## [0.8.0] - Early Preview

### Added

- Release packaging script.

### Version Mapping

- Former local `0.1.0` preview archive is retained as `0.8.0`.
- Former local `0.1.1` UI preview archive used the temporary package label `0.9.0`; that historical label is superseded by the current `0.9.0` release entry above.
- Former local `0.1.2` work is now the GitHub preview release `0.1.0`.
