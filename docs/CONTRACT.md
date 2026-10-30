# Current main workflow: LanceDB enrichment

As of October 30, 2026, the main site is a technical two-pane workbench. A local Python ingestion UDF reads six bundled fixture files and uses real Core scan findings to materialize has_PII and pii_types in a real temporary LanceDB table. Typed columns are added with add_columns and populated with merge_insert. The follow-on has_PII = false query returns actual selected IDs. The terminal displays results after successful execution; a pending or failed request never claims a completed run. No arbitrary files are uploaded or downloaded in this flow.

The UI must not imply distributed Function registration, remote backfill, or certification that selected rows are PII-free. UDF source is drawn from the executed Python implementation. The Ingestion tab is an integration sketch for an existing file pipeline. The old export adapter's private staging and blocked-release rules remain in force for its CLI and API.

## Historical export-adapter contract

# Demo contract

Build a real, open-source, publicly reachable demo using lance-context and DataFog Core. A public, immutable synthetic JSONL download must work without authentication and can be dropped into the demo. Cloudflare Workers AI generates the narrative; deterministic, labeled synthetic identifiers provide known expected cases. Cache/save the generated fixture; downloading it must not run inference.

The demo uses a real Lance context snapshot, exports chat fine-tuning examples with the real export_training API, cleans approved text fields with Core, applies explicit metadata rules, validates the full release, and publishes a safe bundle and receipt. Both a command line and browser UI should use the same pipeline. No mock detector or precomputed cleaned data.

## Components and ownership

- Python backend: `src/datafog_lance_context/`, `pyproject.toml`, `tests/`.
- Browser UI: `ui/` (frontend agent owns all except public/samples).
- Cloudflare deployment and generator: `cloudflare/`, `wrangler.jsonc`, `Dockerfile`, `package.json`, `.dockerignore`, `scripts/`, `data/`, `ui/public/samples/`.
- Root coordinates README, state contract, integration and final verification.

## Synthetic input schema

JSONL: one conversation object per line. Top-level fields:

```
{"schema_version":"1","session_id":"opaque-or-seeded-email","tenant":"synthetic-shop","source":"synthetic-support","external_id":"seeded external id","messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}],"metadata":{"scenario":"refund","synthetic":true}}
```

Require nonempty string session_id and messages array of role/content strings; preserve order. Supported roles: system,user,assistant,tool. Seed PII only with deterministic synthetic fixtures (reserved example.com emails, documented fictional phone values and validated test-pattern values). Add harmless dates/order IDs, Unicode, an allowlisted support email, and an email in an external/session identifier to demonstrate metadata handling. Ground truth belongs in a separate oracle/provenance file, not a fake detector. The bundled filename is `support-conversations-v1.jsonl`.

## Backend API contract

All API routes are same-origin; Worker sends `/api/*` to the Python container. Static UI is built to `ui/dist`.

- GET `/api/health`: `{status:"ok",versions:{lance_context:string,datafog_core:string},capabilities:{...}}`. Check real imports; no synthetic success if dependencies fail.
- GET `/api/sample`: returns bundled JSONL (fallback for local use).
- POST `/api/datasets`: JSON `{content:string,filename:string}`. Validate all rows before import into real `Context`. Return `{dataset_id:string,source_version:number,conversation_count:number,message_count:number,conversations:[{session_id,tenant,source,external_id,messages,metadata}],versions:{...}}`.
- POST `/api/runs`: JSON `{dataset_id:string,policy:{entities:["EMAIL","PHONE","SSN","CREDIT_CARD"],allow_support_email:boolean},inject_failure:boolean}`. Use a fixed context version, actual export_training, actual Core calls. Response `{run_id,status:"ready"|"blocked",error?:{code,message},summary:{...},examples:[{id,raw,clean,changes:[{entity_type,...}]}],metadata_review:[{field,action,before?,after?}],receipt:object|null,download_url:string|null}`. Per-example `raw` and `clean` are SFT example objects, messages contain role/content. Displaying raw synthetic inputs in this in-memory review response is allowed; release downloads must contain cleaned content and approved metadata only. Summary includes examples, messages, replacements, examples_changed, by_entity, duration_ms, source_version, policy_hash, versions. Return a safe failure, no released files, when inject_failure is true. Caller can show only own opaque dataset/run ID. Backend contract may be extended, coordinate any renames.
- GET `/api/runs/{run_id}/bundle`: downloadable ZIP of released training JSONL and safe receipt, only if ready.
- GET `/api/runs/{run_id}/receipt`: safe JSON receipt only if ready.
- GET `/api/runs/{run_id}/training`: cleaned JSONL only if ready.
- Missing/expired IDs: 404 with safe error. Validation errors: 422 safe structured detail without raw text. Unexpected failures: safe error codes.

State is temporary per container; UI must recover from expired IDs. A container sleep may clear state. Dataset/run IDs are unguessable. The published sample is synthetic and its provenance is recorded in the repository. The user requested removal of secondary disclosure copy from the UI. Never send uploaded data to Workers AI: it generates the published sample only. Downloads and inference endpoints are separate.

User-requested browser persistence: a Download sample action triggers a normal local download and remembers the sample source in localStorage. Imported local sources are also remembered. On a later visit, show the saved source and offer to reimport it into a new real context. A trash/remove action clears the saved browser copy and current UI; it does not claim to delete the file from OS Downloads. Catch storage quota/unavailable errors and allow session-only processing. Never cache backend IDs or old ready results as current state.

Initial privacy policy selects EMAIL, PHONE, SSN, CREDIT_CARD; date/zip/IP removal is opt-in only if UI supports those types. `allow_support_email` means exact exception `support@example.com`. Roles/order and curation selection stay unchanged. Metadata release policy uses approved opaque identifiers or a new documented DataFog release schema; never copy raw upstream manifests to release. Include output hashes, package versions, policy hash and counts. The source context path/IDs/raw filter values stay private. Native hooks and preference/RL export are future scope; unknown schemas fail visibly.

## Publication and demonstration

Publish the real API+UI using Cloudflare Containers if account/runtime supports it. The static synthetic sample URL must remain usable even if the container is asleep. Generator calls require a secret or stay in an authenticated CLI; do not expose an unrestricted billable public generator. Full user authorization includes building, deployment, creating the new public source repo, and publishing synthetic artifacts. Preserve other projects and account services.

Demo failure injection is labeled in UI. A policy edit marks the previous run stale and disables its download until rerun. Real fixture verification checks seeded originals across every released file; report fixture coverage separately from real-world accuracy.

