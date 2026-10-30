# Geneva UI verification — October 30, 2026

The deployed endpoint completed a real R2-backed Geneva backfill with Core 0.5.0b3, Geneva 0.17.0 and LanceDB 0.41.0. Job b68b160a9e844d4aa3518f87ad6cf844 returned DONE; table version advanced from 1 to 4, with six materialized rows, four flagged, and doc_001/doc_005 returned by the training filter. A separate connection to R2 confirmed the committed annotations and no recorded errors. [Raw result](../cloudflare/geneva-verification.json).

The live run took 119,362 ms. The current UI shows the executed registration/backfill source. Phone viewport checks at 321px and 390px measured no page-width overflow; terminal controls precede code on phones. Actual output, schema and filter controls are checked in the deployed browser before handoff. Startup/proxy failures can retry automatically; application failures and exhausted allowances do not report success.

Validation: 22 Python tests; 9 Worker tests, including conditional S3 commits, multipart copies, expiration, request allowance and hard-stop scheduling; TypeScript/Vite build. The package emits a Geneva/LanceDB compatibility warning for two methods not used by this flow. The actual methods used by the demo were exercised against R2.

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
