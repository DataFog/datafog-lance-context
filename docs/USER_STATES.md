# Current ingestion states

- Saved result (default): the last verified hosted response is bundled with the UI. All six rows, schema, job ID and original runtime appear immediately; no API or ingestion call runs on page load. Filtering and code folding work immediately.
- Running live (optional): Run live ingestion sends POST /api/enrichment; duplicate clicks are disabled. The previous result stays visible and is labeled as previous. Startup retries keep the same run ID.
- Live result: successful live output replaces the saved or previous result and the terminal label changes to LIVE RESULT.
- Filtered: actual selected asset_id:chunk_index keys. A flagged sibling chunk does not qualify because another chunk in the same document is clean.
- Error: the failed live attempt is shown at the top of the terminal; the previous successful result stays visible, clearly labeled, and retry is available.
- Allowance ended: no new compute starts after expiry or request exhaustion.

Desktop pairs a short UDF excerpt with a larger table. Two orange-tinted columns show what DataFog adds. Phones put the table above the code. Full implementation expands actual source and run details. Live execution is a secondary footer action. Heading stays unchanged; the design uses a light LanceDB palette.

## Historical export workflow

# User states and recovery

Map the states this demo can actually reach. Keep this table aligned with UI/API behavior.

| State | Visible result | Allowed next actions | Recovery/proof |
| --- | --- | --- | --- |
| Source loading | Support conversations sample card with a loading state | Wait or upload another JSONL | Fetch static sample bytes into memory; do not create a Lance dataset or write browser storage |
| Source ready | Support conversations, actual filename, JSONL format, conversation and message counts, Ready to review | Start demo; secondary upload; File options for optional source saving/cache clearing; drop file or sample URL | Start demo imports the shown sample into real Lance; no source download is required |
| Saved browser file | Separate filename and saved date for a cached custom source | Load saved file, remove saved file, continue with public sample | Public sample stays the default; cache stores source text only; importing creates a fresh real backend context |
| Sample unavailable | Actionable sample-loading error | Retry or upload another JSONL | No import or successful preload claimed after a fetch failure |
| Fetching sample | Explicit sample download in progress | Wait | Successful download also saves its source in browser storage |
| Importing | JSONL validation and real Lance import | Wait | Invalidates no completed release for the new input |
| Invalid file | Row number and safe reason | Correct/retry/reset | No raw text in backend errors; retain recoverable UI |
| Imported | Source snapshot, conversation list, raw messages, current policy | Inspect, edit policy, run export, replace input | Real context version shown |
| Processing | Real API request pending | Inspect current source | Disable duplicate run/download; no fake completion |
| Ready | Actual raw/clean diff, metadata rules, counts, receipt | Download JSONL/ZIP/receipt, replay policy, test blocked run | Download matches real release bytes |
| Policy changed | Previous result marked out of date | Rerun or reset | Prior release download disabled in current UI |
| Blocked | Safe failure reason and no new release | Retry, fix policy, load sample | API download rejects blocked run |
| Expired session | Container no longer has this source/run | Reimport preserved input | Never silently present old data as a fresh run |
| Network failure | Recoverable connection error | Retry, reimport | No ready state inferred from timeout |
| Download failure | Output retrieval error | Retry or rerun if expired | Receipt/hash is evidence, not successful browser download |
| Replaced/reset input | Previous source and release state cleared; public sample available | Start demo for the sample or import another input | Pending responses ignored if they refer to older input/policy; a late preload cannot replace an active import |
| Browser storage unavailable | Source works for this visit with a storage notice | Continue import or clear older browser storage | Quota/private-mode errors do not prevent real processing |
| Saved file removed | Browser source cache and current workspace cleared; public sample still available | Start demo, download sample, upload another JSONL | Preload does not recreate the removed cache; OS Downloads remain managed by the browser/user |

Desktop drag-and-drop, keyboard file selection, URL loading, mobile input, keyboard focus, and reduced motion are part of the supported UI. A URL dragged from a browser can be a text/uri-list rather than a File: handle both by fetching the allowed public fixture URL. Also provide a normal download link because operating systems differ in URL drag behavior.

The public sample is preloaded into memory only. An explicit download or import remembers the source in localStorage at the user's request. Save only the source content, filename, and saved date. Never persist backend session IDs or claim a preloaded or cached source has already been processed on a new visit. Removing the saved file clears the browser copy and current workspace without removing access to the public sample; ordinary web pages cannot trash an already downloaded operating-system file.
