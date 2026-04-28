# Research: Cookie harvesting for retail / checkout automation

**Scope:** What “cookie harvesting” means in industry tools, how browsers and extensions can implement it technically, policy and security constraints, and how it relates to **Target Checkout Helper** (no implementation commitment).

## What “harvesting” usually means here

Not scraping arbitrary sites for tracking pixels. In checkout-bot contexts it typically means:

1. **Controlled navigation** — User (or automation) visits **login** and/or **product** pages so the first-party site sets **auth and cart** cookies.
2. **Snapshot** — Extension reads those cookies (or relies on the tab’s natural cookie jar) and **stores** serialized copies with metadata (timestamp, label: “login” vs “ATC”, optional proxy profile id).
3. **Rotation** — At task time, a **fresh** snapshot is applied (or “newest first” / “oldest first”) so checkout uses a session that still looks valid to the server, analogous to **session stickiness** in load testing.
4. **TTL** — Snapshots expire (e.g. minutes) because retail sessions drift, CSRF tokens rotate, or risk scoring weights cookie age.

Industry UIs (e.g. Refract) expose **harvest count**, **expiration**, **order**, and **clear pool** — that maps to the lifecycle above.

## Chrome extension mechanics

- **`chrome.cookies`** — Query and modify cookies; **`cookies` permission** plus **host permissions** for each domain you touch ([Chrome `cookies` API](https://developer.chrome.com/docs/extensions/reference/api/cookies)).
- **`getAll` / `set` / `remove`** — Typical harvest flow: `getAll({ domain: '.target.com' })` (or URL-scoped filters), persist a **sanitized list** (name, value, domain, path, secure, httpOnly, sameSite, expirationDate, `partitionKey` if needed), later `set()` to **replay** into the profile before navigation.
- **Partitioned cookies (CHIPS)** — Cookies can be keyed to the **top-level site**; Chrome’s API supports `partitionKey` (Chrome 119+) for partitioned cookies ([same doc](https://developer.chrome.com/docs/extensions/reference/api/cookies)). Harvest code that ignores partitioning can **miss** cookies that matter for embedded flows.
- **Cookie stores** — Normal vs **incognito** use different stores (`getAllCookieStores`). Multi-profile tools often map “tasks” → profiles or anti-detect browsers, not one flat pool.
- **`onChanged`** — Can increment “harvested” counters when relevant cookies appear after a page action.

**Important:** HttpOnly cookies are **not** readable from page JavaScript but **are** visible to extensions via `chrome.cookies` — that is why extensions can snapshot sessions the page script cannot.

## Why vendors care (anti-abuse)

Retailers combine **IP reputation**, **device / browser signals**, **velocity**, and **session history**. A “fresh” cookie on a **stale** IP (or the reverse) can still score badly. Cookie pools are usually paired with **proxies** and **one session per lane** so cookie ↔ IP ↔ fingerprint stay coherent. Your extension today does **not** manage that triangle — harvesting alone would be **necessary but not sufficient** for parity with top-tier bots.

## Chrome Web Store / privacy

Google treats data from websites’ storage, including cookies, as part of **web browsing activity** / sensitive handling when collected by extensions ([Chrome Web Store user data policy](https://developer.chrome.com/webstore/user_data)). **Authentication cookies** are called out explicitly as sensitive.

Implications for a **shipping** extension that harvests:

- **Privacy policy**, dashboard disclosures, **limited use**, secure storage/transit.
- **Minimum permission** — justify `cookies` + narrow hosts (e.g. `*.target.com` only, not `<all_urls>` unless unavoidable).
- **Prominent disclosure** if harvesting is not obvious from the listing and UI.

## Security / abuse risks (yours and users’)

- Stored snapshots are **bearer tokens** — compromise of `chrome.storage` export, backup, or malware equals account access until cookies expire or are revoked.
- **Export/sync** features multiply risk; prefer **local-only**, optional encryption (CWS suggests strong at-rest crypto for sensitive data).
- **Never** log full cookie values to console in production builds.

## Compared to Target Checkout Helper today

| Aspect | Typical harvest stack | TCH today |
|--------|------------------------|-----------|
| Session source | Pooled snapshots + often proxy | **Live tab** session only |
| Stale / 401 handling | Swap cookie + maybe IP | Toast + clear site data + reload |
| Permissions | `cookies` + broad or narrow hosts | No `cookies` permission |
| Data on disk | Serialized jars in storage or native DB | Settings + telemetry only (no auth cookie export) |

## If you add harvesting later (design checklist)

1. **Opt-in** toggle and clear UI: what is stored, where, for how long.
2. **Scope** — `*.target.com` host permission only; handle **`partitionKey`** for partitioned first-party cookies where applicable.
3. **Labels** — Separate **login** vs **checkout-relevant** harvests if your flow uses both (matches industry “login once then ATC” playbooks).
4. **Apply path** — Replay with `chrome.cookies.set` **before** `tabs.update` to checkout URL, or inject only in a dedicated tab; avoid cross-tab races (your “one tab” tip aligns).
5. **Pairing** — Document honestly: without **proxy / profile** isolation, multi-cookie pools help less than on full bot stacks.
6. **Compliance** — Privacy policy + CWS fields before any public listing.

## Sources

- [Chrome Extensions `cookies` API](https://developer.chrome.com/docs/extensions/reference/api/cookies) — permissions, `getAll` / `set` / `remove`, partitioning, cookie stores.
- [Chrome Web Store — User Data policy](https://developer.chrome.com/webstore/user_data) — “handle” includes website storage like cookies; authentication cookies as sensitive.
- [Chrome Web Store — Permissions policy](https://developer.chrome.com/docs/webstore/program-policies/permissions) — minimum permission expectation (linked from policy hub).

---

**Bottom line:** Cookie harvesting is **technically** straightforward with `chrome.cookies` + Target host permissions, but **operationally** it only shines when paired with **session discipline** (TTL, order, clear pool) and often **IP/profile coherence**. Shipping it in an extension **raises** Chrome Web Store privacy obligations and **security** responsibility for stored bearer tokens. TCH can stay minimal and advise manual cookie refresh (as today), or adopt a **narrow, opt-in, Target-only** harvest with explicit policy work — not a silent add-on.
