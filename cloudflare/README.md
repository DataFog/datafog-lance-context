# Cloudflare delivery

The main Worker serves the built UI and immutable public samples. Only `/api/` requests go to a Python container, where the real `lance-context` and `datafog-core` distributions run. The separate generator Worker uses Workers AI for operator-authorized synthetic dialogue generation. Uploaded demo data is never sent to Workers AI.

## Public fixture

The saved v1 sample is independent of container startup:

https://datafog-lance-context-generator.sid-5af.workers.dev/samples/support-conversations-v1.jsonl

The main demo also serves the same bytes at `/samples/support-conversations-v1.jsonl`. Both routes allow unauthenticated GET/HEAD, use the NDJSON MIME type, include an attachment filename, and allow cross-origin sample downloads. The fixture is immutable; future changes need a new versioned filename.

`data/generation-provenance-v1.json` records the model, generation time, prompt hash, model-response hash and final dataset hash. `data/ground-truth-v1.json` lists known injected values. These are fixture labels, not a claim of real-world detection accuracy.

## Generate a future fixture

The operator route `/admin/generate` requires a secret. Ordinary public downloads do not invoke a model or spend inference credits. The generation script can create a new secret entirely in memory and send it to Wrangler through stdin; it does not print or save the secret. It saves the real model response and injects deterministic test values after validating model placeholders.

```sh
npm ci
npm run deploy:generator
python3 scripts/generate_dataset.py --version v2 --bootstrap-token
```

The existing v1 file is protected from overwrite. Use a new `--version` to save new dataset, response, oracle and provenance filenames while keeping v1 unchanged. To replay a saved real model response into a new fixture version without another inference call:

```sh
python3 scripts/generate_dataset.py --version v2 --response-file data/generation-response-v1.json
```

Replay also refuses to replace an existing immutable file. It is intended for a new fixture version or an unpublished clean build.

## Build and publish the demo

The image uses Python 3.12, the checked-in `uv.lock`, and Linux wheels for the real libraries. Build for `linux/amd64` when testing locally. Cloudflare deploys the image built from `Dockerfile`.

```sh
npm ci
npm --prefix ui ci
npm run build
npx wrangler deploy
```

On a Mac using the isolated Colima profile created for this demo:

```sh
colima start datafog-lance-context --cpu 4 --memory 6 --disk 12 --root-disk 12 --vz-rosetta --activate=false
export DOCKER_HOST=unix://$HOME/.colima/datafog-lance-context/docker.sock
npx wrangler deploy
```

Use the Docker daemon already configured on other machines. Do not change another project's Docker profile. The public demo uses one container so temporary dataset and run IDs always reach the same process. The instance sleeps after 20 idle minutes to keep a live walkthrough usable while avoiding a permanent idle service. The UI handles cold starts and expired sessions. Samples remain available while the container sleeps.

The current deployment selects Cloudflare's `basic` container type (1 GiB memory). Verification must include real imports, a sample import/export, failure blocking, and peak-memory checks. A separate Worker asset deployment does not by itself prove the Python engine is ready.

Secrets, raw intermediates, and runtime uploads are excluded from image context, static assets, source control, and ordinary logs.
