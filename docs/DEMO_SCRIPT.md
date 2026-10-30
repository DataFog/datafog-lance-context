# LanceDB enrichment walkthrough

1. Show the DataFog Python UDF on the left and the terminal command on the right. Switch to Ingestion to show how it joins an existing file pipeline.
2. Click Run enrichment. The server reads six fixture files, creates a real local LanceDB table, runs Core, adds typed columns, and commits the annotations. The terminal displays actual versions, row counts, schema, commit version, and elapsed time.
3. Switch to Schema. Show has_PII and pii_types materialized on training_data. The table contains source references rather than customer conversations.
4. Apply the has_PII = false filter. Two IDs returned by the real database query remain. This illustrates a downstream selection step; it does not certify the selected data as PII-free.

The implementation runs locally in the hosted container. It is a Python ingestion UDF, not a registered distributed LanceDB Function. Bundled fixtures are synthetic; the current main workflow accepts no uploads. The previous export adapter remains available via CLI/API.
