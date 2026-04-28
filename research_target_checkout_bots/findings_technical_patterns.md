# Retail checkout helper / “buy bot” extensions: technical patterns and failure modes

Research subtopic for **Target checkout automation tools vs our architecture** (vanilla JS Chrome MV3, isolated + main world, RedSky-style API polling, `sessionStorage` retry state).

---

## Summary

Retail-oriented checkout helpers and “buy bots” are almost always **client-only Chrome extensions** (or similar) that combine: **(1)** DOM observation and scripted clicks/typing on the merchant site, **(2)** **polling** of product/stock/cart state (either by re-reading the DOM, hitting the same JSON APIs the page uses, or both), and **(3)** coordination between a **Manifest V3 service worker** and **content scripts** via messaging. They fail most often due to **selector drift** (silent wrong-element or null matches), **rate limits and anti-bot** (CAPTCHAs, challenges, fingerprinting, behavioral scoring), and **MV3 lifecycle limits** (service worker sleep, alarm granularity, tab throttling) unless the design explicitly works around them.

**Compared to this repo’s Target Checkout Helper:** the general industry pattern matches: **isolated-world** automation plus **MAIN-world** injection where the page’s own globals/network context are required (e.g. reading values the SPA only exposes to page scripts), **background-side polling** to avoid tab timer throttling, **shared drop-window interval logic**, **RedSky-style fulfillment API** checks before heavy DOM work, and **`sessionStorage`** for **per-tab retry/navigation** continuity—an intentional split between durable state (`chrome.storage`) and ephemeral checkout flow markers.

---

## 1. How these extensions typically work

### 1.1 Content scripts and the DOM

Extensions inject **content scripts** that share the page’s **document** but, by default, run in an **isolated JavaScript world**: they can use standard DOM APIs (`querySelector`, clicks, `MutationObserver`, etc.) while **not sharing** the page’s `window` globals with the site’s own scripts. Chrome’s documentation describes this model explicitly: content scripts “read details of the web pages the browser visits, make changes to them, and pass information to their parent extension,” and “live in an isolated world” so changes to the content script environment do not conflict with the page or other extensions.

For checkout automation, typical building blocks are:

- **Declarative or dynamic injection** on merchant match patterns (`manifest.json` `content_scripts` or `chrome.scripting.registerContentScripts`).
- **DOM-driven state machines**: detect step (PDP, cart, shipping, payment, review), fill fields, click “Continue,” wait for navigation or DOM transitions.
- **`MutationObserver` / short `setInterval` loops** in the **tab** to react to SPA re-renders (often more reliable than one-shot selectors after soft navigations).

### 1.2 Isolated world vs MAIN world

When automation must **read page-owned data** (inline Redux store, closure-captured config, or values only written onto DOM by page scripts in a way that still flows through the DOM), extensions often add a **MAIN-world** script—via manifest `"world": "MAIN"` or `scripting.executeScript` with `world: "MAIN"`—so code runs in the **same** JS realm as the site.

Trade-offs (from MDN / Chrome’s alignment with `scripting.ExecutionWorld`):

- **ISOLATED**: default; extension APIs available through the content script bridge; safer from page tampering.
- **MAIN**: **no** extension-only APIs in that file’s global scope; the **page can detect and interfere** with injected logic—acceptable only when the threat model allows it.

This repo follows that split: `main_world.js` runs in **MAIN** to surface data for the isolated `content.js` (see manifest + comments in `content.js`).

### 1.3 Service workers, messaging, and polling

MV3 replaces persistent background pages with **event-driven service workers**. Chrome documents that a worker is normally terminated after **~30 seconds of inactivity**, or if a single handler exceeds **5 minutes**, or if a **`fetch()`** response takes **> 30 seconds**—so **long-running loops in the background only** are fragile unless something **resets the idle timer** (events, extension API calls, long-lived ports, WebSockets since Chrome 116, etc.). Chrome also notes **global variables are lost** on shutdown—persistent state belongs in **`chrome.storage`**, IndexedDB, or similar (not `localStorage` in the worker).

**Alarms:** Official docs state that from **Chrome 120**, `chrome.alarms` can use a **minimum period of 30 seconds**, aligned with the service worker lifecycle—still too coarse for sub-second “drop” polling, which is why many extensions **poll from a content script** (tab context) or use **network polling from the worker** with careful wake patterns.

**Tab vs worker polling:** Product pages in background tabs are **throttled** by the browser; extensions that need tight loops often **poll from the service worker** (as this project’s `background.js` comments: TCIN polling runs there to avoid tab throttling) or keep an **active** tab.

### 1.4 API-style polling (“RedSky-style”)

