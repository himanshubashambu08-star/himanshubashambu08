# ⛽ Fuel Receipts – Tax Tracker

A mobile-friendly, offline-first web app (PWA) for capturing petrol/gas receipts and working out what you can claim at tax time.

## Features
- **Snap a receipt photo** (camera on phones) – images are compressed and stored on-device.
- **Auto-calculations** – volume × price fills the total; the sales tax (HST/GST/VAT) inside the total is worked out from your rate (editable).
- **Business-use %** per receipt, or a **logbook override** (business km ÷ total km) for the whole tax year – the method CRA, ATO, HMRC etc. expect.
- **Input tax credits** – if you're registered for HST/GST/VAT, the claimable expense excludes tax and the recoverable credit is shown separately.
- **Tax summary** per tax year, by month and by vehicle; flags receipts with no photo.
- **Export CSV** for your accountant / QuickBooks / Xero, and **Print / Save as PDF** report with the receipt images attached.
- **Region presets** – Ontario HST 13%, BC/AB GST 5%, Quebec GST+QST, India (FY from April), Australia (FY from July), UK, NZ.
- **Backup / restore** to a JSON file (includes photos). Everything stays on your device – no account, no server.

## Run it
It's plain HTML/CSS/JS – no build step.

```bash
cd petrol-receipts
python3 -m http.server 8080
# open http://localhost:8080
```

Deploy by uploading the folder to any static host (Vercel, Netlify, GitHub Pages). On a phone, open the site and choose **Add to Home Screen** to install it as an app; it then works offline.

## How the numbers are calculated
For each receipt with total `T`, tax `X`, and business-use fraction `b`:

| | Not tax-registered | Registered (claims ITC/VAT) |
|---|---|---|
| Claimable expense | `T × b` | `(T − X) × b` |
| Tax credit | – | `X × b` |

If logbook km are entered for a tax year, `b = business km ÷ total km` for every receipt in that year.

> This tool organises your records; it isn't tax advice. Keep original receipts as your tax authority requires and confirm claim rules with your accountant.
