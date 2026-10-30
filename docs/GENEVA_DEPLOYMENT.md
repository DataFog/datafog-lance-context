# One-week Geneva demo

## Plan and acceptance

Run DataFog inside the MLE's existing document-to-training-row UDF. Its output schema includes `has_pii` and `pii_types` before any row is emitted. Append a new source batch and use Geneva's chunker materialization to write training rows with those values filled in. Show the actual job, schema and table in the terminal and verify desktop/mobile. Commit, push and deploy.

Compute is a single Cloudflare `standard-2` container (1 vCPU, 6 GiB RAM, 12 GB disk). Ray workers share that instance. Tables and Geneva metadata live in a dedicated private R2 bucket, not the container filesystem. This is self-hosted Geneva, not managed Enterprise. Enterprise auto-backfill is not claimed.

The container has no general Internet access. Its private `r2.internal` outbound handler maps the S3 operations used by Lance to its R2 bucket binding. No account API token or S3 key is installed in the container. The handler is not a public Worker route. Public runs accept no arbitrary data or code. Fixtures are synthetic. Raw text stays out of API responses.

## Cost estimate and bounds

Rates checked October 30, 2026. The demo week is within the account’s current R2 billing period, ending November 13. Account usage was checked in the signed-in dashboard and is within its included allowances. Estimates are incremental to the account's existing Workers Paid subscription; its $5 monthly base fee is already incurred by the existing demo.

Sources:
- https://developers.cloudflare.com/containers/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/

The hosted demo permits 40 requests across the week. The counter is stored in its Durable Object and counts failed starts too. A container sleeps three minutes after activity. Every accepted request reserves a ten-minute runtime window, including startup, and schedules a forced stop. A later request renews the window; callbacks for older windows cannot stop a newer run. The union of 40 windows is at most 400 minutes (6 hours 40 minutes). New compute requests are rejected after the configured seven-day expiry. Health checks and static pages do not start containers.

| Item | Estimate without shared free allowances |
| --- | ---: |
| CPU: 24,000 seconds × $0.000020 | $0.48 |
| Memory: 6 GiB × 24,000 seconds × $0.0000025 | $0.36 |
| Disk: 12 GB × 24,000 seconds × $0.00000007 | $0.021 |
| R2: up to one million Class A and Class B requests, rounded to billing units | $4.86 |
| R2 storage, up to one GB-month | $0.015 |
| Workers, Durable Objects, registry and test-run allowance | $1.00 |
| Total estimated added cost | **$6.74** |

The small fixed fixture and run allowance should use far fewer than a million storage requests. Shared R2 free allowances may make storage requests free. Expected actual added cost is below this conservative estimate. This is an estimate, not a provider-enforced dollar cap. No new subscription is purchased. The public run allowance includes hosted QA runs and startup retries. Retries carry the same idempotency key: while the runtime remains alive, they wait for and reuse the original completed result instead of launching another backfill. The in-memory result cache holds at most 40 runs.

## Fidelity

`prepare_training_rows` is the MLE-owned row preparation function. It splits document text into paragraphs, calls real Core scan on each prepared chunk, and yields a typed TrainingRow containing text and PII metadata together. Source identity and lineage columns are inherited by Geneva. There is no standalone DataFog column UDF and no later privacy backfill.

The demo appends new source rows before creating the derived view. The installed SDK pins this query to a source version; refresh explicitly uses that batch version. It is a batch-snapshot ingestion example, not an automatic streaming subscription. The executed APIs are `create_udtf_view(..., udtf=prepare_training_rows)` and `refresh_async(src_version=source.version)`.

Missing text fails. Missing fixture output or null metadata fails. The raw training text stays in private storage; public results contain only lineage and PII annotations. A false flag only means no configured pattern was detected. Filtering uses asset and chunk identity together.
