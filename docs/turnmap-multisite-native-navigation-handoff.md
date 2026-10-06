# TurnMap Multi-Site Native Navigation Handoff

Date: 2026-07-11

## Implementation Outcome (2026-07-12)

This handoff has now been executed for the `0.8.4` local release candidate. The user's follow-up explicitly authorized direct implementation without additional requirements questions.

- All non-ChatGPT built-ins use identity-first mounted-DOM extraction and exact mounted-target resolution; the retired scroll harvest and directional text-search path are removed.
- `src/content/native-capability-registry.ts` and `docs/qa/native-navigation/` are the current capability/evidence sources of truth.
- ChatGPT remains the only verified native full-index/direct-jump route. Qwen and Gemini have repeated-turn mounted-DOM smoke evidence; GLM / Z.ai has one-turn mounted-DOM smoke evidence. Other sites retain documented auth/access boundaries.
- The visible Deep Scan action is now Refresh Index and never promises page scrolling.
- Custom sites are selector-only, local, exact-origin permission-gated, preview-gated, disabled on import/edit, and backed up separately from graph JSON.
- The 2026-07-12 browser run found and fixed streamed placeholder answers being frozen by both turn merging and persisted default node text.

The sections below preserve the original handoff rationale and acceptance boundary. Where they describe the 2026-07-11 repository state, they are historical rather than current.

## Objective For The Next Conversation

Extend the current ChatGPT-first extraction and direct-jump approach across every site currently declared as supported by TurnMap, then add a safe local custom-site integration path.

The target is not a cosmetic README update. A site must not be described as having ChatGPT-equivalent support until its extraction and jump capabilities have been verified on real long conversations.

## Required Process Before Implementation

This is a complex product and architecture change. The next agent must not start coding immediately.

1. Create one editable HTML product-requirements document.
2. Ask the user to settle the unresolved decisions in the `Decisions Required` section below.
3. Critique the completed document for over-constraints, missing failure states, privacy, permissions, migration, and testability.
4. After the user approves the total requirements, create separate editable HTML requirements documents for:
   - multi-site native extraction and navigation capabilities;
   - site adapter migration waves;
   - custom-site integration and permissions;
   - documentation, verification, and release.
5. Only then implement one module at a time inside its stated ownership boundary.

Do not write a large cross-site rewrite until this process is complete.

## Current Repository State

Repository: `D:\codex program\TurnMap`

Baseline release is `v0.8.2` at commit `0e55915`.

The current local branch is ahead of `origin/main` by two unpushed commits:

- `5addf27 Add ChatGPT floating navigator favorites`
- `e85afb0 Stabilize floating favorites tab switching`

The current local package is `release/turnmap-v0.8.2.zip`; for local browser QA load `dist/` as an unpacked extension.

Current verification passed before handoff:

```powershell
npm.cmd run test:unit   # 215 passing
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package
```

## Existing ChatGPT Reference Route

ChatGPT is the only intentionally native-first implementation today. Preserve it as the behavioral reference; do not regress it while generalizing.

Primary files:

- `src/content/chatgpt-observer.ts`: non-disruptive refresh, conversation-id cache reset, full-conversation sources, and observer lifecycle.
- `src/content/chatgpt-ophel-navigation.ts`: TurnMap's clean-room native user-query index, message/turn identity, native TOC matching, turn-shell revive, and bounded remount waits.
- `src/content/jump-controller.ts`: ChatGPT direct navigation resolver and reveal/highlight behavior.
- `src/content/conversation-api-extractor.ts`: ChatGPT backend conversation API path when available.
- `src/content/structured-extractor.ts`: structured browser data fallback.
- `src/content/index.ts`: content-script lifecycle, floating navigator, and jump message routing.
- `src/shared/types.ts`: `Turn`, `TurnNavigation`, `SourceAnchor`, and jump messages.

Important behavior:

