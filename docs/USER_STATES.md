# User states and recovery

Map the states this demo can actually reach. Keep this table aligned with UI/API behavior.

| State | Visible result | Allowed next actions | Recovery/proof |
| --- | --- | --- | --- |
| Connecting | Backend health and actual dependency versions loading | Read sample instructions | Retry if offline/cold start; do not claim engine ready |
| Empty | Drop zone, sample link, synthetic-data notice | Load published sample, drop file, choose file, paste sample URL | Download remains static and public |
| Saved browser file | Filename and saved date for a cached synthetic source | Load saved file, download sample, remove saved file | Cache stores source text only; importing creates a fresh real backend context |
| Fetching sample | Sample download in progress | Wait or choose local file | Fetch error offers retry/direct download |
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
| Replaced/reset input | Clear previous source and release state | Import new input | Pending responses ignored if they refer to older input/policy |
| Browser storage unavailable | Source works for this visit with a storage notice | Continue import or clear older browser storage | Quota/private-mode errors do not prevent real processing |
| Saved file removed | App cache, upload slot, source, and release cleared | Download or choose a new source | OS Downloads remain managed by the browser/user |

Desktop drag-and-drop, keyboard file selection, URL loading, mobile input, keyboard focus, and reduced motion are part of the supported UI. A URL dragged from a browser can be a text/uri-list rather than a File: handle both by fetching the allowed public fixture URL. Also provide a normal download link because operating systems differ in URL drag behavior.

The selected source is remembered in localStorage at the user's request. Save only the synthetic source content, filename, and saved date. Never persist backend session IDs or claim a cached source has already been processed on a new visit. Removing the saved file clears the browser copy and current UI; ordinary web pages cannot trash an already downloaded operating-system file.
