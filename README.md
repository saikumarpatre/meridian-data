# meridian-data

Public market data for Meridian.html, refreshed automatically by GitHub Actions
(every 30 minutes during NSE hours, plus once each evening).

- Prices: Upstox (official) if the repository secret `UPSTOX_TOKEN` is set; otherwise Yahoo Finance (unofficial, may be delayed).
- Fundamentals: Upstox Fundamentals API only, and only with `UPSTOX_TOKEN`.
- Files: `data/feed.json` (summary, symbol names, fundamentals, errors) and `data/charts/<symbol>.json` (two years of daily prices).

Optional: Settings → Secrets and variables → Actions → New repository secret → `UPSTOX_TOKEN` (a free, read-only Upstox Analytics Token).
Educational use only. Not investment advice.