- ChatGPT turn navigation is primarily driven by `TurnNavigation` with `kind: "ophel_notSourceAnchor"`, especially stable `navigationId`, `messageId`, `turnId`, native TOC position, and user-text hash.
- `SourceAnchor` still travels with a turn for compatibility and fallback contexts, but it is not the preferred ChatGPT route.
- ChatGPT must not return to the legacy virtual-scroll/lazy-scroll search as its normal jump path.
- The current implementation learns the complete user-question outline without deliberately scrolling the full conversation. Assistant text is best-effort when the page does not expose it cheaply.
- Repeated user questions are distinguished by native identity, not text or local viewport index.
- Empty turn shells are revived by a bounded native action/remount wait, not a blind long-distance scroll.
- The design is clean-room. ophel is a reference for product behavior and architecture only; do not copy GPL code.

Relevant regression tests:

- `tests/chatgpt-ophel-navigation.test.mjs`
- `tests/conversation-adapters.test.mjs`

## Declared Supported Sites: 13

The source of truth for the current product declaration is `src/content/adapter-registry.ts` and `README.zh-CN.md`.

1. ChatGPT
2. DeepSeek
3. Kimi
4. Doubao
5. Qwen
6. Gemini
7. Google AI Studio
8. Claude
9. Perplexity
10. Grok
11. GLM / Z.ai
12. Mistral Le Chat
13. Arena / LMArena

`README.md` currently says "and more". The documentation migration must replace broad marketing language with an explicit capability table and an honest status for every listed site.

## Current Adapter Architecture

- `src/content/adapter-registry.ts`: site id, display name, and host patterns.
- `src/content/conversation-adapters.ts`: ChatGPT adapter plus the generic web adapter profiles for the other sites.
- `src/content/web-adapter-core.ts`: role-aware DOM extraction, generic merging, conversation title/id, generic scrolling harvest, and generic source-anchor jump.
- `src/content/turn-extractor.ts`: DOM turn extraction and merge utilities.
- `src/content/jump-controller.ts`: ChatGPT-specific native navigation.
- `public/manifest.json` and `src/manifest.ts`: static host permissions and content-script matches.

The generic profiles currently have different DOM selectors and cleanup rules, but they do not have an equivalent native navigation capability model. Do not solve the next phase by copying ChatGPT selectors into every profile.

## Intended Product Direction

Create a capability-oriented adapter contract, then implement site-specific capability providers. A site may use different mechanisms for extraction and jump.

Suggested capability levels:

| Capability | Meaning |
| --- | --- |
| `native-user-index` | Read the full user-question outline from page-native data, sidebar, TOC, route payload, or structured state without deliberate long-distance scrolling. |
| `native-target-id` | Each indexed user question has a stable per-conversation navigation identity. |
| `direct-jump` | Resolve a target through native message IDs, TOC buttons, internal anchors, route state, or page APIs before any generic search. |
| `shell-revive` | A virtualized shell can be activated and remounted with a bounded wait, then re-resolved. |
| `assistant-best-effort` | Assistant text can be filled when cheaply available, without blocking the user-question outline. |
| `bounded-fallback` | A clearly labeled, site-specific fallback may run only after native resolution fails; it must never silently jump to a similar or nearby turn. |

Recommended shared contract direction:

```ts
type NativeConversationCapabilities = {
  readUserIndex?: () => Promise<Turn[]>;
  resolveTarget?: (target: TurnNavigation) => Promise<NativeResolveResult>;
  reviveTarget?: (target: TurnNavigation) => Promise<NativeResolveResult>;
  capabilityStatus: { /* per-site support and failure reasons */ };
};
```

This is a direction, not an approved API. Confirm the final contract in the requirements documents before coding.

## Custom Site Integration: Proposed Safety Boundary

The first custom-site feature should be local, declarative, and permission-gated.

Recommended v1 scope:

- Add a custom site from TurnMap Settings.
- Ask for the exact origin or a tightly scoped host pattern through Chromium optional host permissions.
- Let the user configure a declarative adapter profile: page URL match, conversation root, user selector, assistant selector, optional message/turn id attributes, title selector, and optional scroll container selector.
- Validate selectors against the current page and show an extraction preview before saving.
- Store the profile only in browser local storage; do not put it in TurnMap graph JSON by default.
- Permit local profile export/import as a separate custom-site configuration backup only if the user approves that requirement.
- Do not accept arbitrary JavaScript, remote scripts, injected user code, or unbounded CSS/DOM expressions.
- Label custom profiles as `DOM fallback` unless they explicitly declare and pass native identity/direct-jump validation.

