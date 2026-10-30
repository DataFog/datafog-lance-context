# Geneva enrichment walkthrough

1. Show the UDF definition, then **Register & backfill**. The displayed function is the executed implementation: `add_columns(detect_pii)`, `backfill_async("has_PII")`, `job.result()`, and `checkout_latest()`.
2. Click **Run backfill**. Keep the real pending state visible. The hosted, R2-backed test took about two minutes on the budget instance; cut or speed up the wait in a recorded clip.
3. Show the actual job ID, DONE status and committed table version. Switch to **Schema** to show the two added columns.
4. Show the metadata table: six rows, four flagged. Apply the filter to show the two IDs returned by `has_PII = false`.

This is self-hosted Geneva with a single-node Ray runtime in Cloudflare and tables in R2. It is not managed Enterprise or Enterprise auto-backfill. DataFog scans the existing extracted-text column. Source data is synthetic. No configured pattern detected is not proof that every kind of PII is absent.

The hosted allowance is 40 API requests through November 6, 2026. Startup retries and QA requests count toward it. No extra compute starts after expiry or exhaustion. Static pages and health checks do not start compute.
