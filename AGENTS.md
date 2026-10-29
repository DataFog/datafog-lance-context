# DataFog lance-context demo

- Use real `lance-context` and `datafog-core`; keep detector semantics in Core.
- Never publish raw uploads or raw intermediate exports. Public fixtures must be synthetic and labeled.
- Preserve message order, roles, scores, and source-version selection.
- A blocked run has no downloadable release. A changed policy invalidates the displayed release.
- Keep secrets out of source, logs, tests, screenshots, and deployment output.
- Test the actual integration, failure publication boundary, metadata policy, and upload validation.
- Do not modify the reference repositories under client-research or unrelated DataFog repositories.

