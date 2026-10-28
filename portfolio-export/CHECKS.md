# Accessibility and privacy checks

Checks on the portfolio documents, carried out on 28 October 2026 before submission.

## Scope and method

**Documents checked:**

- `README.md`
- `docs/USER_GUIDE.md`
- `docs/DEPLOYMENT.md`
- `docs/DATA_CARD.md`
- `docs/MODEL_CARD.md`
- `eval/page-scan/README.md`
- `portfolio-export/profile-README.md`

**Method:**

1. A script checked heading order, image alt text, link text, table header rows, words that describe colour, contact details and secrets, and US spellings.
2. Each flagged item was then reviewed by hand.
3. For secrets, the repository's whole git history (all commits) was also searched for access tokens, private keys, `.env` files and email addresses. That was a pattern search, not a dedicated secret scanner.

Results: **Pass** means no change was needed. **Fixed** means a problem was found and corrected. **Open** means it is left for the author to resolve or accept.

## Accessibility

| Check | Result | Evidence |
|---|---|---|
| Logical heading order | Pass | All 7 documents have one H1 first and no skipped heading levels (66 headings in all). |
| Descriptive link text | Fixed | No link uses vague text such as "here". One bare URL in the README (the local address of the app) was reworded with the address formatted as code. |
| Alt text on every image | Pass | The README's 6 screenshots each have alt text describing what the screen shows. They are also listed in text, in order. The other documents have no images. |
| Header rows on tables | Pass | All 14 tables have a header row with text in every column. |
| Nothing conveyed only by colour | Fixed | The user guide described three colour-only cues: greyed-out binder pockets, greyed-out cards on a set's page, and a scanner outline that turns green. Each now also gives the non-colour equivalent the app shows: page counts ("6/9"), copy numbers, screen-reader text, the Owned/Missing filter, and the scanner's status message. |
| Nothing conveyed only by images | Fixed | The architecture diagram now has an accessible title and description (Mermaid's `accTitle` and `accDescr`), as well as the numbered text description under it. It was also simplified into one top-to-bottom chain, because the first version's crossing lines and small text were hard to read when printed. Screenshots are described in text. |
| Plain, consistent UK English | Fixed | "Catalog" became "catalogue" 43 times in prose, and 7 more times in diagram labels and code comments. File names and commands (`catalog.json`, `npm run catalog`) were left unchanged. |

## Privacy

| Check | Result | Evidence |
|---|---|---|
| No contact details | Pass | Contact is by GitHub profile link only. No email address, phone number or postal address appears in any document. |
| No secrets | Pass | No API keys, tokens, private keys or `.env` files appear in the documents or anywhere in the git history. Deployment credentials are GitHub Actions secrets, and the PriceCharting token is a Cloudflare secret. |
| No personal data in screenshots | Pass | Screenshots were taken from a local copy of the API with its own empty database and a made-up "Demo Collector" account. Nothing came from the live site. |
| No personal data in test data | Pass | Test accounts use `example.com` addresses. The evaluation photos are generated from public card pictures. |
| No placement-confidential material | Pass | The profile names the London Borough of Hackney, Triple Solar and Paiger, with role titles and dates, plus one line on the Hackney work ("built a storytelling application, now moving towards deployment"), as approved. It contains no internal information, data or code from any placement. |
| Author email in commits | Fixed (new commits) | The 11 commits on `portfolio-element-b` use the GitHub no-reply address. The 27 earlier commits on `main` still show a personal email address; the history was deliberately not rewritten, because it is already public. |
| Live site not linked | Pass | The documents don't link the live site. Its registration is open, so a visitor who signs up would have their email address stored (see open items). |

## Open items

**Unconfirmed facts, marked "TODO (Ryley)" in the documents:**

- `docs/DATA_CARD.md`:
  - terms of use for TCGdex's data and pictures, pokemon-tcg-data, Cardmarket's price files, TCGplayer prices via TCGdex, PriceCharting and the ECB rates
  - where Cloudflare stores the database, and what its request logging keeps
  - a retention period for old data
- `docs/MODEL_CARD.md`: the licence of the OCR engine's English language data.
- `portfolio-export/profile-README.md`: a line describing Shiny-Tracker-App, and a link to the report.

**Known gaps, documented in the data card:**

- The live instance accepts sign-ups and has no privacy notice.
- Expired sessions and rate-limit records, which contain IP addresses, are never deleted.
- The audit log keeps a user's email address after the account is deleted.

**Limits of these checks:**

- The automated checks look at the Markdown text. They do not test the documents with a screen reader, check colour contrast, or check the app itself.
- The secret search was a manual pattern search, not a dedicated scanner.
