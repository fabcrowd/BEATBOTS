# Research report: Target checkout bots landscape vs this repo

## Bottom line

Target’s published **Terms & Conditions** (fetched April 2026-era page) combine **broad** language about tools that interact with the site with **narrower** bans on scraping, **unapproved buying agents**, and interference with site behavior, while explicitly allowing **“generally publicly available browsers”** and **Target-approved Agentic Commerce Agents**. **Chrome extensions are not named**; risk is interpretive and enforcement-dependent. Technically, this repo matches the common pattern for retail helpers: **isolated content script + MAIN-world bridge + service worker polling + merchant JSON APIs + `sessionStorage` flow markers**—the same surfaces called out in Chrome docs and anti-bot overviews (**selector drift**, **rate/challenge behavior**, **MV3 sleep**). Public “Target bot” material is **heavy on vendor marketing** and **light on verifiable Reddit/technical case studies** from this search pass; CAPTCHA and velocity framing is **retailer-agnostic** but relevant to aggressive polling.

## Agreement across sources

- **Dual signal:** Official-ish docs describe MV3 lifecycle and isolated vs MAIN worlds; our `manifest.json` + `main_world.js` + `content.js` align with that pattern ([Chrome content scripts](https://developer.chrome.com/docs/extensions/mv3/content_scripts/), [MDN ExecutionWorld](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld)).
- **Polling split:** Background TCIN polling matches the documented motivation to avoid **throttled background tabs** ([Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
- **Policy breadth:** Target ToS text is wide enough that **any** automation product should treat **compliance review** as non-optional; narrow technical mitigations do not erase policy risk ([Target Terms & Conditions](https://www.target.com/c/terms-conditions/-/N-4sr7l)).

## Contradictions / gaps

- **Commercial “bot” pages** claim capabilities and safety; **independent measurement** of those claims was out of scope—treat as **low independence**.
- **Anecdotal bans** (e.g. personal blogs) **do not** establish base rates or Target’s current practice; useful only as **risk awareness**, not counts.
- **Reddit:** five targeted queries did **not** surface substantive Target-specific bot threads; deeper forum search would be a separate pass.

## Cross-reference: repo structure

| External theme | This repo |
|----------------|-----------|
| Unapproved agents / buying tools | User-controlled checkout helper; “Place order” manual by default (`AGENTS.md`). |
| API replay / scraping | Uses fulfillment endpoints keyed like the storefront (`content.js`, `background.js`); not a separate “scraping stack.” |
| Anti-bot / CAPTCHA | `hasHumanVerificationChallenge()` slows retries; still a best-effort heuristic on page text. |
| MV3 worker sleep | `chrome.alarms` watchdog + `chrome.storage` for `bgApiKey` and monitor state. |

## Sources

- Policy detail and quotes: [findings_policy_tos.md](./findings_policy_tos.md) → [Target Terms & Conditions](https://www.target.com/c/terms-conditions/-/N-4sr7l), [robots.txt](https://www.target.com/robots.txt).
- Technical comparison: [findings_technical_patterns.md](./findings_technical_patterns.md) → Chrome lifecycle, content scripts, MDN `ExecutionWorld`.
- Public landscape: [findings_public_landscape.md](./findings_public_landscape.md) → Restock Blog, Miles per Day, Card Chill (confidence flags in-file).

## Open questions

- Whether Target maps **extensions** to permitted “browser” use or prohibited “tools/agents” remains **unresolved** in cited terms excerpts alone—legal/product judgment.
- **Current** enforcement intensity for fulfillment polling vs PDP navigation is **not** measurable from public web snippets alone.
