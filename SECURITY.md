# Security Policy

## Supported Versions

TurnMap is currently in early preview. Security fixes target the latest `main` branch and the latest GitHub Release.

## Reporting a Vulnerability

Please do not open a public issue for sensitive security reports.

Until a dedicated security contact is configured, create a private report through GitHub's security advisory flow if available, or contact the repository owner privately.

## Sensitive Data

Do not commit:

- API keys
- ChatGPT session data
- Exported private conversations
- Browser profile data
- Screenshots containing private conversations

TurnMap stores AI provider settings, including API keys, in `chrome.storage.local` inside the user's browser extension profile. These values are local to the user's browser and are not part of the repository.

## Extension Permissions

TurnMap uses permissions for:

- Reading the active ChatGPT conversation.
- Opening Side Panel, Full Page, and Float views.
- Persisting graph and settings locally.
- Contacting user-configured AI providers.

Any permission expansion should include a documentation update and a brief justification in the pull request.
