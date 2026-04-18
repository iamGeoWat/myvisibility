# MyVisibility — Feasibility & Design Doc

> Privacy-protection SaaS that **finds your personal info on the public web and tells you exactly how to remove it yourself.** Built serverless on Vercel, with Claude replacing the expensive analyst work.

## 1. Problem & origin

A colleague Google-searched his own phone number and found it on his home contractor's website, embedded in a scanned building permit. That's the canonical case we're solving:

> **Your personal info (name / phone / email / home address) is reachable by strangers via one Google query, and you don't know it — let alone how to take it down.**

Sources fall into ~5 buckets:

| Bucket | Example | Removal mechanism |
|---|---|---|
| Data brokers / people-search | Spokeo, Whitepages, BeenVerified, Radaris | Per-site opt-out URL |
| Search engine cache | Google, Bing | Google "Results About You", Bing content removal |
| News / blog posts | Local news, forum posts, contractor sites | Email webmaster (GDPR / CCPA / PIPL request) |
| Social media over-share | Public LinkedIn / FB / IG profiles | User-side privacy settings |
| Public records | Court records, school directories, gov permits | Jurisdiction-specific |

## 2. Product thesis

**Discovery is the hard part. Removal is mostly just knowing who to email.**

Most legitimate sites have documented takedown flows — the user just doesn't know they exist, can't find the right contact, and doesn't know what legal basis to cite. Once we show them:

