GOLD ORACLE R5.2 — ACCURACY GUARD
Build: 2026-09-22-R5.2.0-ACCURACY-GUARD

WHAT CHANGED
- Preserves the existing goldOraclePrimeStateV3 learning brain.
- Live entry revalidation before a pending plan can become actionable.
- Persistent opposite fast pressure can suspend an untouched plan.
- If a blocked plan is touched while evidence is against it, the entry is cancelled instead of triggered.
- Forecast direction is now separated from entry permission.
- Entry-quality score combines plan confidence, M5/M15/M30 alignment, fast opposition persistence, swing/reversal state, event risk, plan age and learned fast-regime quality.
- Sep-22 regression test: a SELL plan under fast BUY 67% / four-scan pressure must be blocked.
- Render-time plan refresh uses the same accuracy gate, so UI refresh cannot bypass scan-time validation.
- SUSPENDED entries display WAIT rather than BUY/SELL instructions.

PRESERVED
- Same localStorage key: goldOraclePrimeStateV3.
- Existing learning, scan memory, ladder learning, flip ledger and position logic migrate forward.
- Existing one-file GitHub Pages workflow.

DEPLOY
Upload index.html as your GitHub Pages site root, replacing the previous index.html.
The build-change boot code clears stale service-worker/cache state without clearing the Oracle brain key.

IMPORTANT
Accuracy Guard reduces known entry-timing failure modes; it does not make market predictions certain or guarantee profitability.