Avoid promising a generic non-scrolling native index for arbitrary websites. A declarative profile can reliably support DOM extraction and a bounded direct DOM target lookup, but native TOC/API/state integration is site-specific.

## Decisions Required From The User

The next conversation must ask these before implementation:

1. Does "complete coverage" mean every one of the 13 sites must reach the same native-user-index and direct-jump level as ChatGPT, or should README show capability tiers while individual sites graduate after verification?
2. Is non-scrolling full user-question extraction mandatory for all 13 sites, with assistant text explicitly best-effort as on ChatGPT?
3. If a site has no native TOC, message id, route payload, or structured state, is a bounded generic fallback acceptable, or should the site remain marked `partial` rather than emulate a long scroll search?
4. What real-account QA access, test conversations, sanitized DOM snapshots, or screen recordings can the user provide for each service? Do not invent support claims without this evidence.
5. Is a custom site limited to DOM selectors in v1, or should it include an advanced structured-state/REST descriptor? The recommendation is selector-only v1.
6. Should custom-site profiles be exportable/importable separately from TurnMap JSON? The recommendation is yes, as a dedicated local configuration file, not graph data.
7. How should optional host-permission failure be represented: profile saved but disabled, or profile not saved until permission is granted?
8. What is the next version target and release policy? Do not silently reuse the existing published `0.8.2` prerelease for a large migration.

## Non-Negotiable Acceptance Criteria

For each of the 13 declared sites, do not mark native/direct support complete until all applicable criteria have evidence:

- Reads a long conversation's user-question index without intentional whole-page virtual-scroll traversal.
- New user questions appear incrementally without resetting the visible floating navigator scroll position.
- Repeated or highly similar questions never resolve by text similarity alone when a stronger identity is available.
- A direct jump moves to the correct target, including distant targets not currently mounted in the DOM.
- A virtualized target shell is revived with bounded waiting when the site offers a native route.
- When native resolution fails, the UI reports the reason and never jumps to a neighboring or merely similar turn.
- Conversation switching clears site-local turn caches and favorite/navigation state does not leak into the next conversation.
- Refresh, Refresh Index, floating navigation, side-panel node jump, and right-click jump remain functional.
- The adapter has unit tests plus real-browser evidence for its declared capability tier.

For custom sites:

- No arbitrary code execution is accepted from a profile.
- Host access is requested only through optional host permissions, with clear user consent.
- Invalid selectors fail safely and provide actionable validation output.
- A custom profile cannot overwrite a built-in adapter.
- The profile does not alter TurnMap graph JSON schema or browser-global preferences unexpectedly.

## Documentation Work

Update both `README.md` and `README.zh-CN.md` after verified implementation.

Required documentation changes:

- A 13-row supported-site table with site, extraction tier, jump tier, assistant-text status, and known limitations.
- Separate `verified native`, `verified DOM fallback`, and `custom profile` labels.
- An explanation that ChatGPT is the reference native implementation, not a GPL code import.
- Setup and permissions instructions for custom-site profiles.
- A clear statement that no site is elevated to native/direct status merely because ordinary DOM extraction works.

## Suggested Migration Waves

Do not treat this ordering as final. Confirm it after research and access checks.

1. Establish the shared capability contract and migrate ChatGPT without changing behavior.
2. Research and implement sites that expose reliable native message IDs, sidebars, TOCs, or structured conversation state.
3. Migrate the remaining built-in profiles in small batches with fixtures and browser QA.
4. Add the selector-only custom-site settings flow after built-in capability boundaries are stable.
5. Update docs, package, release notes, and publish only after the capability table is evidence-backed.

## Commands And Release Discipline

Use these before each commit or package as appropriate:

```powershell
npm.cmd run test:unit
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package
```

The user expects a local commit after each completed modification batch. Do not push, tag, or create a GitHub release unless explicitly requested.
