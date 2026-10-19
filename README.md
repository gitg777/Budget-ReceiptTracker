# Receipts & Budget

A phone app (installable web app) for tracking spending. You photograph a receipt; Claude reads the shop, date, currency, total and every line; you check it and save. The owner sees monthly reports in USD. Helpers (housekeeper, driver, manager) log their own receipts against an allowance.

Setup and publishing: **[docs/SETUP.md](docs/SETUP.md)**.

## What it does

| | Owner | Helper |
|---|---|---|
| Photograph / upload receipts (works with no signal) | ✓ | ✓ |
| Check and correct what was read, then save | ✓ | ✓ (changes are recorded with name and reason) |
| See own receipts | ✓ | ✓ |
| Allowance left, cash in hand, money owed back | — | ✓ |
| Cash-up at the press of a button | — | ✓ |
| Monthly report by category, budget vs actual, shops, people, 12-month trend | ✓ | — |
| "How much on milk?" search by item or shop | ✓ | — |
| Excel download (receipts, items, change history) | ✓ | — |
| Add helpers, set allowances, record cash given, pay back own-money receipts | ✓ | — |
| Exchange rates: automatic daily + own rate | ✓ | uses the owner's |

## How it is built, and why

- **Cloudflare Workers + D1 database + R2 photo storage.** This is the setup your driving-test app already runs on, so it costs $0 at this size and uses the same account. *Trade-off:* D1 is SQLite, not PostgreSQL. You approved this. It makes no difference at personal or household scale.
- **React + TypeScript + Tailwind**, built with Vite.
- **No signal? No problem.** Photos go into storage on the phone first, then upload when there is signal, so a power cut or a dead zone never loses a receipt. Photos are shrunk on the phone before sending: about 300 KB instead of 4 MB, to save data. Each photo carries a unique id, so a retry after a dropped connection never creates a duplicate.
- **Claude Haiku 5.5 reads the receipts** (your choice; switch to Sonnet with one setting). Claude's reply must match a fixed format, so a reply can't come back half-formed. One photo can hold several receipts. The reader is told never to copy airtime PINs, medical-aid numbers, meter numbers or ID numbers.
- **Every receipt keeps its own exchange rate**: the original amount, currency, rate, where the rate came from (automatic / own / printed on the receipt) and the rate's date. History is never recalculated when rates move.
- **Money is stored as whole cents**, so totals never drift from rounding.
- **Category reports are built from the items**, so a supermarket slip that mixes groceries, soap and nappies splits correctly. If the items don't add up to the receipt total (an unread line, rounding), the difference counts under the receipt's category. Monthly totals always match the receipts.
- **Audit trail.** Any change to a saved receipt is recorded with who, when, what (old → new) and an optional reason. So is any change to what Claude read off a photo. The photo stays linked, so the owner can always compare. Receipts that have been paid back are locked for helpers.
- **Logins.** Owners use email + password. Helpers use a username + PIN that the owner sets, so no email is needed. Passwords are stored as one-way hashes (PBKDF2). Eight wrong attempts lock that login for 15 minutes. Removing a helper logs them out at once.

## Helper allowance and cash: how the numbers work

The app tracks two separate things.

1. **Allowance**: a spending limit. It can be weekly, monthly, or one running float.
   - With *carry-over*, every period adds one allowance and anything unspent flows forward. Overspending carries forward too.
   - Without it, each period starts fresh.
2. **Cash in hand**: physical cash.
   - Calculated as: cash the owner recorded as given − change returned − receipts paid "from cash I was given" ± cash-up differences.

**Cash-up.** The helper counts their cash and enters it. Any difference from what the app expected is recorded openly as a "cash-up difference" for the owner to see. The helper can tick "handing the change back now".

**Running low.** When cash falls below $2, or below 10% of the allowance, the helper is prompted to cash up and ask for more cash. If they have to pay with their own money, they choose "My own money" on the receipt. The owner sees "You owe Grace $5" and taps **Paid back**.

## Exchange rates

- **Automatic source:** the open *currency-api* feed (fawazahmed0; free, no key). It covers ZWG and about 340 other currencies and updates daily. The app fetches it twice a day, with two mirror addresses and open.er-api.com as fallbacks.
- **Safety check:** a new rate that differs by more than 60% from the last stored rate is rejected. This protects your history from a bad feed day.
- **The retired ZWL** (old Zimbabwe dollar) value in the feed is ignored.
- **On each receipt** the app shows the rate of the day. You can tick the rate printed on the receipt, if there is one (ZESA tokens print one), or type your own. The owner can also save their own rate for a day, and receipts then default to it.

**What was checked, and what wasn't** (research on 18 Oct 2026):

- **Checked:** the feed's ZWG value matched First Capital Bank's interbank sheet to within 0.005% on 10 Jun 2025. It was within 0.1% of Trading Economics on 1 Apr 2026.
- **Unresolved:** one third-party site that claims to use RBZ differed by 2.7% on 9 Sep 2026.
- **Not checked:** the RBZ website itself was unreachable from the build environment. The feed is **not** an official RBZ publication. If you need the official RBZ rate exactly, enter it as your own rate.
- **Market (street) rates** are not fetched automatically. There is no stable source, and quoting them is sensitive. Use "my own rate" for those.

## Reading credit (what users pay)

- Every new account gets **$5 free reading credit** (`FREE_CREDIT_USD` in `wrangler.jsonc`).
- Each photo read is charged at **20× what Anthropic charges** (`MARKUP`), using the real token counts of that reading, and taken from the account's credit. Helpers draw on their owner's credit.
- When credit runs out, photos are refused with a "contact … to top up" message. Typing a receipt in by hand stays free. The photo is kept, so **Try again** works after a top-up.
- **Top-ups are done by the operator** (you) on the **More → Operator** screen: +$1 / +$5 / +$10 / +$20 or any amount, with a note (e.g. the EcoCash reference). The same screen shows every account's balance, what its readings cost you at Anthropic, and what was charged.
- Your own account (Home Budget) is set to **unlimited**, so you are never charged.
- The first real reading (19 Oct 2026) used 5,360 tokens in and 726 out on Haiku 5.5. That is $0.000899 at Anthropic and $0.018 at 20×, so $1 ≈ 55 receipts, $5 ≈ 278, $10 ≈ 556 and $20 ≈ 1,112. The app recalculates these estimates from each account's real readings as they build up.

## Cost of reading receipts

- **Prices:** Claude Haiku 5.5 is $0.10 per million tokens in and $0.50 per million out. This is from Anthropic's price list as published in October 2026, so check console.anthropic.com before relying on it.
- **Tokens per receipt:** a photo is roughly 1,500–3,000 tokens in and 500–1,500 out. That is an estimate, not measured on your receipts yet; `npm run test:extract` measures it.
- **Per receipt:** that works out to well under $0.01, so $100 of credit would cover tens of thousands of receipts.
- **Sonnet 5.5** is $2 / $10 per million, about 20× Haiku.
- **Not verified:** that your account holds $100 of credit. Please check it in the Anthropic Console.

## Project layout

```
worker/       API (Cloudflare Worker): login, receipts, Claude reading, rates, helpers, reports
shared/       money and allowance arithmetic used by both sides
src/          the phone app (React)
migrations/   database tables
scripts/      end-to-end checks, receipt-reading test, icon generator
tests/        unit tests (npm test)
```
