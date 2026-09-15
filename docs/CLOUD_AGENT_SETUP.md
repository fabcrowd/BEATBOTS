# Cloud Agent environment — BEATBOTS

Configure this in **[Cursor Dashboard → Cloud Agents](https://cursor.com/dashboard?tab=cloud-agents)** for repo `fabcrowd/BEATBOTS`.

## Repository layout

- Extension: `target-checkout-helper/`
- Tests: `scripts/browser-smoke/` (Playwright + Puppeteer, loads unpacked extension)

## Recommended install command

```bash
cd scripts/browser-smoke && npm ci && npx playwright install chromium
```

No root-level `package.json`; all Node deps live under `scripts/browser-smoke/`.

## Verify command (run before and after changes)

```bash
cd scripts/browser-smoke && npm run test:extension
```

## Notes for cloud sandboxes

- Tests use **mock HTML fixtures** and headless Chromium — no live retailer logins required.
- Extension path for harness: `../../target-checkout-helper` (relative to `scripts/browser-smoke/`).
- If Chromium install fails, retry `npx playwright install chromium` once.
- Do **not** commit `scripts/browser-smoke/node_modules/`.

## Branch for overnight automation

Default working branch: **`agent/overnight-improvements`**

Automation should check out this branch (or create it from `main`) before editing.

## Secrets

This test suite does not require API keys in CI/cloud. Do not add retailer credentials to the cloud environment.
