# TurnMap 0.6.0 Release Notes

## Scope

TurnMap 0.6.0 is the Topic Analysis MVP release. It is a local, review-first organization upgrade built on top of the previous GitHub baseline, `5727ebe Improve rebuild and export fidelity`.

This release does not add provider embeddings, local embedding models, or automatic topic-node creation. The implemented 0.6.0 path is intentionally smaller: local rule-weighted preclassification produces a few high-confidence candidate links, then the user reviews them before the graph changes.

## Changes Since The Previous GitHub Push

Compared with the previous pushed commit `5727ebe`, this release adds:

- Local Analyze Topics action for candidate link preclassification from titles, summaries, tags, node distance, proper-noun-like terms, and existing links.
- Review-first candidate links in the existing suggestion panel, with accept, reject, edit, clear, and bulk accept workflows.
- Scrollable suggestion-panel layout so long candidate lists remain reviewable instead of being clipped.
- More visible Suggest Links progress in the status bar: request, waiting, filtering, and review-ready phases.
- User-confirmed accepted suggestions, so accepted links become ordinary graph links immediately.
- Conservative ChatGPT jump fallback for deep-research-style folded replies. TurnMap can use mapped user-message anchors when the assistant answer is not yet expanded, while avoiding unmapped duplicate prompts.
- AI summary hardening with source anchors, protected user edits, and `#AI` note summaries from tracked source turns.
- Provider compatibility updates for OpenAI-compatible services, provider presets, output-token handling, JSON-mode gating, and sanitized provider diagnostics.
- AI-generated UI language pack import/export, schema validation, placeholder checks, and JSON repair.
- Updated permissions, privacy, user guide, QA plan, release readiness, changelog, English README, and Chinese README.

## Privacy And Cost

- Analyze Topics runs locally and does not call `/embeddings` or `/chat/completions`.
- Local topic analysis does not create or export raw vectors.
- Existing AI features still use the configured provider only when the user triggers them or enables auto summarize.
- Task logs and debug reports keep useful diagnostics while redacting API keys and raw conversation content.

## Verification

Local verification for this release candidate:

```powershell
npm.cmd run test:unit
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package
```

Latest QA record:

```text
docs/qa-run-2026-05-25.md
```

## Package

The local package command produces:

```text
release/turnmap-v0.6.0.zip
```

Because `release/` is ignored, the zip is not stored in git. It should be attached manually to the GitHub Release if GitHub CLI or web upload is available.

## Known Risks

- Very long or heavily virtualized pages can still require enough nearby user markers to be loaded before TurnMap can map a target jump safely.
- Identical repeated prompts remain ambiguous when the page cannot expose enough source-anchor evidence; TurnMap should prefer a clear failure over jumping to an unmapped duplicate.
- Provider embeddings and API refine are deferred until the local review-first 0.6.0 flow has been validated in real conversations.