Modern retail sites load stock and fulfillment from **XHR/fetch to JSON endpoints**. Extensions reverse-engineer those calls (URL, query params, headers, cookies) and **poll the same APIs** the PDP uses—often faster and more stable than scraping visible “Add to cart” copy. This is still subject to **auth cookies**, **CSRF tokens**, **API versioning**, and **WAF rules**—but it reduces dependence on purely visual DOM state.

This repo’s `content.js` explicitly prefers **RedSky fulfillment API** for stock checks where possible.

---

## 2. Common failure modes

### 2.1 Selector drift and brittle DOM

Checkout flows are SPAs with **frequent DOM refactors**, **A/B tests**, **localized strings**, and **dynamic classes** (CSS modules, hashed utility classes). Selectors then **silently** match nothing, the wrong button, or a stale overlay—classic **selector drift** from scraping and E2E testing practice: silent null or wrong-element matches corrupt behavior instead of throwing.

Mitigations (conceptual): prefer **stable attributes** (`data-*`, roles, form names), **semantic queries**, **multi-signal** resolution (text + structure), guardrails when counts are wrong, and **API polling** as a second source of truth.

### 2.2 Anti-bot, throttling, and fraud systems

E-commerce **bot detection** blends **client signals** (automation hints, timing, fingerprint surfaces) with **server-side** velocity and session graphs. Checkout is a high-value funnel: **CAPTCHAs**, **device proofs**, **3-D Secure**, and **payment velocity** checks are common. Extensions that **hammer** APIs or click paths **trip rate limits** or “challenge” flows—this codebase already references **slowing polling when a challenge is detected** (see stock watch logging in `content.js`).

### 2.3 MV3 and browser lifecycle

Beyond worker sleep: **message races** after wake, **lost in-memory state**, **port disconnects**, and **permission / host permission** gaps on navigation. Using **`sessionStorage`** (tab-scoped, survives reloads in-session) for **retry markers** and **`chrome.storage`** for settings is a common **hybrid**—matches this repo’s pattern for checkout retry vs durable prefs.

### 2.4 Policy, ethics, and ToS

Separate from engineering: merchants’ **terms of use**, **payment network** rules, and **regional** consumer laws may restrict automation. This note is scope for product/legal review, not a technical workaround.

---

## 3. Comparison: generic “buy bot” pattern vs this repo

| Area | Typical extension pattern | Target Checkout Helper (this repo) |
|------|---------------------------|-------------------------------------|
| **Runtime** | Vanilla or bundled JS, MV3 SW + content scripts | Vanilla JS, MV3, no bundler |
| **DOM automation** | Isolated content script + observers / timers | Isolated `content.js` |
| **Page-only data** | Optional MAIN-world helper | `main_world.js` + manifest `"world":"MAIN"`; isolated script consumes signals |
| **Fast / drop polling** | Risk split: SW vs throttled tab | Shared `dropPollingTiming.js`; **background TCIN polling** to avoid tab throttling |
| **Stock / availability** | DOM scrape and/or XHR replay | **RedSky fulfillment API** where applicable |
| **Ephemeral flow state** | In-memory or `sessionStorage` | `sessionStorage` keys for retry, nav marks, checkout mode/timing |
| **Durable settings** | `chrome.storage` | `chrome.storage` (popup + content) |

---

## Sources

1. **Chrome for Developers — Extension service worker lifecycle** (idle/shutdown timers, persistence guidance, Chrome 116+ WebSocket lifetime, Chrome 120 alarms minimum 30s, storage vs globals).  
   https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

2. **Chrome for Developers — Content scripts** (DOM access, isolated worlds, static/dynamic/programmatic injection, `world` / `ExecutionWorld`).  
   https://developer.chrome.com/docs/extensions/mv3/content_scripts/

3. **MDN — `scripting.ExecutionWorld`** (`ISOLATED` vs `MAIN`, interference warning).  
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld

4. **BrowserStack — Playwright bot detection** (headed browsers, realistic timing/viewports, behavioral patterns; generalizable to “real browser” automation).  
   https://www.browserstack.com/guide/playwright-bot-detection

5. **Promptcloud — Managing change in web scraping** (structural change, maintenance cost of scrapers; aligns with selector drift and SPA churn).  
   https://www.promptcloud.com/blog/managing-change-in-web-scraping-10-challenges/

**Additional context used from web search (not fully fetched):** Chromium extensions Google Group threads on MV3 polling/alarms; Stack Overflow MV3 DOM/content script Q&A; industry blogs on selector drift / resilient selectors.

---

## Web searches performed (≤ 5)

1. Chrome extension MV3 content script DOM automation checkout  
2. Chrome extension service worker polling limitations Manifest V3  
3. Ecommerce checkout bot detection browser fingerprinting anti-bot  
4. Chrome extension isolated world main world executeScript injection  
5. Web scraping selector drift brittle DOM automation failures  

---

*File generated for internal architecture comparison; not legal or merchant-policy advice.*
