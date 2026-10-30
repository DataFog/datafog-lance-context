# One-week Geneva demo

## Plan and acceptance

Use a real Geneva UDF to add `has_PII` and `pii_types` to an extracted-text training table. Run a real asynchronous backfill, query its committed table version, and show the job ID, schema and result. Keep the approved heading and mobile layout. Verify the deployed endpoint and browser. Commit and push the source.

Compute is a single Cloudflare `standard-2` container (1 vCPU, 6 GiB RAM, 12 GB disk). Ray workers share that instance. Tables and Geneva metadata live in a dedicated private R2 bucket, not the container filesystem. This is self-hosted Geneva, not managed Enterprise. Enterprise auto-backfill is not claimed.

The container has no general Internet access. Its private `r2.internal` outbound handler maps the S3 operations used by Lance to its R2 bucket binding. No account API token or S3 key is installed in the container. The handler is not a public Worker route. Public runs accept no arbitrary data or code. Fixtures are synthetic. Raw text stays out of API responses.

## Cost estimate and bounds

Rates checked October 30, 2026. The demo week is within the account’s current R2 billing period, ending November 13. Account usage was checked in the signed-in dashboard and is within its included allowances. Estimates are incremental to the account's existing Workers Paid subscription; its $5 monthly base fee is already incurred by the existing demo.

Sources:
- https://developers.cloudflare.com/containers/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/

The hosted demo permits 40 requests across the week. The counter is stored in its Durable Object and counts failed starts too. A container sleeps one minute after activity and is forcibly stopped ten minutes after each start. Even if every request causes a separate start, runtime is at most 400 minutes (6 hours 40 minutes). New compute requests are rejected after the configured seven-day expiry. Health checks and static pages do not start containers.

| Item | Estimate without shared free allowances |
| --- | ---: |
| CPU: 24,000 seconds × $0.000020 | $0.48 |
| Memory: 6 GiB × 24,000 seconds × $0.0000025 | $0.36 |
| Disk: 12 GB × 24,000 seconds × $0.00000007 | $0.021 |
| R2: up to one million Class A and Class B requests, rounded to billing units | $4.86 |
| R2 storage, up to one GB-month | $0.015 |
| Workers, Durable Objects, registry and test-run allowance | $1.00 |
| Total estimated added cost | **$6.74** |

The small fixed fixture and run allowance should use far fewer than a million storage requests. Shared R2 free allowances may make storage requests free. Expected actual added cost is below this conservative estimate. This is an estimate, not a provider-enforced dollar cap. No new subscription is purchased. The public run allowance includes hosted QA runs.

## Fidelity

The input `text` column represents output from an existing extraction step. The PII UDF scans that column; it does not pretend to fetch arbitrary file formats. `source_uri` retains source lineage. Missing text raises an error rather than marking a row clean. Null or incomplete enrichment never yields a successful result. A false value means no configured pattern was detected, not proof that all sensitive content is absent.

Geneva's `Columns[NamedTuple]` registers two sibling columns. Backfilling the group's first column materializes both. After `job.result()`, `checkout_latest()` refreshes the driver to the committed version. The training selection explicitly filters `has_PII = false`; nulls do not qualify.

Direct object-storage connections require an explicit backfill. Moving to Enterprise replaces connection and execution configuration with a managed service; it does not make this demo an Enterprise deployment.

## Hosted evidence

See [the captured hosted response](../cloudflare/geneva-verification.json). The first successful hosted run took 119,362 ms, materialized six rows in version 4, and returned DONE with four flagged rows. Plan a cut during the wait for a short recorded clip.
