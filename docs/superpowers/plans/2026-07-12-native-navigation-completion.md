# TurnMap Native Navigation Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. The user explicitly prohibited subagents for this work.

**Goal:** Finish the evidence-backed native navigation migration, retire pre-0.8.0 routes, add safe custom sites, and produce a verified 0.8.4 local release candidate.

**Architecture:** A single evidence registry drives adapter capability declarations and docs. Site-native providers plug into a strict index/resolve/revive contract, while unverified sites remain mounted-DOM only. Custom sites use validated declarative profiles, exact-origin optional permissions, fixed preview messaging, and separate local backup files.

**Tech Stack:** TypeScript, React, Chrome MV3, Node test runner, Vite, agent-browser.

---

### Task 1: Evidence registry and QA harness

**Files:**
- Create: `src/content/native-capability-registry.ts`
- Create: `tests/native-capability-registry.test.mjs`
- Create: `docs/qa/native-navigation/README.md`
- Create: `docs/qa/native-navigation/site-evidence.json`

- [x] Write failing tests that require exactly thirteen unique built-in records and prohibit verified tiers without evidence references.
- [x] Run the tests and confirm the registry is missing.
- [x] Implement the registry and JSON evidence schema.
- [x] Run focused tests to green.
- [x] Inventory real browser authentication and create one redacted report per site.

### Task 2: Native provider contract

**Files:**
- Modify: `src/content/native-web-navigation.ts`
- Modify: `src/content/conversation-adapters.ts`
- Test: `tests/native-web-navigation.test.mjs`

- [x] Write failing tests for exact-identity provider resolution, explicit unmounted failures, and capability/evidence consistency.
- [x] Use `native-web-navigation.ts` as the shared mounted-DOM provider contract and preserve the separate ChatGPT native provider without behavioral regression.
- [x] Keep unproven sites below native; record Qwen/Gemini/GLM mounted-DOM smoke evidence without promotion.
- [x] Run focused adapter tests; full-suite verification remains in Task 7.

### Task 3: Retire legacy scrolling/search

**Files:**
- Modify: `src/content/web-adapter-core.ts`
- Delete: `src/content/smart-scroll-harvest.ts`
- Keep: `src/content/scroll-container.ts` for bounded direct ChatGPT reveal only; it is not an extraction/search route.
- Modify: `src/side-panel/App.tsx`
- Modify: `src/settings-page/main.tsx`
- Modify: `src/side-panel/i18n/i18n-storage.ts`
- Modify: `tests/conversation-adapters.test.mjs`
- Modify: `tests/reading-settings.test.mjs`

- [x] Write failing source-boundary tests that prohibit smart harvest, directional search, and retired UI copy.
- [x] Delete inactive scrolling and SourceAnchor-search functions and imports.
- [x] Replace Deep Scan with capability-aware Refresh Index behavior and copy.
- [x] Remove obsolete settings UI/code; historical storage keys are ignored rather than reused.
- [x] Run focused unit and type checks.

### Task 4: Custom profile model and backup

**Files:**
- Create: `src/shared/custom-site-profiles.ts`
- Create: `tests/custom-site-profiles.test.mjs`

- [x] Write failing tests for exact-origin validation, selector safety, built-in-origin protection, normalization, enabled/disabled state, and separate import/export.
- [x] Implement schema version 1, validation, storage, and deterministic merge/replace import.
- [x] Run focused tests to green.

### Task 5: Custom adapter and preview bridge

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/messaging.ts`
- Modify: `src/content/index.ts`
- Modify: `src/content/conversation-adapters.ts`
- Create: `src/content/custom-site-adapter.ts`
- Test: `tests/custom-site-adapter.test.mjs`

- [x] Write failing tests for asynchronous custom adapter selection and fixed preview messages.
- [x] Implement custom profile loading, exact-origin matching, non-scrolling extraction, identity-first mounted jump, and actionable preview results.
- [x] Ensure built-in adapters always win and disabled profiles never activate.
- [x] Run focused messaging/adapter tests; full-suite verification remains in Task 7.

### Task 6: Settings UI and permissions

**Files:**
- Create: `src/settings-page/CustomSitesSettingsPanel.tsx`
- Modify: `src/settings-page/main.tsx`
- Modify: `src/settings-page/settings-page.css`
- Modify: `src/side-panel/i18n/i18n-storage.ts`
- Test: `tests/custom-site-settings.test.mjs`

- [x] Write failing UI/source tests for add, edit, permission request, preview, disabled reason, delete, import, and export controls.
- [x] Implement the panel with fixed validation flow and exact-origin permission requests.
- [x] Add bilingual copy and theme-safe styles.
- [x] Run focused tests and build, including a real settings-page browser smoke test.

### Task 7: Documentation and release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/permissions-review.md`
- Modify: `docs/privacy-statement.md`
- Modify: `docs/user-guide.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `public/manifest.json`
- Modify: `src/manifest.ts`

- [x] Align capability tables with the evidence registry and document blocked/unverified sites honestly.
- [x] Document custom-site setup, optional permissions, local storage, backup, and limitations.
- [x] Update changelog continuously and bump all metadata to 0.8.4 after implementation is stable.
- [x] Run full tests, typecheck, build, and package.
- [x] Inspect the ZIP manifest and contents, create the local commit, and preserve the release artifact.
