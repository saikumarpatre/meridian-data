# meridian-data

Public market data for Meridian.html, written by GitHub Actions. Research and decision support for personal use only:
not investment advice, not SEBI-registered, no return is promised. A stop limits loss; it does not remove it (gaps).

## Jobs (see `schedule.json`; GitHub may start scheduled runs late or skip them)
| Job | When (IST) | Writes |
|---|---|---|
| Prices | every 30 min, 08:30–16:00, Mon–Fri | `data/feed.json`, `data/charts/*.json`, `data/history/prices/YYYY-MM.jsonl` (append-only) |
| Research | 18:47 daily (non-trading days skipped) | `data/research/latest.json`, `track.json`, `YYYY-MM-DD.json` (written once, never changed), `data/opps/events.jsonl` (append-only), `data/opps/current.json`, `data/names.json` |
| News | every 2 hours | `data/news.json` (headlines and links only) |
| Health | end of every run | `data/health.json`, `data/health/runs.jsonl` (append-only) |

## Sources
- Prices: Upstox (official) with the `UPSTOX_TOKEN` repository secret (an Upstox **Analytics Token**: free, read-only, valid one year).
  Yahoo Finance (unofficial) is used for the 500-stock scan and as a fallback; every fallback row says why.
- Fundamentals: Upstox only. Screener.in is never read.
- News: publishers' own RSS feeds (`news-feeds.json`). No relay. Article text is never stored.
- Holidays: `holidays.json` is **NEEDS VERIFICATION**. Unverified dates do not stop jobs; set `"verified": true` only after checking NSE's official list.

## Rule modules (`lib/rules/`)
indicators · filters · scoring · tradeplan · lifecycle · mood · tracker, plus `lib/calendar.mjs`, `lib/source.mjs`, `lib/news.mjs`, `lib/health.mjs`.
Idea lifecycle: NEW → WATCHING → ENTRY TRIGGERED → ACTIVE → TARGET HIT / STOPPED OUT / EXPIRED, or WITHDRAWN. Stops never move.

## Privacy
No personal data is stored here: no capital, watchlist, journal or paper trades (those stay in the browser). The token is never written to any file.

## Tests
`node --test test/rules.test.mjs` (unit) and `node test/e2e.mjs` (all jobs against a synthetic offline stub).
