# Google AI Studio Browser QA

- Date: 2026-07-12
- Result: `blocked-auth`
- Page result: the unauthenticated request reached the public `/welcome` page, not an editable multi-turn prompt session.
- Extension result: exactly one TurnMap launcher was injected.
- Capability decision: keep mounted-DOM extraction and mounted-only exact jump. No project prompt history or long-conversation evidence was available.

Evidence: `screenshots/ai-studio-auth-baseline.png`, `screenshots/ai-studio-extension-baseline.png`.
