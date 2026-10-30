# Ingestion UDF walkthrough

1. Start at **01 / Ingestion UDF**: the MLE's `prepare_training_rows` function prepares chunks and calls DataFog before yielding each `TrainingRow`.
2. Follow the same page to **02 / Output schema**: `has_pii` and `pii_types` are already declared alongside the training fields.
3. The saved successful result is already loaded: show six output rows, four flagged, and their actual job ID and recorded runtime. No waiting or ingestion click is required.
4. Apply the filter to select the two chunk keys returned by the verified query.
5. Optionally click **Run live ingestion** to repeat the real workflow. The previous result stays available while it runs; successful live output replaces it.

The hosted runtime processes a source batch snapshot using Geneva's chunker/materialized-view API. It is self-hosted, with an explicit refresh to execute ingestion, rather than managed Enterprise auto-refresh. DataFog is inside the ingestion UDF; it is not a second UDF applied to existing training rows. Cut the wait in a recorded clip if needed.

The UDF, output schema and write step share one continuous sequence. UDF and pipeline code fold open independently; the schema and results stay visible. Both code sections start folded, and both can be opened together. There are no tabs.
