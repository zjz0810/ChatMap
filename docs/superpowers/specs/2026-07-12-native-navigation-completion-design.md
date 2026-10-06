# TurnMap Native Navigation Completion Design

## Goal

Complete the work left after 0.8.3: evidence-backed browser QA for every built-in site, site-native providers where real evidence supports them, removal of inactive legacy scroll/search routes, a safe selector-only custom-site flow, truthful documentation, and a verified local release candidate.

## Release boundary

The implementation target is 0.8.4. A built-in site is promoted from `mounted-dom` only when a real long conversation proves full non-scrolling user indexing, exact repeated-prompt identity, distant direct jump, safe failure, conversation cache isolation, and any available bounded shell revival. Missing authentication or missing native page data remains visible as an evidence gap; it is never replaced by a support claim.

## Architecture

### 1. Evidence registry

Add a versioned capability/evidence registry for all thirteen built-in sites. The registry records declared capability tier, evidence date, fixture/report references, and limitations. Adapter capability metadata and README tables derive from this source so marketing cannot drift ahead of evidence.

### 2. Native provider boundary

Keep ChatGPT's provider unchanged. Add a shared provider interface for site-specific native index, exact target resolution, optional shell revival, and explicit failure details. Built-in adapters without verified native evidence remain on the non-scrolling mounted-DOM provider. No provider may call the removed scrolling harvest or text-similarity jump code.

### 3. Legacy route removal

Delete inactive generic long-scroll harvesting and SourceAnchor search functions after tests prove no active consumer. Replace the Side Panel `Deep Scan` command with capability-aware `Refresh Index`: ChatGPT and verified providers refresh their full native index; mounted-DOM providers refresh mounted turns and state that limitation. Remove reading/jump controls that only tuned the retired paths while retaining migration-safe reads of old stored values.

### 4. Custom sites

Custom profiles are local, declarative, and separate from graph JSON. Each profile contains a generated id, display name, exact `http`/`https` origin pattern, page path pattern, conversation root, user selector, assistant selector, optional title selector, optional scroll-container selector, and a bounded ordered list of message-id attributes.

Validation rejects built-in origins, wildcard hosts, credentials, fragments, selectors longer than 500 characters, `:has()`, pseudo-elements, universal-only selectors, and invalid CSS. Profiles never contain JavaScript, URLs for scripts, request templates, or executable expressions.

Saving a valid profile stores it locally even if optional host permission is denied, but marks it disabled with an actionable reason. Validation preview uses a fixed content-script message against the active page and returns counts plus short text samples. Enabling requires exact-origin permission and a successful preview. Import/export uses a dedicated `turnmap-custom-sites.json` schema and cannot overwrite built-in adapters.

### 5. Browser QA

Use a persistent browser session and the packaged unpacked extension. For each built-in site, record authentication state, conversation URL, turn count, index source, repeated-prompt behavior, distant-jump result, incremental update behavior, cache isolation, console errors, screenshots, and evidence tier. Reports live under `docs/qa/native-navigation/`; sensitive text and identifiers are redacted.

## Failure behavior

- Missing optional permission: profile saved disabled; no injection attempted.
- Invalid selector: preview returns the exact field and a safe error.
- No matching turns: preview remains non-destructive and profile cannot be enabled.
- Unmounted target without native route: explicit failure; no text or neighboring-turn fallback.
- Browser authentication unavailable: QA report records `blocked-auth`, and the site cannot be promoted.

## Completion evidence

- Unit tests cover profile validation, storage, import/export, permission state, adapter selection, preview messages, evidence-registry consistency, and absence of retired functions.
- Browser QA reports exist for all thirteen built-in sites, even when a report records an authentication blocker.
- `npm.cmd run test:unit`, `npm.cmd run typecheck`, `npm.cmd run build`, and `npm.cmd run package` pass.
- The archive manifest version and file list are inspected.
- Changelog, README files, permissions/privacy docs, and capability tables match the evidence registry.

