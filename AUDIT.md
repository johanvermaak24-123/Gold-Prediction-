# GOLD ORACLE v2 — software audit

This audit checks calculation invariants and runtime robustness. It **does not** claim that gold predictions are profitable or certain.

## Tests
- 10,000,000 randomized plan builds across price, spread, horizon, confidence, conflict, directional score, volatility and anti-flip states.
- 250,000 randomized headline-feature fuzz cases.
- 100,000 randomized forward-outcome resolver cases.
- JavaScript syntax checks for browser and GitHub Actions scripts.
- GitHub Pages path review: all browser assets/data use relative paths, so repository Pages (`username.github.io/repository/`) works.
- No Netlify files or Netlify endpoints are required.

The exact observed results from the packaged build are recorded below after the audit runner is executed.

## Observed packaged-build result
- Randomized plan iterations: **10,000,000**
- BUY LIMIT plans: **1,191,145**
- SELL LIMIT plans: **1,192,703**
- WAIT / rejected: **7,616,152**
- Invalid plan structures: **0**
- Uncaught plan-engine crashes: **0**
- Headline-feature fuzz cases: **250,000** — failures **0**
- Outcome-resolver fuzz cases: **100,000** — failures **0**

The live updater was also executed with no market API key/network access; it failed closed into manual-price mode instead of fabricating market data.

## Historical bootstrap design review
The packaged build also contains `scripts/bootstrap-history.js`. It uses checkpoint-bounded archived news plus historical XAU/USD bars, creates predictions before examining the future bars, then resolves them afterwards. Bootstrap predictions are generated with neutral learning weights to avoid feeding each forecast its own future result. The workflow exposes this as an optional `bootstrap_days` input (1–7), so no new code version is needed later.
