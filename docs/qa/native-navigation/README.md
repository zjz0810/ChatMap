# Native Navigation QA Evidence

This directory stores redacted, site-by-site evidence for TurnMap's extraction and jump capability claims.

Promotion to `verified-native` requires a real long conversation and evidence for non-scrolling user indexing, repeated-prompt identity, distant direct jump, incremental updates, conversation isolation, safe failure, and bounded shell revival when the site exposes a native route.

`smoke-verified` means only that the mounted-DOM path passed the scenarios stated in that site's report. It is not native support. `blocked-auth`, `blocked-access`, and `not-run` are evidence states, not passing results. They must never be presented as verified support.

The 2026-07-12 run loaded the unpacked extension in Chrome for Testing, verified one launcher on all 13 built-in sites, and kept all prompts redacted to the fixed text `Reply exactly: TurnMap QA 1`. It did not bypass Cloudflare, accept Arena legal terms, or use a personal account.

The custom-site settings smoke test is retained in `screenshots/custom-sites-settings-baseline.png` and `screenshots/custom-sites-saved-disabled.png`; it verifies that an exact-origin selector profile is stored locally in the disabled `permission-required` state.
