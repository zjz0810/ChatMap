# ChatGPT Native Navigation Reference Evidence

- Site: ChatGPT
- Evidence date: 2026-07-11
- Capability tier: verified native reference
- Source build: TurnMap 0.8.2 / 0.8.3 clean-room ChatGPT route

## Evidence retained by the repository

- `tests/chatgpt-ophel-navigation.test.mjs` covers stable native user identities, repeated prompts, native TOC activation matching, and hidden prompt labels.
- `tests/conversation-adapters.test.mjs` covers the non-scrolling ChatGPT refresh path, direct target reveal, removal of the legacy lazy-scroll jump path, incremental floating-list behavior, and conversation-cache reset.
- `docs/turnmap-multisite-native-navigation-handoff.md` records the browser-verified ChatGPT behavior used as the migration reference: complete user-question outline without deliberate full-conversation scrolling, native identity for repeats, direct jump, and bounded shell remount waits.

## Fresh 2026-07-12 browser rerun

- The unpacked build loaded in a clean Chromium profile and injected exactly one launcher.
- The public page stopped at Cloudflare verification, so the prior authenticated long-conversation evidence could not be repeated in this environment.
- This access block does not promote or demote another site. ChatGPT remains the inherited verified-native reference, while a fresh authenticated rerun remains a release limitation.

Evidence: `screenshots/chatgpt-auth-baseline.png`, `screenshots/chatgpt-extension-baseline.png`.

## Redaction and limitation

The retained evidence contains no conversation text, account identifier, or conversation URL. Assistant text remains best-effort when ChatGPT does not expose it cheaply. A fresh authenticated long-conversation rerun is still required before a store/public native-support claim is expanded.
