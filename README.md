# PokéVault — Pokémon Card Scanner & Tracker

A phone-friendly web app for tracking a Pokémon card collection:

- **Scan** a card with your phone camera: hold it in view, at any angle, and **auto-scan** recognises it by its picture, usually in under a second (or tap the shutter, or use a photo). Or **search** by name / set / number (`charizard 4/102`).
- **Scan a stack**: switch the scanner to **Stack of cards** and show your cards one after another. Each card found goes in a list and the camera carries on with the next one. Then check the list (printing, condition, quantity, estimated value) and add every card at once.
- **Confirm before adding**: pick the printing (normal, holo, reverse, 1st edition), raw condition or graded slab (PSA, BGS, CGC, SGC, TAG, ACE), quantity and what you paid, then review and confirm.
- **Duplicates share one entry**: another copy of a card you already have (same printing and condition or grade) is counted with it, so you see one entry ×2, not two entries. Copies with a different price paid, purchase date, notes or a cert number keep their own entry, so those details aren't lost.
  - **Dupes** (next to All / Raw / Graded) shows only the cards you have more than one of, with how many spare copies that is and what they're worth (keeping your most valuable copy of each): your trade pile.
  - Sort by **Copies: most → least** to see the cards you have most of first, each with its total copies and value.
  - If older duplicate entries are still separate (added before copies were counted together, or edited to match), the collection page offers to **Combine** them, and so does **Account → Duplicate entries**. The number of cards stays the same.
- **Binders**: your real binders, page by page, under **Sets → Binders**.
  - Make one from **a set** (every Paradox Rift card in number order, or the master set with every printing side by side), from **a Pokémon** (every Shuckle, 9 copies of each), or start empty. Pages hold 4, 9 or 12 pockets.
  - Each pocket shows its card in colour when the collection has a copy in that printing, greyed out when it doesn't, with a footnote saying which printing goes there (Regular, Holo, Reverse Holo…). Each copy fills one pocket, so 4 Shuckles fill 4 of the 9 kept for that card.
  - **Missing** lists what's still needed, with the page and pocket it goes in and roughly what completing the binder would cost.
  - **Edit** changes the copies of single cards (18 of some), their printing and order, and adds cards by search. Each card shows the page and pocket it starts at.
  - On a big screen, pages sit side by side like the open binder, page 1 opposite the inside cover.
- Every card shows its **image, name, set, number** and **price**. Totals for the whole collection are at the top.
- **Raw prices** (TCGplayer + Cardmarket) refresh when you open the app, and the app keeps its **own price history**.
- **Your currency**: everything is shown in **GBP** by default. Anyone can switch to USD, EUR, CAD or AUD under **Account → Currency**.
  - Prices are converted with the European Central Bank's daily rates.
  - Logged sales and purchase prices remember the currency they were entered in.
  - eBay links open your local eBay (ebay.co.uk for GBP).
