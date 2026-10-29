# LanceDB reference and mobile design

The user requested LanceDB colors, typography, and voice, concise copy, meaningful motion, and mobile as a first-class surface.

Reference checked October 29, 2026: https://www.lancedb.com/ and its current stylesheet:

https://cdn.prod.website-files.com/69a866b324926425eccc4cf5/css/lancedb.webflow.shared.8cc27711b.min.css

| Role | Reference token |
| --- | --- |
| Background | #171513 |
| Raised surface | #1e1b19 |
| Light text | #f4ebe8 |
| Secondary text | #ad9e95 |
| Orange | #ff734a |
| Orange hover | #f56136 |
| Lavender | #e7d2f6 |
| Border/deep neutral | #302a25 |

The reference uses Aeonik Pro body text and Aeonik Fono headings, with JetBrains Mono for code. Proprietary font binaries are not redistributed in this repository. The UI can reference the official public CDN font URLs with a locally available open-font fallback.

Keep attribution clear: this is a community demo using lance-context and DataFog Core. Matching a reference does not imply official LanceDB ownership or endorsement.

Mobile is a primary workflow: readable text, generous touch controls, a single-column source/policy/review flow, and Original/Cleaned switching instead of tiny side-by-side messages. Horizontal scrolling is reserved for bounded code or data tables when necessary.

Motion explains real state changes: source imported, cleanup pending, actual replacements revealed, release ready, and release blocked. Do not invent progress percentages, imply a backend stage has completed early, or delay real responses to fake a pipeline. Honor prefers-reduced-motion.

Remove secondary UI copy at the user's request, including disclosure paragraphs, storage explanations, repeated helper text, and footer prose. Keep primary controls, field labels, results, and actionable errors. Dataset provenance and coverage evidence remain inspectable in the repository and receipt artifacts.
