# Multi-Site Identity-First Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. The user explicitly prohibited subagents for this run.

**Goal:** Move all twelve non-ChatGPT built-in adapters onto the 0.8.x identity-first, non-scrolling extraction and direct-jump path while preserving honest capability tiers.

**Architecture:** Add a shared native-web navigation provider that decorates extracted turns with site-scoped navigation identities, merges by identity, and resolves only exact mounted targets. Wire every web adapter through it, publish capability metadata, and remove legacy scrolling/search calls from active adapter routes.

**Tech Stack:** TypeScript, Chrome MV3 content scripts, Node test runner, Vite.

---

### Task 1: Define failing contract tests

**Files:**
- Modify: `tests/conversation-adapters.test.mjs`
- Create: `tests/native-web-navigation.test.mjs`

- [ ] Assert all 13 adapters publish capability metadata.
- [ ] Assert non-ChatGPT adapter wiring contains no calls to scrolling harvest or source-anchor scroll jumping.
- [ ] Assert repeated prompt text remains distinct when navigation identities differ.
- [ ] Assert exact identity resolution never uses text similarity.
- [ ] Run the focused tests and confirm they fail because the provider and contract do not exist.

### Task 2: Implement the shared provider and contract

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/content/native-web-navigation.ts`
- Modify: `src/content/web-adapter-core.ts`

- [ ] Generalize `TurnNavigation.site` and add identity-source metadata.
- [ ] Add capability-status types to the adapter contract.
- [ ] Implement site-scoped navigation decoration and identity-first merging.
- [ ] Export exact element reveal support and implement exact mounted-target resolution.
- [ ] Run focused tests until green, then run existing navigation regressions.

### Task 3: Migrate all built-in web adapters

**Files:**
- Modify: `src/content/conversation-adapters.ts`
- Modify: `src/content/index.ts`

- [ ] Attach the shared provider to all twelve web profiles.
- [ ] Make refresh, complete refresh, and Deep Scan non-scrolling.
- [ ] Route jumps through exact navigation identity only.
- [ ] Reset local turn cache when conversation ID changes.
- [ ] Enable the floating navigator for every active built-in adapter.
- [ ] Run focused and full unit tests.

### Task 4: Release metadata and documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `public/manifest.json`

- [ ] Add an explicit 13-row capability table in both READMEs.
- [ ] Document the clean-room reference and known limitations.
- [ ] Add the 0.8.3 changelog entry.
- [ ] Bump package and manifest metadata to 0.8.3.

### Task 5: Verify, package, and commit

**Files:**
- Inspect: `release/turnmap-v0.8.3.zip`

- [ ] Run `npm.cmd run test:unit`.
- [ ] Run `npm.cmd run typecheck`.
- [ ] Run `npm.cmd run build`.
- [ ] Run `npm.cmd run package`.
- [ ] Inspect the zip file list and version metadata.
- [ ] Review `git diff --check` and the final status.
- [ ] Create one local commit for the completed batch.