- **Graded prices**: log eBay sold prices (one tap opens eBay's *sold* listings for that exact card and grade). Optional PriceCharting support fills in PSA/BGS/CGC/SGC prices automatically.
- **Sets**: every set (Paradox Rift, 151, Base Set…) in the **Sets** tab, with how close you are to completing it, what the whole set is worth at market prices, what your cards from it are worth, and what completing it would cost. Open a set to see every card in number order, with its price and the ones you're missing greyed out. You can also sort a set by price.
- **Artists**: sort your collection by illustrator, browse every artist's cards and see which ones you own. Each card links to Serebii and Art of Pokémon.
- **Login + roles (RBAC)**: Admin, Editor, Viewer and Pending, plus an activity log, a "recently removed" trash and backups.
- Works like an app on your phone: **Add to Home Screen** and it opens full screen, even offline.

## How it fits together

```
 Phone / browser                     GitHub                         Cloudflare (free)
┌──────────────────┐  served by  ┌──────────────────────┐        ┌───────────────────────────┐
│  PokéVault app   │◄────────────│ GitHub Pages          │        │ PokéVault API (Worker)    │
│  (React PWA)     │             │  • the web app        │        │  • login, roles, sessions │
│  • camera, card  │             │  • our card catalog   │        │  • collection, sales      │
│    recognition   │── API ─────────────────────────────────────►│  • prices + history       │
└──────────────────┘             │ GitHub Actions        │        │ D1 database (SQLite)      │
                                 │  • builds catalog     │        │ hourly price refresh      │
                                 │    weekly + deploys   │        └────────────┬──────────────┘
                                 └──────────┬───────────┘                     │
                                            └──── open card data ───► TCGdex ◄┘
```

- **`web/`**: the app (React + TypeScript + Vite). Card recognition runs **on the phone**, so photos are never uploaded: it finds the card in the camera picture, straightens it, matches its picture against every card, and reads the printed number with Tesseract OCR when that's needed.
- **`api/`**: our own API, a Cloudflare Worker with a D1 database. GitHub Pages can only host static files, so the part that stores data lives on Cloudflare's free tier.
- **`scripts/build-catalog.mjs`**: builds **our own card catalog** (≈21,000 cards, 205 sets, 400 artists) from the open [TCGdex](https://tcgdex.dev) data, plus a **fingerprint of every card's picture** (`prints.bin`, about 750 KB) that the scanner matches against, and **every card's market price** (`prices.json`, about 210 KB) for set values. GitHub Actions rebuilds them every week, and the app searches, identifies scans and values sets with them with no third-party API calls.
- **`shared/`**: code used by both: grading scales, how a copy is valued, and outbound links.

### Where prices come from

| Price | Source | Notes |
|---|---|---|
| Raw market price | TCGplayer (USD) + Cardmarket (EUR), via TCGdex | Automatic for cards in your collection: refreshed when you open the app if they're more than 6 hours old, and at least daily in the background. If TCGdex leaves a source out of a response (it sometimes does), the last prices from that source are kept. |
| Set values | The same market prices for every card in the catalog | One near-mint copy of each card's standard printing. Refreshed weekly when the site rebuilds. |
| eBay "last sold" | **You log them** in the app | eBay closed its public sold-listings API in 2025 and doesn't allow scraping. Each grade has a one-tap link to eBay's sold results. |
| Graded price points | PriceCharting (optional) | Needs a paid PriceCharting subscription. Their prices are built from eBay sales. |
| Exchange rates | European Central Bank daily reference rates | Free. Our API fetches them twice a day and converts USD/EUR prices into your currency. |

**How a copy is valued:**
- **Raw:** TCGplayer market price for that exact printing, then PriceCharting ungraded, then Cardmarket's trend price (for cards TCGplayer doesn't list), then your logged sales.
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

> **Already done for this repo.** The API is live at **https://pokevault-api.pokevault-api.workers.dev**, using the D1 database whose id is in `api/wrangler.jsonc`.
>
> To publish API changes later, run `cd api && npm run deploy`. That applies any new database migrations and then publishes the Worker.

Setting it up from scratch (e.g. for a fork):

```bash
npm install
cd api
npx wrangler login                                       # opens the browser once
npx wrangler d1 create pokevault --no-update-config      # creates the database
```

Copy the `database_id` it prints into `api/wrangler.jsonc`. Then deploy:

```bash
npm run deploy                     # creates the tables, then publishes the API
```

It prints your API address. Put it in `web/.env.production` as `VITE_API_URL=…`.

The collection is valued in **GBP** (`"CURRENCY"` in `api/wrangler.jsonc`: GBP, USD, EUR, CAD or AUD). `api/wrangler.jsonc` also already allows requests from `https://iiryzii.github.io`. If you use a different GitHub username or a custom domain, update `ALLOWED_ORIGINS` and run `npm run deploy` again.

### 3. Turn on the website (GitHub Pages)

1. On GitHub: **Settings → Pages → Source: GitHub Actions**.
2. Push to `main`, or go to **Actions → Deploy web app → Run workflow**.

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

- Show the card to the camera with the whole card in view, keep it flat, and avoid glare from holo foil. It doesn't need to fill the frame or be straight. The flashlight button helps in dim rooms.
- The scanner outlines the card it has found, straightens it, and compares its picture with every card in the catalog several times a second.
- **Auto-scan** is on by default, so you don't need to press anything.
  - A close, clear picture match is picked straight away, usually in under a second, upside down too. You don't need to hold still: a little hand shake or blur doesn't stop the picture matching.
  - Reprints share their artwork with other printings (Base Set and Base Set 2 Charizard, say), so the scanner then reads the printed number or set to tell which one you have. It only reads the name line at the top and the corner with the number at the bottom, never the moves. That small print needs a sharp picture, so it asks you to hold still for a moment ("Looks like Charizard. Hold it still a moment…"); the outline turns green when it's still enough.
  - It never picks a card it isn't sure of. If it can't be, it keeps trying on new frames; tap the shutter to see the closest matches yourself.
  - **Scan again** won't pick up the same card while it's still in view. Swap in the next card and it carries on.
  - Turn it off with the **Auto-scan** button under the camera. The app remembers your choice.
- If the card's outline can't be found (a white card on a white table, say), it reads the card inside the on-screen frame instead, from its **name and HP** at the top and the **number / set size / set code** at the bottom (`025/165`, `MEW`, `TG05/TG30`, `SWSH050`).
- Photos work the same way: the card can be anywhere in the photo.
- Nothing is added until you tap a match, review the details and press **Confirm & add**.
- **Scanning a stack** (choose **Stack of cards** above the camera):
  - Each card the scanner is sure of goes straight into the list, with a buzz, and the bar under the camera shows it. Tap **Undo** if it's wrong. If the scanner isn't sure, tap the shutter and pick the match: it goes in the list too.
  - Take each card out of view before showing the next. The same card shown again after it has left the view counts as another copy. Two copies of the same card in a row only count as two if the view is clear between them, so check the counts in the list.
  - The **List** tab keeps the cards on your phone until you add them, even if you close the app. Every card starts as raw, Near Mint, in its first printing. Change the count with − / +, or tap **Edit** for the printing, a graded slab, the price you paid or notes. Then press **Add … to the collection** and confirm once. Cards you already have are counted with your existing copies.
  - If a card can't be added (no connection, say), it stays in the list with the reason, so you can try again.
- If the scan isn't sure, tap **Search instead**. Your words are pre-filled, so you can fix a letter or two.

## Local development

```bash
npm install
npm run dev:api   # API on http://127.0.0.1:8787 with a local database (Ctrl+C to stop)
npm run dev:web   # app on http://localhost:5173 (builds the catalog the first time)
```

For local development, create `web/.env.local` containing `VITE_API_URL=http://127.0.0.1:8787`, or paste that address on the sign-in screen.

```bash
npm test                    # unit tests: values, OCR parsing, search, card finding & picture matching
npm run typecheck           # TypeScript for web + api
cd api && npm test          # end-to-end API test — needs a fresh `npm run dev:api` (delete api/.wrangler first)
npm run catalog             # rebuild the card catalog and picture fingerprints from TCGdex
```

The first `npm run catalog` downloads every card's small picture (about 20,000 images) to fingerprint them, which takes around 10 minutes. After that, fingerprints are reused and only new cards are downloaded. The weekly GitHub build reuses the ones already on your site. Without `prints.bin`, the scanner still works by reading the card's text.

Market prices for set values take one small request per card, sometimes three, because TCGdex leaves TCGplayer's prices out of some responses and the build asks again (a few minutes in all). They're reused while they're less than 6 days old, so only the weekly build refreshes them (`--prices-max-age-days` changes that).

To test on your phone before deploying, use the GitHub Pages URL. The camera and secure sign-in only work over `https://` or on `localhost`.

## Costs and limits (free tiers)

- **GitHub Pages / Actions:** free for public repos.
  - GitHub pauses scheduled workflows after 60 days without activity in the repo. If that happens, re-enable "Deploy web app" in the Actions tab (it only refreshes the card catalog).
- **Cloudflare Workers:** 100,000 requests/day.
- **Cloudflare D1:** 5 GB of storage and millions of reads per day. That's plenty for a personal collection.

## Credits

Card data and images come from [TCGdex](https://tcgdex.dev), an open-source Pokémon TCG database. Where TCGdex has no picture, the app tries [pokemontcg.io](https://pokemontcg.io)'s image instead. Exchange rates come from the [European Central Bank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html). Market prices are TCGplayer and Cardmarket data as published by TCGdex. Links go to eBay, PriceCharting, TCGplayer, Cardmarket, [Serebii](https://www.serebii.net/card/) and [Art of Pokémon](https://www.artofpkm.com/).

PokéVault is an unofficial fan project. Pokémon and all related names are trademarks of Nintendo, Creatures and GAME FREAK.
