# Light code-to-table layout — October 30, 2026

The main view now emphasizes the resulting table: row_id plus orange-tinted has_pii and pii_types columns. A smaller code excerpt shows the actual Core call inside the MLE’s ingestion function. Full source and run metadata are collapsed below the main view. There is no main terminal or numbered sequence. The approved heading is unchanged.

Saved results still load immediately. Filtering selects actual row/chunk keys. Optional live execution uses the same endpoint and preserves prior results during pending or failed attempts. The design uses a white background and black LanceDB mark. TypeScript/Vite build passes; the underlying backend is unchanged. Checks at 321px and 390px confirm no page overflow, all three table columns fit, and the table appears before the code on phones. Selection yields two false-flag rows. Expanded full implementation uses the full footer width.

## Earlier integration verification

# Ingestion UI verification — October 30, 2026

The page now starts with the bundled last verified hosted response, labeled SAVED RESULT, preserving its actual job ID and original recorded duration. All six rows and the two-row filter are available immediately after reload. The only ingestion fetch remains inside the optional Run live ingestion click handler. Pending and failed live attempts retain the previous result and identify it as previous; successful live output changes the label to LIVE RESULT. The live action uses secondary styling.

The current demo runs DataFog inside the MLE's `prepare_training_rows` ingestion UDF. The real hosted API received six new source documents and wrote six annotated training rows to a derived Lance table in private R2 storage. Four rows were flagged; the real query selected doc_001:0 and doc_005:0. The raw captured response is in [hosted evidence](../cloudflare/geneva-verification.json).

UDF, output schema and pipeline share one numbered sequence. Both code sections start folded and can be opened independently or together. The schema remains visible, with no tabs. Phone checks at 390px confirm no page overflow and both sections can remain open. The terminal renders actual row-level has_pii and pii_types values from the server response.

Validation: 23 Python tests, including positive/negative/missing/empty document inputs, multi-chunk outputs, schema creation before any training rows, and idempotent retries. Nine Worker tests cover the existing private storage transport and runtime budget. TypeScript/Vite build passes. A local real Ray ingestion run and hosted R2 ingestion run both pass. The installed Geneva SDK pins chunker views to a source snapshot; the pipeline explicitly refreshes that version.

## Historical UI verification

# UI verification

## Mobile controls regression

Checked October 29, 2026 after the user's iPhone Chrome screenshot showed both sticky bars missing. The exact device paint failure was not reproduced in desktop emulation. A related overflow was measurable: at a 365 × 618 CSS viewport, the original source page was 668px high and allowed 50px of document scrolling. The revised page is 618px high with no document scrolling.

The layout now uses three grid rows within `100svh`, with an independently scrolling main area. Header and action controls have reserved rows; they no longer depend on sticky positioning or backdrop filters. Step changes reset the main area's scroll position immediately. [WebKit documents `svh` as the smallest possible viewport height](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).

Checks at 321 × 568, 365 × 618, 672 × 327 landscape, and 1309 × 818 desktop used read-only DOM probes to confirm:

- The entire primary button rectangle is inside the visual viewport, and hit testing at its center reaches the button.
- The header retains its height and the document does not overflow the viewport.
- Long review content can scroll 1,686px while both control rows remain visible; the next step resets main scrolling to zero.
- The real pipeline still produces 8 examples and 17 replacements. Desktop comparison displays 8 original and 8 cleaned conversation panes.
- Rules remain usable on the short landscape viewport. ZIP detection and the public-support exception were toggled and restored to their defaults.

These are desktop browser viewport checks, not physical iPhone verification.

## Earlier workflow checks

The preloaded-source revision was checked locally on October 29, 2026:

- A fresh visit loads the public sample into memory and shows its filename, JSONL type, 8 conversations, and 16 messages.
- Start demo imports that file into real Lance; the default policy still produces 17 replacements.
- A saved custom upload stays available as a secondary action while the sample remains the default.
- Download sample saves the file and browser copy; clearing and reloading removes that saved copy without removing the public sample.
- At a measured 321px viewport, the source screen has no horizontal page overflow and its controls are 44–52px high.

The user-approved heading is “Redacting PII in Training Data.”

Checked October 29, 2026 in the Codex in-app browser. Widths below are the measured CSS viewport widths, not device-model claims.

| Surface | Observed result |
| --- | --- |
| Narrow phone, 321px | Page width equals viewport width; no horizontal page overflow; 15px message text; Original/Cleaned controls are 44px high |
| Phone, 354px | Single-column workflow; source controls are 44–48px high; conversation selection and policy controls remain readable |
| Desktop, 1309px | No horizontal page overflow; Original and Cleaned panes both visible in Compare mode |

The browser checks exercised actual APIs and downloaded files:

- Downloaded the public JSONL to Downloads and saved its source in browser storage.
- Reloaded and restored the saved-file card.
- Removed the saved browser source, reloaded, and confirmed the saved-file card was gone.
- Imported the downloaded file through the native file picker.
- Loaded a saved file into a fresh real Lance context.
- Completed the real export and reviewed actual redactions.
- Repeated the final run on the public deployment with Core 0.5.0b3 and downloaded its release ZIP.
- Selected the Unicode conversation and verified its actual email-bearing external ID in the focused metadata review.
- Changed a policy and confirmed the current release download was disabled until rerun.
- Triggered the labeled processing failure and confirmed no release download was offered.
- Restarted the local backend, observed Session expired, and used Reimport input to recover with Core 0.5.0b3.

The final UI mirrors LanceDB's palette and type, removes secondary disclosure/helper/footer prose as requested, and retains actionable status/error text. Motion follows actual processing and release states. Reduced-motion rules disable animations and transitions.

These checks use desktop browser viewport emulation. They do not claim physical-device coverage across every mobile browser. Native integration and public deployment checks are recorded separately in `cloudflare/deployment-verification.json`.

![Public demo at phone width](demo-mobile.jpg)
