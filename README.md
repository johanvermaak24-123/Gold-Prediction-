# GOLD ORACLE v2 — GitHub-only build

This build is designed for **GitHub Pages + GitHub Actions only**. Netlify is not used.

## What is already built in
- 1H / 3H / 6H XAUUSD prediction horizons.
- Broad GDELT news scan plus official Federal Reserve and BLS RSS feeds.
- Attempts a deeper HTML read of the most relevant articles; blocked/paywalled pages safely fall back to headline evidence.
- Event clustering/deduplication so copies of the same story do not fake consensus.
- Source quality + recency weighting.
- Anti-flip confirmation: a new opposite bias must survive two qualified scans before the accepted bias reverses.
- BUY LIMIT / SELL LIMIT / WAIT, entry, invalidation, TP1/TP2/TP3, predicted range.
- Actual 5-minute XAU/USD candles on the prediction chart when a Twelve Data key is enabled.
- Forward proof engine: every qualified prediction is stored, later resolved against real 5-minute XAU/USD bars, and scored for direction, entry, TP, stop, MAE, MFE and timing.
- Self-learning feature reliability after 12 resolved examples and source reliability after 20.
- Confidence calibration by horizon after enough resolved forecasts.
- GitHub Actions state cache preserves the learning state between scheduled runs without filling your repo with automated commits.
- Manual-price mode still works when no market-data key has been added.

## One-time GitHub setup
1. Create a new repository and upload **the contents of this folder** to the repository root. `index.html` must be at the root.
2. In the repository go to **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. For fully automatic exact XAU/USD candles/outcome learning, go to **Settings → Secrets and variables → Actions → New repository secret**.
4. Name the secret exactly `TWELVE_DATA_API_KEY` and paste your Twelve Data key as the value.
5. Open **Actions → GOLD ORACLE live update + GitHub Pages → Run workflow** once. After that the scheduled workflow runs every 5 minutes (GitHub may delay scheduled jobs during high load).

If you do not add the market-data secret, GOLD ORACLE still scans news on GitHub Actions and the page accepts a manual XAUUSD price, but real candle/outcome learning stays paused.

## Files you should not remove
- `.github/workflows/oracle-pages.yml` — scans, learns and deploys.
- `scripts/` — server-side GitHub Actions brain; API keys never go into the browser.
- `assets/` — browser UI and safe order-map engine.
- `data/state.json` — seed state; GitHub Actions cache carries the live state after deployment.
- `config.json` — symbol, assumed spread and scan settings.

## Audit
Run with Node 20+:

```bash
npm run audit
```

The audit is a software robustness test, not proof of profitability. Real predictive performance appears in the app's Proof Engine only after forecasts actually reach their horizons.

## Optional one-time historical calibration (already built in)
You do **not** need another app version for historical testing. After `TWELVE_DATA_API_KEY` is configured, open the GitHub **Actions** tab, choose the GOLD ORACLE workflow, choose **Run workflow**, and set `bootstrap_days` from `1` to `7`.

The historical bootstrap uses archived GDELT headlines ending at each checkpoint and historical 5-minute XAU/USD bars. It intentionally uses **neutral learning weights while generating those past predictions**, then resolves them afterwards, so the prediction generation does not learn from a future outcome before making that same historical prediction. Checkpoints are six hours apart to reduce duplicated/overlapping evidence and API load.