- **the exact URL** where their info leaked,
- **the direct opt-out link** (if it's a known broker),
- **the correct contact email** (scraped from the page / WHOIS),
- **a copy-paste takedown email** in the right language + legal framework,

…the user can submit it themselves in 30 seconds. We don't need to act on their behalf.

This is a **much smaller product** than DeleteMe / Optery, but:
- ~10× cheaper to build and run
- No legal liability from acting as an agent (no LOA needed)
- Users keep full control of their own communications
- The long tail of "contractor websites with scanned permits" is reachable — something DeleteMe can't handle because it's not on their broker list

### What we are **not** building (for MVP, maybe ever)
- ❌ Acting on the user's behalf (no LOA, no impersonation, no third-party submissions)
- ❌ Outbound email from our servers (user sends from their own inbox)
- ❌ Headless-browser form filling
- ❌ Inbox automation (reading / clicking verification links)
- ❌ Monthly autonomous re-submission to brokers
- ❌ California DROP API integration (we just link users to privacy.ca.gov)

## 3. Competitor landscape & pricing

| Product | Price | Method | What we do differently |
|---|---|---|---|
| DeleteMe | $129 / yr | Human ops submits for you | We *guide* instead; 10× cheaper |
| Optery | $4–$25 / mo | Automated submission + aliases | We guide; user keeps own inbox |
| Incogni | $7.49 / mo | GDPR/CCPA letter blast | We give you the letter; you send it |
| Google "Results About You" | free | Search-only, needs manual check | We aggregate across engines + tell you what legal framework applies |

**Our price target: $2–$3 / month** (or pay-per-scan) — made possible by zero human labor and near-zero COGS per scan.

## 4. Architecture (Vercel-native)

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App Router on Vercel                                   │
│  ─ Onboarding (PII vault, region = US / EU / CN)                │
│  ─ Dashboard (findings by source)                               │
│  ─ Per-finding "how to remove" card (copyable email + links)    │
└──────────────┬──────────────────────────────────────────────────┘
               │ Server Actions
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Vercel serverless functions (default 60s is plenty)            │
│  /scan      – fan out Brave Search queries                      │
│  /classify  – Claude Haiku: is-this-me + source bucket          │
│  /guide     – Claude Sonnet: removal card + email template      │
└──────┬────────────────────────────────┬─────────────────────────┘
       │                                │
       ▼                                ▼
┌──────────────────────┐      ┌──────────────────────────────────┐
│ Neon Postgres        │      │ Static: brokers.json              │
│ (Vercel native)      │      │ ~200 known opt-out URLs +         │
│ + Drizzle ORM        │      │ templates; open-source seeded     │
└──────────────────────┘      └──────────────────────────────────┘

External services:
  ─ Clerk                auth (Vercel-preferred pairing with Neon)
  ─ Brave Search API     scan ($3–5 / 1k queries)
  ─ Anthropic SDK
       ├─ Haiku 4.5       classify "is this me?" + source bucket
       └─ Sonnet 4.6      generate personalized removal card
                          (region-specific legal basis + email)
  ─ Stripe               freemium billing (Phase 2)
```

### Why this is trivially serverless
- All functions are **short** (single Brave query → 1 Claude call → DB write). 60s default is more than enough; Fluid Compute not required.
- No headless browsers, no job queues, no webhooks. One HTTP request in, one response out.
- **No servers to babysit.** ✅

## 5. The "how to remove" card (the core feature)

For each confirmed finding, Claude generates a card with:

1. **Source type badge** — `broker` / `search-cache` / `news` / `social` / `gov-record`
2. **Direct action link** (in priority order):
   - Known opt-out URL from our `brokers.json` (e.g. `https://www.spokeo.com/optout`)
   - Google "Results About You" prefilled URL
   - `privacy@` / webmaster email extracted from the target page or WHOIS
   - Generic `abuse@` fallback
3. **Copy-paste takedown email** in the user's region language:
   - US → CCPA §1798.105 (45-day response)
   - EU → GDPR Art. 17 (30-day response)
   - CN → 《个人信息保护法》第47条 (15-day response)
4. **Difficulty badge** — `easy` (link only) / `medium` (email) / `hard` (ID verification / phone call)
5. **Legal-basis one-liner** — e.g. "对方法定须在 30 天内响应，否则可向 ICO 投诉"

User reads, copies, sends from their own email. We mark the finding as `user_action_taken` once they click "I sent it".

## 6. Where Claude earns its keep

| Workflow | Model | Cost per 100-URL scan |
|---|---|---|
| Is this result actually about my user? + bucket it | Haiku 4.5 | ~$0.01 |
| Generate personalized removal card + region-appropriate email | Sonnet 4.6 | ~$0.10 (for ~30 findings) |

**Per-scan COGS ≈ $0.16** (including ~$0.05 of Brave Search). Even at $2/month we have 90%+ margin.

## 7. MVP scope (4 weeks)

- [ ] **Auth + PII vault** — Clerk signup, encrypt-at-rest vault of { names, phones, emails, addresses, region }
- [ ] **Scan engine** — fan out ~10 Brave Search permutations; cap at ~200 results
- [ ] **Claude classifier** — Haiku batch-classifies each hit: `{is_user: bool, confidence: 0..1, bucket: str}` — drop `confidence < 0.7`
- [ ] **Removal-card generator** — Sonnet produces the card described in §5
- [ ] **Broker DB** — seed `brokers.json` from [Big-Ass Data Broker Opt-Out List](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List); ~60 entries to start, grow over time
- [ ] **Dashboard** — findings grouped by bucket, per-card actions (copy email / open link / mark done)
- [ ] **Scan re-run button** — manual; no cron for MVP
- [ ] **Freemium gating** — first scan free; $2 pay-per-scan or $3/month unlimited (Stripe in Phase 2)

**Phase 2 (post-MVP):** Stripe billing · monthly cron re-scans · WHOIS-based email extraction · broker DB expansion to 200+ · "track whether the listing came back" after user submitted.

## 8. Legal posture

We never act as an agent. We never send anything on the user's behalf. We inform.

- **No LOA required** — user submits their own requests from their own address
- **We cite** GDPR Art. 17, CCPA §1798.105, PIPL Art. 47 in generated letters — as the user's own legal basis, not ours
- **We don't scrape** in ways that violate CFAA / ToS — Brave Search API is a licensed search result; nothing beyond
- **Disclaimer in ToS**: we're an informational service; users are responsible for their own communications

## 9. Risks & open questions

| Risk | Mitigation |
|---|---|
| Claude false-positive ("this isn't your user") wastes a finding slot | Require ≥2 disambiguators (name + city/email); drop low confidence |
| Listings reappear after user submits — user blames us | Disclose up-front: "removal is brokers' responsibility"; offer re-scan |
| CN legal framework (PIPL) has weak enforcement for individuals | Still give the template; it works on reputable sites |
| Brave Search doesn't index as deep as Google | Add Bing Web Search API as second source if coverage is poor |
| `brokers.json` staleness (URLs change) | Weekly validation cron (Phase 2); users can flag broken links |
| Privacy of the PII we collect | Encrypted at rest; hash-based matching; delete on account close; minimize retention |

## 10. Stack (confirmed)

```
Framework      Next.js 15 App Router
Hosting        Vercel
Database       Neon Postgres  (Vercel-native integration)
ORM            Drizzle
Auth           Clerk
Search         Brave Search API
AI             Anthropic SDK — Haiku 4.5 + Sonnet 4.6
Billing        Stripe (Phase 2)
Emails (out)   none — user sends from own inbox
```

## 11. Phased roadmap

**Phase 0 — Validate (this week)**
- Ship a single prompt: given a Brave Search result + user PII, return `{is_user, bucket, card_markdown}`. Hand-label 50 results; measure accuracy. Target: ≥85% on `is_user`.

**Phase 1 — MVP (4 weeks)**
- Everything in §7. Invite 10 friends.

**Phase 2 — Public beta (4 weeks)**
- Stripe · monthly cron · broker DB 60 → 200 · link health · WHOIS extraction · share-link for findings.

**Phase 3 — Scale**
- SEO content (opt-out guides per broker) · multi-user (family plan) · broker-coverage telemetry.

## References

- [DeleteMe — how it works](https://joindeleteme.com/)
- [Optery help center](https://help.optery.com/en/category/opt-outs-removals-9iljk3/)
- [Big-Ass Data Broker Opt-Out List](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List)
- [Google "Results About You"](https://myactivity.google.com/results-about-you)
- [GDPR Article 17](https://www.gdpr-ccpa.org/gdpr-articles/gdpr-article-17-right-to-erasure-(-right-to-be-forgotten-))
- [CCPA §1798.105 — right to delete](https://oag.ca.gov/privacy/ccpa)
- [《个人信息保护法》第四十七条](http://www.npc.gov.cn/npc/c30834/202108/a8c4e3672c74491a80b53a172bb753fe.shtml)
- [Neon for Vercel (marketplace)](https://vercel.com/marketplace/neon)
- [Brave Search API pricing](https://api-dashboard.search.brave.com/documentation/pricing)
