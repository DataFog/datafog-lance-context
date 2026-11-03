# Demo link tracking

Email link: https://datafog-lance-context.sid-5af.workers.dev/?ref=lancedb-email

The client sends a `visit` when the tagged demo loads and `engaged` when a viewer reaches slide 2 or 3. Each event is sent once per campaign per browser tab, using sessionStorage; there is no visitor ID. Reloading the same tab does not increment the count again. A new tab can count again. Browsers that block sessionStorage do not report events.

The Worker stores campaign totals and last-event times in a separate Durable Object. It does not store IPs, user agents, identities, or cookies. Viewing the demo never starts the ingestion container. Email scanners that run JavaScript can count, so these are neither unique people nor proof of who visited. The campaign identifies which link was used, not company affiliation. A separate `qa` campaign keeps testing out of the email counts.

To read the private report from the repository:

```sh
node scripts/check-visits.mjs
```

The local, gitignored `.tracking-secret` contains the bearer token for the read-only `/api/visits` report. The matching Worker secret is `VISITS_READ_TOKEN`. The report fails closed when that secret is missing. Never share the token or the local file. Anyone can open the demo; counts can be inflated by repeated tabs or automated traffic.
