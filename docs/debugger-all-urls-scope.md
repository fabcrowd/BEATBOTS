# Scope: `debugger` + `<all_urls>` for Target Checkout Helper

This document is **planning only** — no code here yet. Goal: describe **in practice** what adding these would mean for Chrome MV3, this repo, review risk, and how to keep blast radius small even if the manifest is broad.

## What each capability buys you

### `debugger` permission (`chrome.debugger` API)

- **What it is:** Attach Chrome DevTools Protocol (CDP) to a **tab** (by `tabId`). Send commands (`Network.enable`, `Fetch.enable`, `Page.navigate`, `Input.dispatchMouseEvent`, `Runtime.evaluate`, etc.) and receive events.
- **Why bot-style stacks use it:** Bypass some limits of content scripts (isolated world, no raw network timeline, harder to drive certain SPAs). Can observe/modify network at a lower layer than `webRequest` (which MV3 discourages for many cases).
- **What it does *not* do alone:** It does not replace cookies, proxies, or your existing `content.js` flow unless you **build** that layer. It is **infrastructure**.

**Practical attach pattern (recommended if you ship this):**

1. **User gesture** — Only attach after an explicit popup action (“Attach CDP to active Target tab”) or a clearly labeled toggle, not on every Target load.
2. **Target-only in code** — Even with a broad manifest, **refuse** to `attach` unless `tab.url` matches `*://*.target.com/*` (and optionally only when your feature flag is on).
3. **Short lifetime** — Attach → run bounded sequence (e.g. enable `Network`, capture one `Fetch`/`XHR` class of interest, `detach`) to reduce crashes and user anxiety.
4. **Single tab** — Enforce one attached tab per window or global mutex; `chrome.debugger.onDetach` / `onError` to clean up state.
5. **Version string** — Use a supported CDP version (e.g. `'1.3'` is common in samples; verify against [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)).

**Risks:** Chrome shows a **striped “debugged”** UI on the tab; users notice. Wrong `sendCommand` sequences can **hang or detach** the tab. Web Store reviewers treat `debugger` as **high trust** — you need a tight justification tied to user-visible features.

---

### `<all_urls>` host permission

- **What it is:** Extension may access **any origin** for APIs that are host-gated: `fetch` from SW, `scripting.executeScript`, `cookies.getAll` without being limited to `*.target.com`, `tabs` injection on arbitrary URLs, etc.
- **Why vendors use it:** One extension binary for many retailers; attach debugger or inject on whatever tab the user points at; proxy/cookie companions (e.g. Refract) often pair with this.
- **What you actually need for TCH:** Strictly speaking, **only Target** is required for checkout automation. `<all_urls>` is **convenience / future multi-site**, not a technical requirement for Target-only features.

**If you still add `<all_urls>`:**

1. **Code-level allowlist** — All `attach`, `executeScript`, `cookies` reads/writes outside `*.target.com` **denied** unless a second **opt-in** developer flag exists (e.g. `experimentalAllowAnyOrigin` in `chrome.storage.local` default `false`).
2. **Optional host permissions (preferred when possible)** — Chrome allows requesting **additional** origins at runtime via `chrome.permissions.request({ origins: [...] })` so the default install stays `*.target.com` only; users who want “debug any tab” opt in. Note: **`<all_urls>` may not be requestable as optional in all combinations** — verify current MV3 docs for your minimum Chrome version; fallback is static manifest with strong in-code gating + privacy policy.
3. **Split builds** — “Store build” manifest = Target hosts only; “dev / sideload build” = `debugger` + optional broad hosts. Same codebase, different `manifest.json` (two folders or build script). Reduces store rejection risk.

**Risks:** Install prompt becomes **maximally scary**. Users and enterprises may block the extension. Any bug becomes **cross-site** impact — higher bar for responsible disclosure and updates.

---

## Manifest sketch (not applied)

```json
{
  "permissions": [
    "storage", "tabs", "alarms", "cookies",
    "debugger"
  ],
  "host_permissions": [
    "*://*.target.com/*",
    "<all_urls>"
  ]
}
```

Or keep **only** `*://*.target.com/*` in `host_permissions` and add **optional** broad origins later via `optional_permissions` / `optional_host_permissions` (check [declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) for MV3 details).

---

## Integration points in *this* repo (if you implement later)

| Layer | Role |
|--------|------|
| `manifest.json` | Add `debugger`; widen or optional hosts. |
| `background.js` | Own `chrome.debugger.attach` / `sendCommand` / `detach` (SW cannot “see” a tab’s DOM directly — debugger is tab-scoped from SW). |
| `popup.html` / `popup.js` | “Advanced” section: attach/detach, status, **only enable when active tab is Target** (unless opt-in flag). |
| `content.js` | Optional: receive messages from BG with CDP-derived data; keep main path unchanged so non-debugger users unaffected. |
| `AGENTS.md` + privacy | Document why `debugger` exists; Chrome Web Store **limited use** / sensitive data disclosure for anything learned from non-Target pages (even if you intend not to read them). |

**Cookie harvest + debugger:** Harvesting stays **cookie API + Target**; debugger is orthogonal (network/DOM). Combining both increases review scrutiny — ship **justified** features only.

---

## Chrome Web Store / policy (practical)

- **`debugger`:** Treat as **sensitive**; describe exact user-initiated flows in the listing and privacy fields.
- **`<all_urls>`:** Must be **narrowly justified**; “we only use it on Target” is **not** enough for reviewers if the manifest still allows all sites — you need either **optional** narrowing or an honest **multi-site** product description.
- **Minimum permission principle** — [Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies): prefer optional + allowlist in code.

---

## Phased rollout (recommended)

1. **Phase A — Design only (this doc)**  
   Decide: Target-only forever vs optional “power user” second manifest.

2. **Phase B — `debugger` on Target only**  
   Manifest: add `debugger`, **keep** `host_permissions` as `*://*.target.com/*` only. Implement attach/detach for Target tabs only. Validate with manual test on PDP + checkout.

3. **Phase C — Broad hosts (if still needed)**  
   Prefer `chrome.permissions.request` for extra origins **or** sideload “full” build. Never attach/inject off-Target in default configuration.

4. **Phase D — Store / legal**  
   Privacy policy update, dashboard disclosures, screenshots showing gated UI.

---

## Summary

| Item | Enables | Cost |
|------|---------|------|
| **`debugger`** | CDP control of a tab (network, input, navigation) | Scary UX, review friction, careful lifecycle management |
| **`<all_urls>`** | Any-origin API use from extension contexts | Maximum trust prompt; must pair with **strict code allowlist** or optional permissions |

**Default recommendation for TCH:** Add **`debugger` only while keeping hosts Target-scoped** if CDP solves a concrete problem (e.g. reliable network tap). Treat **`<all_urls>` as optional** or **sideload-only** unless you are truly building a multi-retailer product.

---

**References**

- [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)  
- [Declare permissions & optional permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)  
- [Chrome Web Store — Use of permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions)
