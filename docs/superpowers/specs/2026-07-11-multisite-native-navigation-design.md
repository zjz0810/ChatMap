# Multi-Site Identity-First Navigation Design

## Scope

TurnMap 0.8.3 extends the ChatGPT `ophel_notSourceAnchor` architecture to the other twelve built-in adapters without reviving pre-0.8.0 long-distance scroll extraction or text-search jumping. Custom-site profiles remain outside this batch because arbitrary sites cannot honestly provide a native full-conversation index through selectors alone.

## Capability model

Every adapter publishes extraction, target identity, jump, shell-revive, and assistant-text capability levels. ChatGPT remains the verified reference with a full native user index and bounded remount route. The other built-in sites use a shared mounted-DOM identity provider until real native TOC, route-state, or API fixtures are available.

The shared provider:

- reads currently mounted role-aware turns without deliberately scrolling;
- attaches `ophel_notSourceAnchor` navigation identities scoped by site;
- preserves repeated prompts by navigation identity rather than text hash;
- resolves only an exact mounted identity and never falls back to similar text, viewport index, or neighboring turns;
- reports an explicit failure when the target is not mounted;
- treats assistant text as best-effort.

## Adapter lifecycle

Refresh, complete refresh, and the legacy Deep Scan entry point all call the same non-scrolling identity-first refresh for non-ChatGPT adapters. The UI can retain its existing command surface, but the adapter implementation must not invoke `smartHarvestByScrolling` or `scrollToWebTurn`.

Conversation changes replace the adapter-local cache before merging new observations. Within one conversation, navigation identity is the primary merge key. This prevents identical user prompts from collapsing into one turn.

## Documentation truth boundary

The README capability table distinguishes ChatGPT's verified native route from the other sites' identity-first mounted-DOM fallback. No non-ChatGPT site is described as full native/direct until real long-conversation browser evidence exists.

## Verification

Unit tests cover capability declarations, repeated-prompt preservation, site-scoped navigation IDs, exact-identity resolution, absence of legacy scroll calls in adapter wiring, and floating-navigator availability. The release gate is the full unit suite, TypeScript check, production build, package command, and archive inspection.
