# PokéVault user guide

How to use the app: scanning, the collection, binders, the want list, prices and accounts. For what the project is and how it is built, see the [README](../README.md). For setting up your own copy, see [Deploying PokéVault](DEPLOYMENT.md).

## Contents

- [Adding cards](#adding-cards)
- [The collection](#the-collection)
- [Binders](#binders)
- [Want list](#want-list)
- [Prices and currency](#prices-and-currency)
- [Sets and artists](#sets-and-artists)
- [Accounts and roles](#accounts-and-roles)
- [Keeping data safe](#keeping-data-safe)
- [Scanning tips](#scanning-tips)

## Adding cards

- **Scan** a card with your phone camera. Hold it in view at any angle and **auto-scan** recognises it by its picture, usually in under a second. You can also tap the shutter or use a photo. Or **search** by name, set or number (`charizard 4/102`).
- **Scan a whole binder page**: tap **Binder page** above the camera and pick 9, 12 or 4 pockets a page. Line the page up with the grid and take one photo, or use a photo you have.
  - Every card on it is recognised from its picture.
  - Cards found are ticked and named on the photo. A likely one says "probably" and waits for your tick. A pocket it can't read is marked ?.
  - Where reprints share a picture, pick which one from the list.
  - **Add to the list** puts them in the scan list, and the camera is ready for the next page. Check the list (printing, condition), then add them all at once.
  - How this was tested, and its limits, are in [the page-scan evaluation](../eval/page-scan/README.md).
- **Scan a stack**: switch the scanner to **Stack of cards** and show your cards one after another. Each card found asks a quick yes (**✓ Add to list**), then goes in a list while the camera carries on with the next one. Then check the list (printing, condition, quantity, estimated value) and add every card at once.
- **Confirm before adding**: pick the printing (normal, holo, reverse, 1st edition or a special printing such as a cosmos holo), the **language** it's printed in (English, French, German, Italian, Spanish or Portuguese), raw condition or graded slab (PSA, BGS, CGC, SGC, TAG, ACE), quantity and what you paid. Then review and confirm.

## The collection

- Every card shows its **image, name, set, number** and **price**. Totals for the whole collection are at the top.
- **Duplicates share one entry**: another copy of a card you already have (same printing and condition or grade) is counted with it, so you see one entry ×2, not two entries. Copies with a different price paid, purchase date, notes or cert number keep their own entry, so those details aren't lost.
  - **Dupes** (next to All / Raw / Graded) shows only the cards you have more than one of, with how many spare copies that is and what they're worth (keeping your most valuable copy of each): your trade pile.
  - Sort by **Copies: most → least** to see the cards you have most of first, each with its total copies and value.
  - If older duplicate entries are still separate, the collection page offers to **Combine** them, and so does **Account → Duplicate entries**. The number of cards stays the same.
- It works like an app on your phone: **Add to Home Screen** and it opens full screen, even offline.

## Binders

Your real binders, page by page, are in the **Binders** tab.

- They stand on a **bookshelf**, each spine in its colour (12 to choose from), thicker the more pages it has. Hover over one, or tap it, to see its name, how full it is, what's in it worth and what completing it would cost. Tap it again (or **Open binder**) to open it. Prefer a plain list? Switch to **List**.
- **Put them in order** by dragging a binder along the shelf (or to another shelf); the others slide over to make room. On a phone, tap **Arrange** first so dragging doesn't scroll the page. While arranging, the arrow keys move a binder too. The order is saved for everyone, and the list follows it.
- Make one from **a set** (every Paradox Rift card in number order), from **a Pokémon** (every Shuckle, 9 copies of each), or start empty. Pages hold 4, 9 or 12 pockets. Pick how many printings:
  - **One of each**: each card in its main printing (regular, or holo for holo rares).
  - **Master set**: every printing from the set's packs, side by side (regular and reverse holo, holo and reverse holo, 1st Edition, and pack patterns like Prismatic Evolutions' Poké Ball and Master Ball reverse holos).
  - **Grand master set**: the master set, then everything the packs don't have, at the end.
    - First come the **promo versions** of the set's own cards: cosmos and other special holos from blister packs and boxes, stamped ones (a set logo from Build & Battle boxes, GameStop, EB Games, staff, prerelease) and the non-holo theme-deck versions of holo rares.
    - Then come the set's **stamped promo cards**: its Build & Battle and prerelease promos from the Black Star Promos, stamped with the set's logo.
    - Their pockets say "promo".
- Each pocket shows its card in colour when the collection has a copy in that printing, and greyed out when it doesn't. The same is shown without colour too:
  - Each page says how many of its pockets are filled, for example "6/9".
  - Editors see the number of copies under each card.
  - Screen readers announce each pocket as "You have it" or "Missing".
  - **Missing** lists every empty pocket.
- A footnote under each pocket says which printing goes there (Regular, Holo, Reverse Holo…). Each copy fills one pocket, so 4 Shuckles fill 4 of the 9 kept for that card.
- **+ and −** under each card (and in **Missing**) add a copy in that printing to the collection (raw, near mint, English) or take one out, in one tap. The pocket changes at once. − takes out the raw copy added last; a graded slab is only taken out on its own page.
- **Scan a whole page**: tap **Scan** on a page, line the real page up with the grid (each pocket labelled with its card's number) and take one photo, or use a photo you already have.
  - Every pocket is checked against the card that goes in it, so the printing is the pocket's (a reverse holo and a regular one look the same).
  - Cards found are ticked. A pocket it isn't sure about (empty, glare) is marked ?, and a different card is named (wrong pocket?).
  - Tap any pocket to tick or untick it, then **Add** puts the ticked cards in the collection in one go.
- **Missing** lists what's still needed, with the page and pocket it goes in and roughly what completing the binder would cost.
- **Edit** changes the copies of single cards, their printing and order, and adds cards by search. Each card shows the page and pocket it starts at.
- On a big screen, pages sit side by side like the open binder, with page 1 opposite the inside cover.

## Want list

The **Wants** tab lists every card you still need, set by set, and what getting them would cost.

- Every empty pocket in your binders is on it automatically. Add any other card with **♡ Want it** on its page: pick the printing, how many copies, how much you want it (**★★★ Must have**, **★★ Want**, **★ Someday**), the most you'd pay, and a note. Copies you already have count towards both.
- Each set shows its logo, how much of it you have, the cards still to get and what they cost. Cards are priced for the printing wanted once the app has fetched that card's prices; until then ≈ marks the price of its usual printing.
- At the top: what everything costs, what the must-haves cost, and the priciest card. A card at or under the most you'd pay is marked as a **Deal**.
- **Budget planner**: put in what you have to spend.
  - It keeps a **buffer** back for prices moving and postage: 10% unless you pick 0, 5, 15 or 20%.
  - It then picks the best cards for the rest, in one of three ways:
    - **Must-haves first**: as many must-haves as it can, cheapest first, then wants, then somedays.
    - **Most cards**: cheapest first.
    - **Biggest cards**: the most valuable that fit.
  - It shows how many cards that is, the spend per priority, the shopping list with each card's priority and price, and the next card just out of reach with how much more it would take.
  - **In budget** shows just those cards.
- Tap a card for its price, where it goes in your binders, links to Cardmarket, TCGplayer and eBay, and **✓ Bought it**, which adds a copy to the collection.
- **Copy list** copies the list (or the shopping list) as text, set by set.

## Prices and currency

- **Raw prices** (TCGplayer and Cardmarket) refresh when you open the app, and the app keeps its **own price history**.
- **Language**: TCGplayer only sells English cards, so English copies are valued from it. French, German, Italian, Spanish and Portuguese copies are valued from Cardmarket, where those languages trade. Cardmarket's price covers a card in any language, and the app says so ("Cardmarket trend (all languages)").
- **Your currency**: everything is shown in **GBP** by default. Anyone can switch to USD, EUR, CAD or AUD under **Account → Currency**. Prices are converted with the European Central Bank's daily rates. Logged sales and purchase prices remember the currency they were entered in.
- **Graded prices**: log eBay sold prices (one tap opens eBay's *sold* listings for that exact card and grade). Optional PriceCharting support fills in PSA, BGS, CGC and SGC prices automatically.

### Where prices come from

| Price | Source | Notes |
|---|---|---|
| Raw market price | TCGplayer (USD), via TCGdex; Cardmarket (EUR), from Cardmarket's own daily price guide through the catalogue's checked links | Refreshed for cards in the collection when you open the app (if more than 6 hours old) and at least daily in the background. A special printing (a cosmos holo, a stamped version) is priced from its own Cardmarket product; until it has one, its plain printing's price is used, and the app says so. |
| Set values | The same market prices for every card in the catalogue | One near-mint copy of each card's standard printing. Refreshed when the site rebuilds. |
| eBay "last sold" | You log them in the app | eBay has no public sold-listings API, so each grade has a one-tap link to eBay's sold results. |
| Graded price points | PriceCharting (optional) | Needs a paid PriceCharting subscription. |
| Exchange rates | European Central Bank daily reference rates | The API fetches them twice a day. |

**How a copy is valued:**

- **Raw:** the TCGplayer market price for that exact printing, then PriceCharting ungraded, then Cardmarket's trend price, then your logged sales.
- **Graded:** the median of your recent logged sales for that grade (last 180 days), then PriceCharting, then older sales.

## Sets and artists

- **Sets**: every set in the **Sets** tab, with how close you are to completing it, what the whole set is worth at market prices, what your cards from it are worth, and what completing it would cost. Open a set to see every card in number order, with its price and the ones you're missing greyed out. Choose **Owned** or **Missing** to list only those, and the page says how many of the set's cards you have.
- **Artists** (under the **Sets** tab): sort your collection by illustrator, browse every artist's cards and see which ones you own.

## Accounts and roles

| Role | Can do |
|---|---|
| Pending | Nothing yet: waiting for an admin to approve |
| Viewer | Browse the collection, prices and artists |
| Editor | Everything a viewer can, and add, edit and remove cards, log sales, refresh prices and restore removed cards |
| Admin | Everything an editor can, and manage users and roles, reset passwords, empty the trash, see the activity log and download backups |

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

- Show the card to the camera with the whole card in view, keep it flat, and avoid glare from holo foil. It doesn't need to fill the frame or be straight. The light button helps in dim rooms.
- The scanner outlines the card it has found, straightens it, and compares its picture with every card in the catalogue several times a second.
- **Auto-scan** is on by default, so you don't need to press anything.
  - A close, clear picture match is picked straight away, upside down too.
  - **Glare** and shaky hands can stop any single look from being sure, so the scanner also compares the last few looks and picks the card that stays clearly closest across them. Tilting the card a little helps, as the glare moves.
  - **Sleeves and top loaders**: the edge found can be the sleeve's, not the card's. When the picture inside that edge doesn't match well, it also tries the card inside the margins sleeves leave, and keeps whichever matches best. On a busy, colourful surface the edge of a top loader can be missed altogether: a plain table works best.
  - **A card in a binder pocket** sits among other edges, and the most card-shaped outline is often the pocket itself. When the picture inside that outline doesn't match well, the scanner tries the other outlines it found. Point the camera at one card, so it fills most of the view.
  - **Reprints** share their artwork with other printings (Base Set and Base Set 2 Charizard, say), so the scanner then reads the printed number or set. That small print needs a sharp picture, so it asks you to hold still for a moment. When the card is still enough, the outline turns green and the message under the camera changes from "Hold the card steady…" to "Reading…". Screen readers announce the message.
  - It never picks a card it isn't sure of. If it can't be, it keeps trying on new frames; tap the shutter to see the closest matches yourself.
  - **Scan again** won't pick up the same card while it's still in view.
  - Turn it off with the **Auto-scan** button under the camera.
- If the card's outline can't be found (a white card on a white table, say), it reads the card inside the on-screen frame instead: its **name and HP** at the top and the **number, set size or set code** at the bottom.
- Nothing is added until you tap a match, review the details and press **Confirm & add**.
- **Scanning a stack** (choose **Stack of cards** above the camera):
  - Each card the scanner is sure of pops up over the camera: tap **✓ Add to list** and it goes in. If the card comes in more than one printing, pick which this copy is first. **Not it** shows its other matches, or skips it. The bar under the camera shows the last card added, with **Undo**.
  - Take each card out of view before showing the next. The same card shown again after it has left the view counts as another copy.
  - The **List** tab keeps the cards on your phone until you add them, even if you close the app. Change the count with − and +, tap **Split** to share several copies between printings, or tap **Edit** for the printing, a graded slab, the price you paid or notes. Then press **Add … to the collection** and confirm once.
  - If a card can't be added (no connection, say), it stays in the list with the reason, so you can try again.
- If the scan isn't sure, tap **Search instead**. Your words are pre-filled, so you can fix a letter or two.
