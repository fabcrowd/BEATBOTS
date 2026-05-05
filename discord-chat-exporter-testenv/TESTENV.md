# Test-environment fork

This folder is a copy of `discord-chat-exporter-local/` with **commercial / license checks removed or stubbed** for your own testing.

## Patches applied (see `scripts/patch-dce-testenv.mjs`)

- **dash/dash.js**: `check-token.php` fetch replaced with a static premium/pro response; free message caps set to `Number.MAX_SAFE_INTEGER`; free-tier export limits in the sync estimator and HTML/XLSX loops disabled.
- **background.js**: first-install tab open to the vendor site removed (no-op).
- **manifest.json**: `host_permissions` for hypercavs removed (token check no longer fetches). **Purchase / upgrade links** in the UI may still open hypercavs if clicked — avoid those in test.

## Re-build

```bash
node scripts/patch-dce-testenv.mjs
```

## Legal

Vendor code remains subject to their license. This build is for **private local QA** only; do not publish as a cracked extension.
