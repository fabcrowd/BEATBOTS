# Stellar AIO vs Refract — public web / GitHub scan (April 2026)

Purpose: answer whether **branched or “hidden”** open-source mirrors of these **commercial** retail bots appear in normal search indexes. This is not malware hunting; **do not** run unsigned binaries from unknown GitHub users without your own verification.

## Stellar AIO (retail product)

- **Product site / brand:** [stellara.io](http://stellara.io/) (marketing: 100+ sites, desktop app, guides on [guides.stellaraio.com](https://guides.stellaraio.com/)).
- **Not the same thing:** [Stellar-Dex-Chat](https://github.com/leojay-net/Stellar-Dex-Chat) and other “Stellar” blockchain repos are **unrelated** to retail checkout.

### GitHub user `stellaraiop` (naming similarity only — verify before trust)

| Repo | Notes from index |
|------|------------------|
| [stellaraiop/StellarAIO](https://github.com/stellaraiop/StellarAIO) | Very low stars; last activity ~2021 per profile table; **0 forks** in snapshot |
| [stellaraiop/StellarAIOV2](https://github.com/stellaraiop/StellarAIOV2) | Higher stars; **Releases** tab exists in search hits (e.g. versioned tags); treat as **possible release/binary hosting**, not verified source parity with stellara.io |
| [stellaraiop/LumenAIO](https://github.com/stellaraiop/LumenAIO) | Same org pattern; likely sibling branding |

**Conclusion:** Indexed **public** repos under `stellaraiop` look like **parallel naming / artifact hosting**, not an official open-core from Stellar AIO’s vendor. No evidence in this pass of a **maintained fork network** (fork count showed **0** on main repos when fetched). “Hidden” private forks would not appear here by definition.

## Refract (retail product)

- **Product:** [refractbot.com](https://refractbot.com/) — closed desktop automation; docs at [help.refractbot.com](https://help.refractbot.com/) (accounts, modules, Discord webhook settings).
- **GitHub:** No **official** `refractbot` org or open-source core surfaced in searches. Hits for `Refract` on GitHub are **other projects** (e.g. PrismLauncher/refraction naming collision, unrelated apps).

**Conclusion:** **No** credible, indexed **source fork** of Refract was found. Config snippets may exist in pastes or Discord exports elsewhere; that is outside this repo scan and is often **sensitive** (do not publish keys).

## How this compares to Target Checkout Helper

This extension is **vanilla MV3**, **no license to Stellar/Refract**, and **no shared codebase** with those products. The only overlap is **problem domain** (retail checkout). Stellar/Refract emphasize **proxies, captcha harvesters, multi-task** ([guides.stellaraio.com](https://guides.stellaraio.com/stellar)); this project is **browser-session + form assist** per `AGENTS.md`.

## Limits

- Five to eight web queries + fetches; **no** dark-web or warez index.
- GitHub fork graphs can lag; **private** repos are invisible.
- **Do not** assume `stellaraiop/*` is legitimate vendor code without cryptographic / legal verification.
