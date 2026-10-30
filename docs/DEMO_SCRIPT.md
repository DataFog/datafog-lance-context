# Code to table walkthrough

1. Start with the table, already loaded from the verified hosted run. Point to the two highlighted new columns: has_pii and pii_types.
2. Point to the short code excerpt: DataFog scans each prepared chunk inside the MLE’s existing ingestion UDF, and the UDF emits both fields alongside the training row.
3. Optionally select unflagged rows to show how the metadata supports training selection.
4. Full implementation opens the actual UDF and Geneva pipeline. Run live ingestion is optional; prior output remains available during the run.

The light layout gives the table more space than the code. On phones the table comes first. Runtime, job IDs, versions and source links are inside Full implementation. The approved heading and real Core/Geneva/R2 integration are unchanged.
