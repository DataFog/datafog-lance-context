# Enrichment UI verification — October 30, 2026

The current main UI replaces the conversation export walkthrough. Local checks exercised real enrichment (6 files, 4 flagged rows, 2 selected IDs), filter/show-all controls, typed schema, and terminal output. At a measured 321px width, the panes stack, the page has no horizontal overflow, and the Run enrichment control is 48px high. Desktop uses two columns. The Python suite passes 20 tests, including the new native-table integration tests.

The terminal reports local execution in the hosted container. No distributed LanceDB Function registration or remote backfill is claimed.

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
