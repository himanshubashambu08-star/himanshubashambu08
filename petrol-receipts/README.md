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
- **Accounts** – sign in with Google or any email + password. Receipts, photos and settings are saved to your account (Firebase) and sync across your phone and computer. Works offline and syncs when you're back online.
- **Backup / restore** to a JSON file (includes photos).
- Without Firebase set up, the app still works with data kept on that one device.

## Turn on accounts (one-time, ~10 minutes, free)

1. Go to <https://console.firebase.google.com>, sign in with your Google account and click **Create a project** (any name, e.g. `fuel-receipts`). You can turn Google Analytics off.
2. **Add a web app**: on the project home page click the **</>** (Web) icon, give it a nickname, click **Register app**. Copy the `firebaseConfig = { ... }` values it shows.
3. Paste them into [`firebase-config.js`](firebase-config.js), replacing `null`:
   ```js
   window.FIREBASE_CONFIG = { apiKey: '…', authDomain: '…', projectId: '…', storageBucket: '…', messagingSenderId: '…', appId: '…' };
   ```
   These values are not secret – the security rules below are what protect the data.
4. **Sign-in methods**: *Build → Authentication → Get started → Sign-in method*. Enable **Google** (pick your support email, Save) and **Email/Password** (Save).
5. **Database**: *Build → Firestore Database → Create database*. Pick a location near you (e.g. `northamerica-northeast2` Toronto), start in **production mode**.
6. **Security rules**: in Firestore open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**. This makes each person's receipts visible only to them.
7. **Allow your website**: *Authentication → Settings → Authorized domains → Add domain* and add where you host the app (e.g. `himanshubashambu08-star.github.io`). `localhost` is already allowed for testing.

Photos are compressed and stored in Firestore itself, so the free **Spark** plan is enough (1 GB ≈ several thousand receipts); no billing account needed.

If you already used the app on a device before signing in, it offers to copy those receipts into your account the first time you sign in there.

## Host it (GitHub Pages)

1. Merge this folder into `main`.
2. In the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/deploy-fuel-receipts.yml` publishes the app on every change to `petrol-receipts/`. It will be at
   `https://<your-github-username>.github.io/<repo>/` (shown in the Actions run).
4. Add that domain to Firebase *Authorized domains* (step 7 above).

Netlify or Vercel also work: drag the `petrol-receipts` folder onto <https://app.netlify.com/drop>.

## Run it locally
It's plain HTML/CSS/JS – no build step.

```bash
cd petrol-receipts
python3 -m http.server 8080
# open http://localhost:8080
```

On a phone, open the site and choose **Add to Home Screen** to install it as an app; it then works offline.

## How the numbers are calculated
For each receipt with total `T`, tax `X`, and business-use fraction `b`:

| | Not tax-registered | Registered (claims ITC/VAT) |
|---|---|---|
| Claimable expense | `T × b` | `(T − X) × b` |
| Tax credit | – | `X × b` |

If logbook km are entered for a tax year, `b = business km ÷ total km` for every receipt in that year.

> This tool organises your records; it isn't tax advice. Keep original receipts as your tax authority requires and confirm claim rules with your accountant.
