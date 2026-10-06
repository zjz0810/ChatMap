# Contributing to TurnMap

Thanks for helping improve TurnMap.

## Development Setup

```powershell
npm install
npm.cmd run dev
```

Use Edge developer mode to load `<project-root>\dist`.

## Verification

Before opening a pull request, run:

```powershell
npm.cmd run typecheck
npm.cmd run build
```

For release packaging:

```powershell
npm.cmd run package
```

## Pull Request Guidelines

- Keep changes focused.
- Do not commit `node_modules/`, `dist/`, `release/`, logs, screenshots, or local browser data.
- Do not commit API keys or provider credentials.
- Update documentation when user-facing behavior changes.
- Include manual QA notes for ChatGPT extraction, node jumping, storage, export/import, or AI provider changes.

## Areas That Need Care

- ChatGPT extraction is fragile because the page and backend can change.
- Node jumping must avoid page-scroll race conditions.
- AI provider support should remain OpenAI-compatible and fail with clear diagnostics.
- Settings Page, Floating Launcher, and Update Notice are planned pre-release work and should keep the main map UI clean.
