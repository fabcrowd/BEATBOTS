# Overnight run 2026-06-25T23:00Z

## Plan
- [x] Read memories, OVERNIGHT_GOAL, test-scope
- [x] Merge prior branch (test-scope.mjs, popup title)
- [ ] Run baseline `npm run test:extension`
- [ ] MON-2: strengthen retailer monitor test + Target filter fix if needed
- [ ] Re-run tests until green
- [ ] Update memories + open PR

## Review
- Baseline `npm run test:extension` green after merging prior branch.
- MON-2: Target `monitorBtn` now filters `target.com` (parity with Walmart tab); functional test asserts shared `monitorActive` and per-retailer `START_MONITOR` product lists.
- Post-change suite green; `test-scope.mjs` next: MON-3 (missing).
