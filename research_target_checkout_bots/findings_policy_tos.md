# Target.com terms, acceptable use, and automation-related restrictions

## Summary

Target’s consumer **Terms & Conditions** (last updated **April 15, 2026** on the fetched page) are **specific** in places (scraping, data gathering, unapproved buying agents, and a new **Agentic Commerce Agent** framework) and **broad** in others (any interaction via “crawlers, robots, browsers, data mining or extraction tools, or other functionality” whether installed by the user or a third party). Target does **not** publish a separate “acceptable use policy” for Target.com under that name in these results; the main contractual document is the Terms & Conditions. **Account-level** remedies include termination, order cancellation, blocking future access, quantity limits, and reseller-related rules. This note is factual policy text and cross-refs for risk discussion—not legal advice.

---

## Key facts

### Where the rules live

- Primary retail **Terms & Conditions** apply to Target.com and linked sites/services and are the main source for use restrictions: `https://www.target.com/c/terms-conditions/-/N-4sr7l`
- **Target Circle** terms embed additional reseller/commercial-use restrictions for that program.

### Introductory “use of the Site” (broad language)

- Anyone who interacts with the Site through “crawlers, robots, browsers, data mining or extraction tools, or other functionality,” **whether installed by the user or a third party**, is treated as using the Site and must accept the terms or stop using the Site.
- **Note:** This paragraph is **generic and wide**. It does not by itself define “browser” as only headless automation; later sections carve out **“generally publicly available browsers”** and **Target-approved Agentic Commerce Agents** (see below).

### Noncommercial license and commercial use

- Target grants a **limited license** for **personal, noncommercial** use; commercial use of the Site or Content (including collecting product listings, descriptions, prices, or images) is a **material breach**.

### Agentic Commerce Agent (AI / delegated access)—explicit automation lane

- Only agents **approved by the customer and by Target** qualify as **“Agentic Commerce Agent”**; **other automated or unauthorized agentic tools are expressly prohibited**.
- Approved agents may be authorized to sign in, create/modify carts, place orders, initiate returns, etc.; actions within approved scope are treated as **authorized by the customer**.
- Target may **suspend or revoke** an agent’s access for suspected fraud, misuse, policy violations, security concerns, or other risky activity.
- Target **does not guarantee** an Agentic Commerce Agent will always act as intended; customers are told to review orders and activity regularly.

### “Unlawful or Prohibited Uses” (automation, scraping, buying agents)

Relevant bullets from the same Terms & Conditions include:

- **Navigation/search:** You may not use engines, software, tools, agents, or mechanisms **(including browsers, spiders, robots, avatars or intelligent agents)** to navigate or search the Site **except** Target’s search, **“generally publicly available browsers,”** or **approved Agentic Commerce Agents**.
- **Scraping / data gathering:** No data extraction, scraping, mining, systematic downloading/storage of Site content, or building databases of listings, descriptions, prices, images, etc., outside the limited license.
- **Buying agents:** You may not use an **unapproved buying agent** to conduct transactions on the Site.
- **Security / “change behavior”:** You may not violate or attempt to violate Site security, including in an **automated** fashion—e.g., accessing others’ data/accounts, **trying to change the behavior of the Site**, probing vulnerabilities, interfering with service (overloading/flooding, etc.), forging headers, etc.
- **Tampering:** No use of devices, software, routines, or data that **interferes** (or attempts to interfere) with the working or functionality of the Site.

**Cross-reference for a Chrome MV3 checkout helper:** Target’s text targets **unapproved agents**, **scraping/mining**, **non-public-browser automation**, and **interference** with site behavior. A normal **consumer Chrome** session is explicitly contemplated (“generally publicly available browsers”), but **extensions are not named**. Whether a given extension is treated as permitted “browser” use, prohibited “tool/agent,” or an “unapproved buying agent” is **not spelled out in the excerpts reviewed** and would depend on facts, enforcement, and updates to these terms.

### Account, termination, and orders

- Users must not share credentials (except as stated for Target); they are responsible for activity under the account, **including when using an Agentic Commerce Agent**.
- Target may **terminate the account**, **refuse service**, or **cancel orders** at its discretion, among other remedies.
- Target may **terminate access**, **block future access**, for **terms violations**, **other reasons**, or **no reason** (contract language as published).

### Quantity limits, resellers, and Circle

- Target may **limit quantities** per account, payment method, or billing/shipping address and may **prohibit purchases for resellers** (defined as purchasing goods **to sell rather than use**).
- **Target Circle** is for **personal, family, and household** purposes only; **resellers are excluded**; violations (including purchasing for resale) can lead to loss of rewards/votes and/or **termination of Circle participation**.

### Technical / crawler signals (`robots.txt`)

- Target hosts a **`robots.txt`** at `https://www.target.com/robots.txt`. Search-synthesized summaries indicate **many `Disallow` paths**, including checkout-related paths (e.g., `/Checkout`, related `Checkout*` views). **Convention:** `robots.txt` governs **polite crawler** behavior and search engines; it is **not** the same as the **Terms & Conditions**, but it supports an inference that Target treats **checkout and related URLs** as **not intended for automated crawling/indexing**.

---

## Gaps and non-Target sources (use with care)

- Third-party articles (e.g., reseller policy explainers, scraping vendor blogs) may summarize Target but **should not replace** the official Terms URL above.
- **`targetconnect.com`** acceptable-use documents found in search refer to a **different “Target” product** (SaaS), **not** Target Corporation’s retail Target.com consumer terms—**do not conflate** them with this extension’s context without verifying scope.

---

## Sources (full URLs)

1. **Target Terms & Conditions (consumer, Target.com)**  
   `https://www.target.com/c/terms-conditions/-/N-4sr7l`

2. **Target `robots.txt`**  
   `https://www.target.com/robots.txt`

3. **Target Help — Policies & Guidelines hub (website technical guidelines child link as returned by search; fetch timed out in this session)**  
   `https://help.target.com/help/subcategoryarticle?childcat=Website+technical+guidelines&parentcat=Policies+%26+Guidelines`  
   (URL encoding may vary; use Help navigation from `https://help.target.com/` if the link redirects.)

---

## Method note

- **Web searches:** 5 queries (at budget cap).
- **WebFetch:** Target Terms page retrieved successfully (content mirrored in workspace agent-tools during search/fetch). **`robots.txt`** and **Help** fetches **timed out** here; ToS quotes above are taken from the **successfully retrieved Terms & Conditions** text as of **LAST UPDATED: April 15, 2026** on that page.
