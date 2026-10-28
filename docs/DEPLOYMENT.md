# Deploying PokéVault

How to run your own copy on free hosting: the web app on GitHub Pages and the API on Cloudflare Workers with a D1 database. For running it on your own computer instead, see [Development in the README](../README.md#development).

You need [Node.js](https://nodejs.org) 22.12 or newer, a GitHub account, and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account.

## 1. Put the code on GitHub

Create a public repository (a fork of this one, or a new one) and push the code to it. GitHub Pages and Actions are free for public repositories.

## 2. Create the API on Cloudflare

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

Settings in `api/wrangler.jsonc`:

- `CURRENCY`: the currency the collection is valued in (GBP, USD, EUR, CAD or AUD).
- `ALLOWED_ORIGINS`: the web addresses allowed to call the API. Set it to your GitHub Pages address (or custom domain) and run `npm run deploy` again.
- `CATALOG_URL`: where your published card catalogue is (your GitHub Pages address followed by `/catalog`).
- `REGISTRATION`: `open` lets anyone create a *Pending* account; `closed` means only admins can create accounts.

To publish API changes later, run `npm run deploy` in `api/`. It applies any new database migrations and then publishes the Worker. Pushing to GitHub does not deploy the API unless you add the secrets below.

## 3. Turn on the website (GitHub Pages)

1. On GitHub: **Settings → Pages → Source: GitHub Actions**.
2. Push to `main`, or go to **Actions → Deploy web app → Run workflow**.

The workflow builds the card catalogue from TCGdex, runs the unit tests, builds the app and publishes it. It also runs every day to refresh prices and pick up new sets.

## 4. Create your admin account

Open the site and choose **Create account**. **The first account becomes the admin.** Everyone who signs up after that starts as *Pending* and can't see anything until an admin approves them under **Admin**. Admins can also add people themselves.

On a phone, open the site and **Add to Home Screen** (Safari: Share; Chrome: ⋮ → Install app).

## Optional extras

- **Deploy the API from GitHub automatically**: add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  - Create the token at *My Profile → API Tokens* using the "Edit Cloudflare Workers" template, and add *Account → D1 → Edit*.
  - After that, every push that changes `api/` redeploys it. Without the secrets, that workflow skips itself.
- **PriceCharting graded prices**: run `cd api && npx wrangler secret put PRICECHARTING_TOKEN` and paste your token. If a card is matched to the wrong PriceCharting product, editors can fix the match on the card's page.

## Costs and limits (free tiers)

- **GitHub Pages and Actions:** free for public repositories. GitHub pauses scheduled workflows after 60 days without activity in the repository; if that happens, re-enable "Deploy web app" in the Actions tab.
- **Cloudflare Workers:** 100,000 requests a day.
- **Cloudflare D1:** 5 GB of storage and millions of reads a day, which is plenty for a personal collection.
