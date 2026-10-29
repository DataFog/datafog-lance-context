# DataFog and Lance context

Turn agent conversations into a privacy-reviewed training cut using real **lance-context** and **DataFog Core**. Review the text, inspect metadata rules, and download a completed training release with a receipt.

- [Live demo](https://datafog-lance-context.sid-5af.workers.dev)
- [Download the synthetic sample](https://datafog-lance-context.sid-5af.workers.dev/samples/support-conversations-v1.jsonl)
- [Independent static sample endpoint](https://datafog-lance-context-generator.sid-5af.workers.dev/samples/support-conversations-v1.jsonl)
- [Generation provenance](https://datafog-lance-context-generator.sid-5af.workers.dev/samples/generation-provenance-v1.json)
- [Known injected test cases](https://datafog-lance-context-generator.sid-5af.workers.dev/samples/ground-truth-v1.json)

This is a community export adapter. It implements a focused privacy workflow inspired by the enrichment hooks deferred in [lance-context #96](https://github.com/lance-format/lance-context/issues/96) and [PR #111](https://github.com/lance-format/lance-context/pull/111).

## Use the demo

1. Download the synthetic JSONL file. Drop the downloaded file into the app, choose it with the file picker, or drop/paste its published URL. **Load sample** offers the same real import without a download.
2. Review the source and choose the data types to clean. The default policy covers emails, phones, US Social Security numbers, and credit-card patterns. The public support address is an exact optional exception.
3. Run the export. Compare actual before/after messages and inspect the metadata review.
4. Download the training JSONL, privacy receipt, or ZIP bundle.
5. Change a policy and rerun the same source. Use **Test a blocked release** to intentionally exercise a processing failure; that run cannot download a release.

The selected synthetic source is remembered in browser storage. A later visit can reimport the saved file into a fresh backend session. Remove/trash clears the app's saved copy and upload state. Files already saved in your computer's Downloads folder are managed by your browser or operating system.

**Use synthetic data only on the public demo.** Uploaded text is sent to this demo's Python server. It is never sent to Workers AI. The backend's temporary state can expire; the browser source cache remains until removed. Run locally to evaluate your own data under your own controls.

## Run locally

Requires Node.js, npm, and [uv](https://docs.astral.sh/uv/). The Python packages support Python 3.11–3.13; the tested runtime is Python 3.12.

```sh
git clone https://github.com/DataFog/datafog-lance-context.git
cd datafog-lance-context
uv sync --python 3.12 --extra test
npm ci
npm --prefix ui ci
npm run dev
```

The launcher starts the real Python API and the Vite UI, and stops both on Ctrl+C. Its output prints the local URLs. The frontend proxies API requests to the local Python server.

For a build served directly by Python:

```sh
npm run build
uv run --python 3.12 uvicorn datafog_lance_context.api:app --host 127.0.0.1 --port 8134
```

Then open `http://127.0.0.1:8134`.

## Run without the UI

```sh
uv run --python 3.12 datafog-lance data/support-conversations-v1.jsonl --output artifacts/release
```

The command refuses to overwrite an existing release directory. Add `--redact-support-email` to remove the public-address exception, or `--test-blocked-release` to prove that a failed run produces no release.

```sh
uv run --python 3.12 datafog-lance data/support-conversations-v1.jsonl \
  --output artifacts/stricter-release --entities EMAIL PHONE SSN CREDIT_CARD IP_ADDRESS
```

## What runs

```text
Synthetic conversations
  → real Context.add_many
  → fixed source version
  → real Context.export_training
  → private intermediate files
  → Core scan_and_transform on approved message text
  → explicit metadata omission and release checks
  → complete training JSONL + receipt + ZIP
```

The released training schema contains `messages` with `role` and `content`, plus an optional numeric `reward`. Message order, roles, and numeric rewards are preserved. Raw provenance, source paths, identifiers, the upstream manifest, and raw statistics are omitted from the released bundle. The receipt records opaque source references, versions, the selected policy and its hash, replacement counts, and the training file's hash.

Raw input is visible in the browser review for your current opaque session. It is not included in release downloads. Temporary server data is private to the demo process and expires; the release is made downloadable only after its complete local bundle has been built.

The Python backend uses published wheels, pinned in `pyproject.toml` and `uv.lock`:

- `lance-context==0.6.5`
- `datafog-core==0.5.0b3` (the Python package name for 0.5.0-beta.3)

**Why the Lance pin:** an integration probe on 0.6.7 found that adding records then exporting at its reported base version returned zero examples, while an unpinned read saw the new records. The tested 0.6.5 package correctly exports the imported rows at an explicit version. This demo does not patch upstream or silently drop snapshot pinning.

This is a local-filesystem export adapter. A raw intermediate export is created in restricted staging and removed after processing. If a deployment forbids any raw exported text on disk, it needs a native pre-serialization hook rather than this adapter. The current upstream exporter can load source records into memory before filtering, so large-scale memory and throughput require separate evaluation.

## Synthetic data generation

The fixture contains eight scenarios covering personal contact data, identity/card patterns, Unicode, a metadata identifier with an email, a public support exception, and harmless dates/order numbers.

Cloudflare Workers AI's `@cf/meta/llama-3.3-70b-instruct-fp8-fast` wrote the conversation narrative using explicit placeholders. A deterministic injector supplied labeled synthetic values and an independent oracle. The raw model response, provenance, sample, and oracle are in `data/`.

The published v1 sample is immutable. Its SHA-256 is:

```text
ef80f21d4a3982fe1267673c3a0c563487b4e4d9bb9eaed864aa44be7b7b752a
```

Downloads serve saved bytes and do not invoke a model. The generator endpoint requires an operator secret. It is separate from the upload API and cannot receive uploaded conversations through the demo.

To generate a new version using your own Cloudflare account:

```sh
# Update account_id in both Wrangler configs for your account, then authenticate.
npx wrangler login
npm run deploy:generator
npm run generate -- --version v2 --bootstrap-token
```

The bootstrap option creates an operator token in memory and saves it through Wrangler's secret API without printing it or writing it to source. Alternatively, provide `DATAFOG_GENERATOR_TOKEN` from your environment. Existing version files are not overwritten. `--response-file` replays a saved real model response without another inference call. Publish the intended new static assets explicitly; the meeting demo keeps its stable v1 link.

## Deploy to Cloudflare

The UI and immutable sample assets run in a Worker. API requests go to a Cloudflare Container running Python and the actual native libraries. The generator is a separate Worker with a Workers AI binding.

```sh
uv sync --python 3.12
npm ci
npm --prefix ui ci
npm run deploy
```

Docker must be available for the image build. Update the Wrangler account ID for a different account. Secrets stay in Cloudflare or the operator environment. The container can sleep while idle; sample downloads remain available independently of its runtime. This deployment does not keep a local laptop tunnel open.

## Verify

```sh
uv run --python 3.12 --extra test pytest -q
npm run test:worker
npm run build
```

Integration tests call both real libraries. The independent fixture checks known injected originals across every unpacked release file; they also check allowed values, Unicode offsets, message order, source versions, repeatable output, and blocked downloads.

The default fixture currently produces 8 examples, 16 messages, 17 replacements, and 6 changed examples. Those are fixture results, not a claim about accuracy on customer data. Runtime shown in the UI is measured for that run and is not a scale benchmark.

## Scope

Core's structured person-name discovery uses known field names or explicit mappings. This demo does not detect arbitrary person names in prose, blur faces, de-identify voices, detect general secrets, erase historical source versions, or claim a dataset is PII-free. IP addresses, dates, and ZIP codes are optional policy choices.

The UI supports chat fine-tuning exports. Preference and rollout schemas need explicit adapters and tests. The detector logic stays in Core.

- [UI states and recovery](docs/USER_STATES.md)
- [Meeting walkthrough](docs/DEMO_SCRIPT.md)
- [Implementation contract](docs/CONTRACT.md)

MIT licensed. Dependencies retain their own licenses.
