# TurnMap Release Readiness

## Local Load Instructions

1. Run `npm.cmd run build`.
2. Open Edge extensions: `edge://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select `<project-root>\dist`.
6. Open a ChatGPT conversation.
7. Click the TurnMap extension action to open the side panel.

## Package Instructions

Run:

```powershell
npm.cmd run package
```

The command builds the extension, validates the generated manifest, and creates:

- `<project-root>\release\turnmap-v0.6.0.zip`
- `<project-root>\release\README.txt`

## Permission Review

Required permissions:

- `activeTab`: identify and message the current ChatGPT tab.
- `tabs`: open full-page mode and route jumps back to the source tab.
- `scripting`: inject the content script if the side panel opens before the script is present.
- `sidePanel`: show TurnMap in Edge's side panel.
- `storage`: persist graph state, layout preferences, AI settings, and floating panel state.
- `webRequest`: capture replayable ChatGPT backend headers for full conversation extraction.

Host permissions:

- Supported AI conversation sites: read, map, and jump within the current conversation page.
- OpenAI-compatible provider hosts: run explicit AI summaries, AI link suggestions, provider tests, and AI UI translation.

Optional host permissions:

- `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`: custom OpenAI-compatible endpoints.

Detailed review: `docs/permissions-review.md`.

## Edge Add-ons Listing Draft

Name: TurnMap

Short description: Turn ChatGPT conversations into editable mind maps.

Long description:

TurnMap converts the current ChatGPT conversation into an editable visual map. Each question-answer turn becomes a node that can jump back to the original message. Users can organize long conversations with layouts, tags, statuses, manual links, AI link suggestions, AI summaries, full-page mode, a compact floating navigator, and multiple export formats.

Key features:

- Current-conversation mind map
- Click a node to jump back to the source AI conversation turn
- Side panel, full-page mode, and floating navigator
- Dedicated settings page
- ChatGPT page launcher
- Manual editing, node merge/split, note nodes, tags, and statuses
- AI summaries and AI link suggestions with OpenAI-compatible providers
- Local Analyze Topics for reviewable candidate links without provider embeddings
- Export to JSON, Markdown, Obsidian Canvas, SVG, and PNG
- Local-first storage

## Pre-Release Checklist

- Build succeeds.
- Side panel opens from a ChatGPT conversation.
- Full-page mode opens and keeps source-tab navigation.
- Floating panel can be enabled, collapsed, and disabled.
- Settings page opens and saves AI/interface/update preferences.
- ChatGPT launcher opens TurnMap with left click and settings with right click.
- Export files download successfully.
- AI settings clearly warn when text is sent to providers.
- Optional host permission prompt appears for custom AI endpoints.
