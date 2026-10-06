# TurnMap Developer Guide

## Stack

- React
- TypeScript
- Vite
- React Flow
- Edge / Chromium MV3 extension APIs

## Project Layout

- `src/content`: ChatGPT page extraction, jumping, Float, and planned launcher integration.
- `src/side-panel`: main TurnMap UI.
- `src/full-page`: full-page entrypoint.
- `src/background`: service worker and API forwarding.
- `src/shared`: shared message and type definitions.
- `scripts`: build and packaging helpers.
- `docs`: user, developer, release, and planning documentation.

## Commands

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package
```

## Storage

Graph state is stored per conversation in `chrome.storage.local` using keys like:

```text
turnmap.graph.<conversationId>
```

Raw extracted turns are cached in IndexedDB.

AI settings are stored in `chrome.storage.local`:

```text
turnmap.aiSettings
```

## Settings Page

The Settings Page owns global settings:

- AI provider
- Base URL
- Model
- API key
- Auto summarize
- Default layout
- Float defaults
- Update preferences

The main map UI should keep high-frequency actions only.

## Floating Launcher

The content script injects a TurnMap launcher on ChatGPT pages. It should:

- Avoid existing ChatGPT floating UI.
- Persist disabled or moved state.
- Left-click to open TurnMap.
- Right-click to open settings.

## Release Checklist

Before release:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package
```

Then follow `docs/github-release-plan.html`.
