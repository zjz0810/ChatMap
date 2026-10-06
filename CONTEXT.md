# TurnMap Context

## Glossary

### Topic Analysis
TurnMap topic analysis is a local, review-first workflow that preclassifies likely relationships between existing map nodes. The 0.6.0 MVP uses lightweight weighted rules over node titles, summaries, tags, proper-noun-like terms, node distance, and existing edges to produce candidate link pairs. It is not provider embeddings, offline model embeddings, automatic topic-node creation, automatic tagging, or automatic topic collapse.

### Candidate Link Pair
A candidate link pair is a proposed source-to-target node relationship produced before the graph is mutated. Candidate pairs must be reviewed by the user through the existing suggestion flow before they become graph links.

### API Refine
API refine means using the configured AI provider to judge, label, or explain a small set of preclassified candidate link pairs. It is optional and is meant to improve relationship quality, not to replace local preclassification or silently scan the whole graph.
