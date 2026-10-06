# TurnMap 0.1.0 Release Notes

## Scope

TurnMap 0.1.0 is the first GitHub preview release for the Edge extension. It includes the latest current-conversation mapping, reliable conversation extraction, editable graph workflows, AI-assisted summaries and links, theme/language settings, and export/import recovery.

## Included

- Edge side panel for ChatGPT conversations.
- Full-page graph mode linked back to the source ChatGPT tab.
- Floating in-page navigator for quick turn access.
- Full conversation extraction through API, stored data, and DOM/deep-scan fallbacks.
- Turn-based graph with Single-side, Radial, Matrix, and Two-sided layouts.
- Editable nodes, notes, root/header node, user edges, and automatic edges.
- Undo/redo for graph changes.
- Tags, statuses, merge, split, duplicate as note, hide, and reset workflows.
- Search and node focus.
- AI summaries and AI link suggestions with OpenAI, DeepSeek, and compatible custom endpoints.
- Dedicated Settings Page for AI, interface, Float, launcher, and update preferences.
- ChatGPT Floating Launcher on ChatGPT pages. Left-click opens TurnMap; right-click opens settings.
- JSON import/export, Obsidian Canvas export, Markdown export/copy, SVG export, and PNG export.
- Local graph-state persistence per current conversation.
- Light Day theme by default, plus Night, Eye-care, and Follow browser theme modes.
- Built-in English and Chinese UI, Follow browser language mode, and locally stored AI-generated custom UI translations.
- Theme-aware React Flow controls and MiniMap for readable dark mode.

## Planned Before Public Release

- Store listing materials and update-notice wiring.

## Known Risks

- Identical repeated prompts can still reduce jump precision in some conversations.
- Real ChatGPT DOM and backend behavior can change without warning, so extraction fallbacks should be checked periodically.
- Store submission may require PNG extension icons even though the local build accepts the SVG placeholder.
- Custom AI providers depend on their OpenAI-compatible response format and CORS/host permissions.

## Version Mapping Note

Earlier local preview archives were renumbered before GitHub publication:

- Former local `0.1.0` -> `0.8.0`
- Former local `0.1.1` -> `0.9.0`
- Former local `0.1.2` -> current GitHub preview `0.1.0`

## Package Command

Run:

```powershell
npm.cmd run package
```

Output:

```text
release/turnmap-v0.1.0.zip
release/README.txt
```
