# TurnMap User Guide

TurnMap turns the current conversation on a supported AI site into an editable map.

## Opening TurnMap

Current views:

- Side Panel: compact map beside the supported AI page.
- Full Page: larger map view connected to the source conversation tab.
- Float: compact in-page navigator on supported sites.
- Floating Launcher: right-side launcher on supported sites and validated custom sites.

Launcher behavior:

- Left-click opens TurnMap.
- Right-click opens TurnMap settings.
- Drag moves the launcher; the position is saved locally.

## Settings

TurnMap has a dedicated settings page for global settings:

- AI provider, model, API key, and auto summarize.
- Default layout.
- Normal-node link style: Curved by default, or Angled if you prefer elbow-like graph links. Mini nodes and their internal mini-map links are not affected.
- Float default state.
- ChatGPT launcher visibility.
- Update notice preferences.
- Selector-only custom-site profiles, exact-origin validation, and separate profile import/export.

## Refreshing A Conversation

Use Refresh to read the current conversation index. ChatGPT uses its verified native index route. Other built-in and custom adapters read only currently mounted turns. Refresh Index can insert missing mounted turns, but it does not scroll the page or search for matching text. An unmounted jump fails explicitly.

## Custom Sites

Open Settings > Custom Sites to add a site that is not built in:

1. Enter an exact `http` or `https` origin, a bounded path pattern, one conversation-root selector, user/assistant message selectors, and optional title/scroll-container selectors.
2. Save the profile. New and edited profiles remain disabled.
3. Open the matching site in the active tab and choose Validate & Enable. TurnMap requests only that exact origin and previews bounded message counts/samples.
4. If permission is denied, the page does not match, or preview fails, the profile stays disabled.

Custom sites never override built-in adapters, cannot run scripts, and use the same mounted-only exact-identity jump boundary. Their JSON backup is separate from TurnMap graph JSON; imported profiles must be validated again.

## Editing The Map

You can:

- Edit node title and summary.
- Drag nodes.
- Resize nodes from the always-visible left, right, and bottom handles, or from the lower-left and lower-right corner handles. Resized node dimensions are saved with the conversation.
- Add, edit, and delete links.
- Change link type, weight, and importance. When multiple links are selected, Link Actions can batch-change type/color, weight, and importance.
- Add notes.
- Merge, split, hide, or tag nodes. When multiple nodes are selected, Node Actions can batch-add/remove tags.
- Collapse selected turns into a topic node. Topic collapse hides the group behind a restorable topic node; it is separate from single-node content folding and nested topic groups are not allowed.
- Switch layouts.

## Organization And AI Features

Analyze Topics runs locally and does not require a configured provider or API key. AI summary, Suggest Links, AI translation, and auto summarize require a configured provider and API key.

- Analyze Topics: preclassifies likely topic-related link candidates from node titles, summaries, tags, distance, and existing links. Candidates appear in the suggestion panel and must be accepted before the graph changes.
- Answer Expansion: with a configured API key, expands one assistant answer into a structured title-only mini mind map inside the original turn node. The original node title acts as the hidden root, while first-level branches and their child points render inside the answer area. Ordinary answers target 8-22 mini nodes; dense research/background answers may use up to 80 when the structure genuinely needs it.
- Mini Node Actions: click a mini node to edit its title, color, importance, or delete its subtree from the lower-left panel. Mini nodes are not free-dragged, manually connected, or edited with inline buttons because answer expansion is meant to visualize the AI answer's structure rather than become a separate manual subgraph editor.
- Mini-map layout: newly generated answer expansions always expand to the right. Existing old left-direction expansion data is not migrated unless you re-expand the node. Summary relationships can render as a faint brace that groups nearby same-branch points into a concise conclusion.
- If the AI call fails or returns an invalid structure, TurnMap writes nothing and leaves the original node unchanged.
- Link suggestions remain editable before acceptance. If there are more suggestions than fit on screen, the suggestion panel scrolls internally.
- Summarize: creates compact titles and summaries.
- Turn nodes keep jump accuracy after AI summary or manual title/summary edits because TurnMap still jumps by stored source anchors, not by display text.
- Deep-research-style folded replies may expose the user message before the full assistant answer. TurnMap can use mapped user-message anchors as a conservative fallback, but it will avoid jumping to an unmapped duplicate prompt.
- Turn-node summary only fills blank or default title/summary fields; it does not overwrite fields you already rewrote by hand.
- Custom note nodes tagged `#AI` can be summarized manually from their tracked source turns.
- `#AI` note summary needs at least one tracked source turn. If a note has no source anchors yet, TurnMap will refuse the summary request instead of inventing unsupported context.
- Suggest Links: asks the configured AI provider to propose strong semantic links between non-adjacent related nodes.
- Suggest Links shows progress in the status bar while requesting, waiting for, filtering, and preparing suggestions for review.
- Link weight: manual links, AI suggestions, topic-analysis candidates, sequence links, and topic proxy links all carry a `0-1` weight. Link Actions show it as `0-100`; higher weights render with stronger thickness and opacity.

Local topic analysis does not send conversation text to a provider. AI features send selected conversation text to the configured provider.

## Graph Health

TurnMap runs local graph health checks before layout changes, JSON import, topic group proxy handling, and exports. It can repair safe defaults such as invalid link weights or invalid node positions, and it can drop edges that point to missing nodes or broken topic proxies. Issues appear only in the status bar and API task log under graph health; TurnMap does not show a separate warning banner and does not send graph health issues to an AI provider.

## Import And Export

Supported formats:

- TurnMap JSON
- Obsidian Canvas
- Markdown
- SVG
- PNG

Use TurnMap JSON when you want to restore and continue editing a map.

Prefer TurnMap JSON for long-term backup and transfer. JSON preserves the complete editable graph, including schema version, node dimensions, answer expansion tree data, mini-map display mode and left/right direction, topic groups, tags, colors, importance, link weights, and user-created links. PNG and SVG are visual exports; Obsidian Canvas is editable in Obsidian and includes expansion mini nodes and links, but JSON is the most complete TurnMap recovery format.

## Updates

GitHub/unpacked installs require manual updates. Planned Update Notice will tell users when a new release is available and provide links to the release page or zip package.

Store installs, once available, should update through the browser's extension update system.
