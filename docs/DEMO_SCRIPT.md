# Meeting walkthrough

This is a community integration using real lance-context and DataFog Core. The sample is synthetic. The purpose is to demonstrate an export workflow and known fixture behavior, not claim perfect detection on customer data.

## Load a training source

Open the published sample link. Download the JSONL file and drop it into the app. The app also accepts a drag of its sample URL, a pasted sample URL, and its Load sample action. These are alternate ways to reach the same import API.

Show the actual source snapshot version, conversation count and dependency versions. Open a conversation that has a useful order number or delivery date along with supported personal data.

## Review a privacy policy

Select the needed entity types. Keep useful dates and order numbers. Choose whether the public support address is allowed. Run the export and review the actual before/after text.

Explain that Lance made the selection and grouped the messages; Core detected and transformed the selected text. The demo does not replace Lance's curation logic.

## Find the less obvious leak

Open the metadata review. The synthetic fixture intentionally places an email in a session or external identifier. A clean message alone does not make the original export ready to release.

Show the release policy for IDs and provenance. The downloadable bundle contains the cleaned training file and a safe receipt; the raw upstream manifest stays in private staging.

## Inspect a completed release

Show counts by entity, the source version, policy hash, package versions and output hash. Download the training JSONL and receipt. The fixture oracle tests known seeded values independently from the detector.

## Replay a changed rule

Change the support-address exception or selected entity types. The previous result becomes stale and its current download action is disabled. Rerun the same source snapshot and compare the new result.

## Demonstrate a blocked release

Use the labeled test-failure action. Explain that this intentionally exercises the processing-error path. No new completed release is published. A blocked run cannot download a training bundle. Retry to recover.

## Close with a customer question

“This works on a public synthetic example using your existing export flow. Which customer's training-data release should we validate next?”

The pilot would add that customer's policy, evaluation, deployment rules and support. Free-text name detection, image/audio cleanup, source-history deletion, and large-scale export performance need separate scope.
