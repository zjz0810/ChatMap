# TurnMap Final Acceptance Checklist

Use this checklist before handing a build to testers.

Latest QA record: `docs/qa-run-2026-05-25.md`.

## Build And Package

- [x] `npm.cmd run typecheck` passes.
- [x] `npm.cmd run build` passes.
- [x] `npm.cmd run package` creates `release/turnmap-v0.6.0.zip`.
- [x] `dist/manifest.json` contains the expected permissions and host permissions.

## Edge Loading

- [x] Load `<project-root>\dist` from `edge://extensions`.
- [x] TurnMap side panel opens from a ChatGPT conversation.
- [x] TurnMap Settings opens from the main UI and browser extension options.
- [x] ChatGPT Floating Launcher appears on ChatGPT pages when enabled.
- [x] Launcher left-click opens TurnMap; launcher right-click opens Settings.
- [x] Launcher drag position persists after page refresh.
- [x] Refresh maps the full conversation when opened near the top, middle, and bottom.
- [x] New ChatGPT turns appear in TurnMap without manual page scrolling.

## Navigation

- [x] Clicking a recent node jumps to the matching ChatGPT turn.
- [x] Clicking an older node jumps after deep-scan extraction.
- [x] Clicking several different nodes does not produce repeated upward drift.
- [x] Clicking nodes around deep-research-style folded replies can fall back to mapped user-message anchors instead of failing while the answer is still collapsed.
- [x] Jump failures show a visible status instead of silently doing nothing.

## Graph Editing

- [x] Node title and summary edits persist after side panel reopen.
- [x] Root/header node can be edited or hidden.
- [x] Automatic edges can be edited or deleted.
- [x] User-created edges persist after refresh.
- [x] Undo and redo restore graph changes.

## Layouts

- [x] First launch uses Single-side.
- [x] User can switch to Radial, Matrix, and Two-sided.
- [x] Default layout preference persists.
- [x] Matrix layout has no root/header node or automatic root edges.

## AI

- [x] OpenAI connection test works with a valid key.
- [x] DeepSeek connection test works with a valid key.
- [x] Custom compatible endpoint requests host permission when needed.
- [x] AI summary does not overwrite a user-edited summary without user action.
- [x] AI link suggestions can be accepted, rejected, edited, and cleared.
- [x] Local Analyze Topics produces reviewable candidate links without sending text to an AI provider.
- [x] Long candidate lists remain scrollable in the link suggestion panel.

## Import And Export

- [x] TurnMap JSON export restores the same graph through import.
- [x] Obsidian Canvas export opens as an editable canvas in Obsidian.
- [x] Markdown export and copy include nodes and links.
- [x] SVG and PNG export produce non-empty visual maps without text overflowing node cards.

## Privacy And UX

- [x] AI settings disclose that selected text may be sent to external providers.
- [x] Required permissions and optional host permissions are documented in the permission review.
- [x] Global AI, interface, launcher, Float, and update preferences live in Settings.
- [x] Files menu groups import/export/reset actions.
- [x] Floating panel can be enabled, collapsed, opened, and disabled.
- [x] Full-page mode keeps jump navigation tied to the original ChatGPT tab.
