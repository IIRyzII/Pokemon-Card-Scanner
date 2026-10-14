# PokéVault — Pokémon Card Scanner & Tracker

A phone-friendly web app for tracking a Pokémon card collection:

- **Scan** a card with your phone camera (or a photo), or **search** by name / set / number (`charizard 4/102`).
- **Confirm before adding**: pick the printing (normal, holo, reverse, 1st edition), raw condition or graded slab (PSA, BGS, CGC, SGC, TAG, ACE), quantity and what you paid, then review and confirm.
- Every card shows its **image, name, set, number** and **price**. Totals for the whole collection are at the top.
- **Raw prices** (TCGplayer + Cardmarket) refresh daily, and the app keeps its **own price history**.
- **Graded prices**: log eBay sold prices (one tap opens eBay's *sold* listings for that exact card and grade). Optional PriceCharting support fills in PSA/BGS/CGC/SGC prices automatically.
- **Artists**: sort your collection by illustrator, browse every artist's cards and see which ones you own. Each card links to Serebii and Art of Pokémon.
- **Login + roles (RBAC)**: Admin, Editor, Viewer and Pending, plus an activity log, a "recently removed" trash and backups.
- Works like an app on your phone: **Add to Home Screen** and it opens full screen, even offline.

## How it fits together

```
 Phone / browser                     GitHub                         Cloudflare (free)
┌──────────────────┐  served by  ┌──────────────────────┐        ┌───────────────────────────┐
│  PokéVault app   │◄────────────│ GitHub Pages          │        │ PokéVault API (Worker)    │
│  (React PWA)     │             │  • the web app        │        │  • login, roles, sessions │
│  • camera + OCR  │             │  • our card catalog   │        │  • collection, sales      │
│    on the phone  │── API ─────────────────────────────────────►│  • prices + history       │
└──────────────────┘             │ GitHub Actions        │        │ D1 database (SQLite)      │
                                 │  • builds catalog     │        │ hourly price refresh      │
                                 │    weekly + deploys   │        └────────────┬──────────────┘
                                 └──────────┬───────────┘                     │
                                            └──── open card data ───► TCGdex ◄┘
```

- **`web/`**: the app (React + TypeScript + Vite). Card recognition runs **on the phone** with Tesseract OCR, so photos are never uploaded.
- **`api/`**: our own API, a Cloudflare Worker with a D1 database. GitHub Pages can only host static files, so the part that stores data lives on Cloudflare's free tier.
- **`scripts/build-catalog.mjs`**: builds **our own card catalog** (≈21,000 cards, 205 sets, 400 artists) from the open [TCGdex](https://tcgdex.dev) data. GitHub Actions rebuilds it every week, and the app searches and identifies scans against it with no third-party API calls.
- **`shared/`**: code used by both: grading scales, how a copy is valued, and outbound links.

### Where prices come from

| Price | Source | Notes |
|---|---|---|
| Raw market price | TCGplayer (USD) + Cardmarket (EUR), via TCGdex | Automatic, refreshed daily for cards in your collection |
| eBay "last sold" | **You log them** in the app | eBay closed its public sold-listings API in 2025 and doesn't allow scraping. Each grade has a one-tap link to eBay's sold results. |
| Graded price points | PriceCharting (optional) | Needs a paid PriceCharting subscription. Their prices are built from eBay sales. |

**How a copy is valued:**
- **Raw:** TCGplayer market price for that exact printing, then PriceCharting ungraded, then your logged sales.
- **Graded:** median of your recent logged sales for that grade (last 180 days), then PriceCharting, then older sales.

## Set it up (one time, about 15 minutes, all free)

You need [Node.js](https://nodejs.org) 22.12 or newer, a GitHub account, and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account.

### 1. Put the code on GitHub

Create a **public** repository named `Pokemon-Card-Scanner` on GitHub, then from this folder:

```bash
git remote add origin https://github.com/IIRyzII/Pokemon-Card-Scanner.git
git add -A && git commit -m "PokéVault"
git push -u origin main
```

### 2. Create the API on Cloudflare

```bash
npm install
cd api
npx wrangler login                 # opens the browser once
npx wrangler d1 create pokevault   # creates the database
```

Copy the `database_id` it prints into `api/wrangler.jsonc`, replacing the zeros. If Wrangler offers to add the binding for you, say **no**: it's already there. Then deploy:

```bash
npm run deploy                     # creates the tables, then publishes the API
```

It prints your API address, e.g. `https://pokevault-api.<your-subdomain>.workers.dev`.

`api/wrangler.jsonc` already allows requests from `https://iiryzii.github.io`. If you use a different GitHub username or a custom domain, update `ALLOWED_ORIGINS` and run `npm run deploy` again.

### 3. Turn on the website (GitHub Pages)

1. On GitHub: **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**: name `API_URL`, value the address from step 2.
3. **Actions → Deploy web app → Run workflow**.

Your app will be at **https://iiryzii.github.io/Pokemon-Card-Scanner/**.

### 4. Create your admin account

Open the site and choose **Create account**. **The first account becomes the admin.** Everyone who signs up after you starts as *Pending* and can't see anything until you approve them under **Admin**. You can also add people yourself there.

On your phone, open the site and **Add to Home Screen** (Safari → Share; Chrome → ⋮ → Install app).

### Optional extras

- **Deploy the API from GitHub automatically**: add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  - Create the token at *My Profile → API Tokens* using the "Edit Cloudflare Workers" template, and add *Account → D1 → Edit*.
  - After that, every push that changes `api/` redeploys it. Without the secrets, that workflow just skips.
- **PriceCharting graded prices**: run `cd api && npx wrangler secret put PRICECHARTING_TOKEN` and paste your token.
  - If a card is matched to the wrong PriceCharting product, editors can fix the match on the card's page.
- **Close public sign-ups**: set `"REGISTRATION": "closed"` in `api/wrangler.jsonc` and redeploy. Only admins can create accounts after that.

## Roles

| Role | Can do |
|---|---|
| **Pending** | Nothing yet. Waiting for an admin to approve. |
| **Viewer** | Browse the collection, prices, artists |
| **Editor** | Viewer + add / edit / remove cards, log sales, refresh prices, restore removed cards |
| **Admin** | Editor + manage users and roles, reset passwords, empty the trash, activity log, backups |

The API enforces roles on every request, so hiding a button in the app is never the only protection. The last active admin can't be demoted, disabled or deleted.

## Keeping data safe

- Data lives in Cloudflare D1. On the free plan, D1 Time Travel can roll the database back to any point in the last 7 days.
- Removing a card moves it to **Recently removed**, and only an admin can delete it for good.
- Every change is recorded in the **activity log** (who, what, when).
- **Admin → Backups** downloads everything as JSON, or the collection as CSV.
- **Passwords** never leave the device. The browser stretches them with PBKDF2-SHA256 (600,000 rounds), and the server stores only a salted hash of the result.
- **Sessions** are random tokens, stored only as hashes and valid for 30 days.
- **Brute-force protection:** sign-in attempts are rate-limited, and an account locks for 15 minutes after 8 wrong passwords.

## Scanning tips

- Fill the on-screen frame with the card, keep it flat, and avoid glare from holo foil. The flashlight button helps in dim rooms.
- The scanner reads the **name and HP** at the top and the **number / set size / set code** at the bottom (`025/165`, `MEW`, `TG05/TG30`, `SWSH050`). It then shows the closest matches with pictures.
- Nothing is added until you tap a match, review the details and press **Confirm & add**.
- If the scan isn't sure, tap **Search instead**. Your words are pre-filled, so you can fix a letter or two.

## Local development

```bash
npm install
npm run dev:api   # API on http://127.0.0.1:8787 with a local database (Ctrl+C to stop)
npm run dev:web   # app on http://localhost:5173 (builds the catalog the first time)
```

For local development, create `web/.env.local` containing `VITE_API_URL=http://127.0.0.1:8787`, or paste that address on the sign-in screen.

```bash
npm test                    # unit tests: values, OCR parsing, search & card identification
npm run typecheck           # TypeScript for web + api
cd api && npm test          # end-to-end API test — needs a fresh `npm run dev:api` (delete api/.wrangler first)
npm run catalog             # rebuild the card catalog from TCGdex
```

To test on your phone before deploying, use the GitHub Pages URL. The camera and secure sign-in only work over `https://` or on `localhost`.

## Costs and limits (free tiers)

- **GitHub Pages / Actions:** free for public repos.
  - GitHub pauses scheduled workflows after 60 days without activity in the repo. If that happens, re-enable "Deploy web app" in the Actions tab (it only refreshes the card catalog).
- **Cloudflare Workers:** 100,000 requests/day.
- **Cloudflare D1:** 5 GB of storage and millions of reads per day. That's plenty for a personal collection.

## Credits

Card data and images come from [TCGdex](https://tcgdex.dev), an open-source Pokémon TCG database. Market prices are TCGplayer and Cardmarket data as published by TCGdex. Links go to eBay, PriceCharting, TCGplayer, Cardmarket, [Serebii](https://www.serebii.net/card/) and [Art of Pokémon](https://www.artofpkm.com/).

PokéVault is an unofficial fan project. Pokémon and all related names are trademarks of Nintendo, Creatures and GAME FREAK.
