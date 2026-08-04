# v28 – Custom Date Range, Editable Document Date, and Event Separation

## Changes

- Separates `Power Stop`, `Power Off`, and `ไฟดับ` from `Stop Dryer` / `หยุดอบแป้ง`.
- Preserves the original remark text in OCR and classifies events in the frontend without overwriting the source wording.
- Reads document dates written as `4/8/69`, `04/08/2569`, `4/8/2026`, `04-08-69`, or similar.
- Uses an editable document-date field in the application header.
- Keeps both the date read from the paper and the user-confirmed date in history metadata.
- Supports an inclusive custom range: start date **through** end date.
- Fixes the first selected date being omitted from a range.
- Adds two display modes:
  - All dates
  - Production-data dates only
- Separates daily status into production, no production, and no report.
- Does not store the original photograph in history.

## Date rules

- Two-digit year `60–99` is interpreted as Buddhist year `25xx` and converted internally to CE.
- Two-digit year `00–59` is interpreted as CE `20xx`.
- The app displays the confirmed date as `DD/MM/BBBB` while using an ISO date key internally.

## Deployment

This version changes both the frontend and the Worker OCR prompt. Deploy the frontend through GitHub/Cloudflare Pages and copy the included `worker.js` to the Cloudflare Worker.
