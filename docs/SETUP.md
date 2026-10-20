# Putting the app online (one-time setup)

Everything runs on your existing Cloudflare account, on the free plan. Do these steps on a computer, in order, in a terminal opened in this project folder.

You need **Node.js 22** and your **Cloudflare login**. Step 5 also needs your **Anthropic API key**.

## 1. Install

```
npm install
npx wrangler login
```

`wrangler login` opens a browser so you can approve access to your Cloudflare account.

## 2. Database — done

The `budget-db` database was created on 18 Oct 2026 (Western Europe) and its tables are in place; its id is already in `wrangler.jsonc`. Migrations 0001–0003 are applied (0003, long receipts and feedback, on 19 Oct 2026). Future table changes are applied with `npm run migrate:remote` before the code that needs them is published.

## 3. Create the photo storage

```
npx wrangler r2 bucket create budget-receipt-images
```

If R2 has never been switched on for this account, Cloudflare asks you to enable it in the dashboard first (Dashboard → R2). It is free up to 10 GB, which is roughly 30,000 receipt photos.

## 4. Add the Claude API key (secret)

```
npx wrangler secret put ANTHROPIC_API_KEY
```

Paste the key when it asks. The key is stored encrypted by Cloudflare and never appears in the code.

**Recommended:** in the Anthropic Console (console.anthropic.com → Settings → Limits), set a monthly spend limit, for example $20. That caps any bill if something goes wrong.

## 5. Optional: stop strangers from signing up

The sign-up page is public. Anyone who finds the address could create an account and use your API credit. To require an invite code:

```
npx wrangler secret put SIGNUP_CODE
```

Choose any word or phrase and give it to the people you want to sign up.

## 6. Publish

```
npm run deploy
```

The command prints the app's address (`https://budget-receipttracker.<your-subdomain>.workers.dev`).

To use `budget.gitgdevelopments.com` instead, go to Cloudflare dashboard → Workers & Pages → budget-receipttracker → Settings → Domains & Routes → Add → Custom domain, and enter `budget.gitgdevelopments.com`. Cloudflare creates the DNS record itself.

## 7. First use

1. Open the address on your phone in Chrome.
2. Tap **Create an owner account**.
3. Tap ⋮ → **Add to Home screen**.
4. Go to **More → Exchange rates** and tap **Fetch now**. After that, rates update by themselves twice a day.
5. Go to **More → Categories** to set monthly budgets, and to add categories you need. Rent is not in the starting list, and your receipts include rent slips.

## Switching the model to Sonnet

If people report bad readings, change one line in `wrangler.jsonc`:

```
"EXTRACT_MODEL": "claude-sonnet-5-5"
```

Then run `npm run deploy` again. Sonnet costs about 20× more per receipt than Haiku. Both are still cents per hundred receipts (see the README).

## Testing the reader on real receipts before going live

1. Put 20–30 receipt photos (JPG/PNG) or small PDFs (under 10 MB each) in a folder called `test-receipts` inside this project. That folder is never uploaded to GitHub.
2. Run:

```
ANTHROPIC_API_KEY=sk-ant-... npm run test:extract -- ./test-receipts
```

It prints, for every receipt, the shop, date, currency, total and number of items. It flags any receipt where the items don't add up to the total, and shows the total cost. The full results are saved in `test-receipts/results.json`. Run it again with `claude-sonnet-5-5` at the end to compare the two models.

The scans in your Google Drive "Receipts" folder are multi-page PDFs of up to 106 MB. Those are too big for the app (10 MB limit) and for the Claude API (32 MB per request). Photograph the receipts individually, or split the PDFs into a few pages each.

## Checking it works (for a developer)

```
npm test                      # unit tests
npm run migrate:local
npx wrangler dev              # in a second terminal
node scripts/smoke.mjs        # 42 end-to-end API checks (run with NO .dev.vars: expects no reader key)
node scripts/ui-check.mjs .   # clicks through the screens on a phone-sized browser
DARK=1 node scripts/ui-check.mjs .   # same, in dark mode

# Reading credit, with a stand-in for Anthropic (no real API key or cost):
#   put ANTHROPIC_API_KEY=test and ANTHROPIC_BASE_URL=http://127.0.0.1:9999 in .dev.vars,
#   start node scripts/mock-anthropic.mjs and the dev server, then:
node scripts/smoke-credit.mjs # 10 checks: charge per reading, out of credit, top-up, unlimited
node scripts/smoke-parts.mjs  # 20 checks: long receipts, totals only, add a missed part, PDFs, feedback
node scripts/ui-check.mjs .   # with the stand-in running, also walks through the camera (fake camera)
```
