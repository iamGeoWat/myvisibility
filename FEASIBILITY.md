# MyVisibility — Feasibility & Design Doc

> Privacy-protection SaaS that finds your personal info on the public web and helps you remove it. Built serverless on Vercel, with Claude as the expensive-human-labor replacement.

## 1. Problem & origin

A colleague Google-searched his own phone number and found it on his home contractor's website, embedded in a scanned building permit. That's the canonical case we're solving:

> **Your personal info (name / phone / email / home address) is reachable by strangers via one Google query, and you don't know it — let alone how to take it down.**

Sources fall into ~5 buckets:

| Bucket | Example | Removal mechanism |
|---|---|---|
| Data brokers / people-search | Spokeo, Whitepages, BeenVerified, Radaris | Per-site opt-out form or email |
| Search engine cache | Google, Bing | Google "Results About You", Bing content removal |
| News / blog posts | Local news, forum posts, contractor websites | Email webmaster; DMCA / GDPR / CCPA / "Results About You" for delisting |
| Social media over-share | Public LinkedIn / FB / IG profiles | User-side privacy settings (we guide) |
| Public records | Court records, school directories, gov permits | Jurisdiction-specific; often hardest |

## 2. Competitor landscape

| Product | Price | Brokers | Cadence | Method |
|---|---|---|---|---|
| **DeleteMe** | $129 / yr | 750+ | Quarterly | Human ops team submits opt-outs |
| **Optery** | $3.99–$24.99 / mo | 365–955 | Monthly | Automated scans + auto opt-out + custom email aliases |
| **Kanary** | ~$150 / yr | ~150 | Ongoing | Automated + human |
| **Incogni** | $7.49 / mo | ~180 | Ongoing | GDPR/CCPA letter spam |
| **OfflistMe** | $2.50 one-time | ~200 | One-shot | Self-serve guides |
| **Google "Results About You"** | free | search index only | continuous | User-side dashboard, no API |
| **California DROP** | free (CA residents) | 500+ registered brokers | single request | State-run central platform, API opening Spring 2026 |

Key observations:
1. Subscriptions are mostly selling **automation of a list of ~200–800 known broker opt-out URLs/emails** — the list is not secret (see [yaelwrites/Big-Ass-Data-Broker-Opt-Out-List](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List), 60+ brokers maintained openly).
2. The moat is **operational** (handling CAPTCHAs, ID-verification steps, email-confirmation loops, broker re-listings) — not the list.
3. Manual labor is why a monthly fee exists. **That's the part AI can eat.**
4. **California DROP goes live 2026-08-01** — one request fans out to 500+ CA-registered brokers, 90-day legal deletion deadline, API in spring. This is a free structural gift: we layer onto it for CA users immediately, then extend coverage globally.

## 3. Thesis

> **A Claude-powered agent can replace ~80% of a DeleteMe ops analyst's workflow at marginal API cost.** Plus California DROP + GDPR/CCPA templated letters + Google "Results About You" guided flows cover most of the high-value work for free or near-free.

Therefore a product at **$1–3 / month** (or even pay-per-scan) is feasible while DeleteMe charges $11+/mo.

Where Claude + automation replaces humans:

| Task | Who does it today | Who does it in MyVisibility |
|---|---|---|
| Parse Google/Bing results, decide "is this the same person?" | human analyst | Claude (name + locality + age disambiguation) |
| Fill a broker's opt-out form | human / brittle scripts | Claude-driven Stagehand / Browserbase session |
| Click email confirmation link | human with shared inbox | Claude reads inbox alias, clicks link |
| Draft a personalized GDPR/CCPA letter for a one-off webmaster | human | Claude generates + user approves + Resend sends |
| Classify which removal mechanism applies to a given URL | human routing | Claude |
| Re-check 30 days later that a listing stayed down | human sweep | cron + Claude |

## 4. Architecture (Vercel-native)

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App Router on Vercel                                   │
│  ─ Onboarding (name, phones, emails, addresses, aliases)        │
│  ─ Dashboard (findings + removal status per item)               │
│  ─ "Approve & send" letter review UI                            │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │  RPC / Server Actions
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Vercel Fluid Compute functions                                 │
│  (Pro: up to 800s; enough for per-site orchestration)           │
│                                                                  │
│  /scan    – fan out search queries                              │
│  /classify – Claude: is this me? what removal mechanism?        │
│  /remove  – dispatch to Tier 1..4 handlers                      │
│  /inbox   – webhook from Cloudflare Email Routing               │
└──────┬───────────────────────────────────┬──────────────────────┘
       │                                   │
       ▼                                   ▼
┌──────────────────────┐        ┌──────────────────────────────┐
│ Postgres (Neon)      │        │ Upstash Redis / QStash        │
│ users, targets,      │        │ job queue for long tasks      │
│ findings, removals,  │        │ rate limiting per broker      │
│ letters, inbox_msgs  │        │                              │
└──────────────────────┘        └──────────────────────────────┘

External services:
  ─ Brave Search API     ($3–5 / 1k queries)        ← search scan
  ─ Claude API           (Haiku 4.5 for classify,   ← the brain
                          Sonnet 4.6 for letters /
                          form-filling)
  ─ Resend / Postmark    outbound letters
  ─ Cloudflare Email     user@alias.myvisibility    ← receives
    Routing                                           verification mails
  ─ Browserbase or       headless browser for        ← only for Tier 3
    Stagehand            broker forms (long tail)
  ─ California DROP API  (Spring 2026)               ← bulk CA broker
                                                     deletion
```

### Why Vercel is fine

- **Fluid Compute on Pro extends function duration to 800s** — enough to do per-broker submissions end-to-end, or to split into queued steps. ([Vercel docs](https://vercel.com/docs/functions/configuring-functions/duration))
- Heavy browser work is offloaded to **Browserbase / Browserless** as a service; we never run Chromium on a Vercel function (the 50 MB bundle / 1 GB RAM limits make it brittle even with `@sparticuz/chromium`).
- Scheduled re-scans use **Vercel Cron**.
- No servers to babysit. ✅

### The four removal tiers (important)

| Tier | Cost / request | Coverage | Example |
|---|---|---|---|
| **1. Deep-link + prefill** | ~$0 | Google Results-About-You, social privacy settings | Generate a URL with their info pre-filled; user clicks "confirm" |
| **2. Templated email** | ~$0.001 (Resend + Claude letter) | GDPR Article 17 / CCPA / CPRA letters to webmasters, small brokers | Send with user's consent from their alias |
| **3. Agentic form-fill** | $0.05–$0.20 (Claude + Browserbase minutes) | 150+ mainstream brokers with forms, CAPTCHAs handled | Stagehand + Claude vision opens Spokeo opt-out, pastes profile URL, submits |
| **4. California DROP API** | $0 (gov-run) | 500+ CA-registered brokers at once | One signed request deletes all |

Tiers 1, 2, 4 are **serverless-friendly**. Tier 3 is the expensive part and where we must be surgical about when to invoke a browser session.

## 5. MVP scope (8-week target)

Intentionally narrow. Ship the end-to-end loop for one user, one input, a handful of sources.

- [ ] **Account + vault**: collect target PII (name, phones, emails, home addresses, aliases). Encrypt at rest.
- [ ] **Authorization-of-agent record**: per-user signed Letter of Authorization (LOA) stored; required by many brokers to accept third-party removal requests. DeleteMe does this; we need the same.
- [ ] **Scan engine** (Tier 0): Brave Search + Bing Web Search for permutations of PII. Claude Haiku classifies each result: *"is this my user? what removal tier applies?"*
- [ ] **Google "Results About You" guided flow** (Tier 1): deep-link with prefilled form for each flagged URL. User clicks "submit" on Google's side.
- [ ] **GDPR/CCPA letter generator** (Tier 2): Claude Sonnet drafts a personalized removal email from user's alias (Cloudflare routing) to WHOIS/webmaster contact; user approves → Resend sends.
- [ ] **Top-20 broker opt-out automation** (Tier 3, limited): only the highest-value brokers (Spokeo, Whitepages, BeenVerified, Radaris, Intelius, MyLife, PeopleFinder, TruePeopleSearch, etc.). Browserbase session driven by Claude. Human-in-loop for CAPTCHA / ID upload.
- [ ] **Inbox loop**: Cloudflare Email Routing → Vercel webhook → Claude reads the email → clicks verification link → logs state back to DB.
- [ ] **Dashboard**: findings grid, per-item status, "rerun" button, monthly cron re-scan.
- [ ] **Pricing**: freemium (first scan free), $2 / month for monitoring + up to 50 removals, pay-per-broker beyond.

**Explicitly out of scope for MVP:**
- Public records / court records removal (jurisdiction nightmare)
- Image / deepfake removal
- Dark-web monitoring
- Social media scraping of the user's own posts
- California DROP integration (wait for API stabilization after Spring 2026)

## 6. Where Claude earns its keep

| Workflow | Model | Rough tokens/call | $ per scan (100 URLs) |
|---|---|---|---|
| Classify search result as "is this me?" + removal tier | Haiku 4.5 | ~1.5k in / 100 out | ~$0.01 |
| Draft personalized GDPR/CCPA letter | Sonnet 4.6 | ~3k in / 500 out | per-letter ~$0.02 |
| Agentic form-fill via Stagehand (vision + steps) | Sonnet 4.6 | ~10k in / 2k out per broker | ~$0.10 / broker |
| Read inbox email, extract & click confirm link | Haiku 4.5 | ~2k in / 200 out | ~$0.003 / email |

**Back-of-envelope unit economics per active user per month:**
- 1 monthly scan, ~200 URLs → classify ≈ $2 Claude
- ~30 active removals per user → Tier 2/3 mix ≈ $0.50 Claude + $0.30 Browserbase + $0.10 Resend + $0.05 Brave
- **COGS ≈ $3 / user / month** at the heavy end; much cheaper once Tier-4 DROP lands.

At **$4.99/mo** we'd still be ~50% cheaper than the cheapest competitor (Incogni $7.49) with better cadence.

## 7. Legal framework

Ship only after a lawyer reviews, but the foundations:

- **LOA required**: per-user signed authorization-to-act-as-agent, stored, referenced in outgoing requests. This is how DeleteMe legally submits on your behalf.
- **Identity verification**: most broker removals require proof the target is the requester. We mirror the target's own credentials (via inbox alias) rather than impersonating — all actions are user-initiated and user-consented.
- **Regulations we can invoke**:
  - GDPR Art. 17 (EU, 30-day response, extendable to 90)
  - CCPA / CPRA (CA residents, 45-day response)
  - California Delete Act → **DROP** platform (live 2026-08-01, 90-day deletion, $200/request/day penalty)
  - PIPEDA (Canada), LGPD (Brazil), PIPL (China — low enforcement for individuals), UK GDPR, Quebec Law 25
- **Don't do**: impersonate the user to lie, scrape in ways that violate CFAA / Computer Misuse Act, submit bulk requests automated from one IP (gets us blocked).

## 8. Risks & open questions

| Risk | Mitigation |
|---|---|
| Brokers relist data after opt-out | Monthly re-scan; show user the "whack-a-mole" chart |
| CAPTCHAs / ID uploads block automation | Human-in-loop UI: notify user, collect missing doc, continue |
| Email deliverability (Resend → broker spam filter) | Use user's own alias with SPF/DKIM, low per-domain send volume |
| Broker refuses third-party LOA | Fall back to "guide user to submit themselves" — still 10x better UX than nothing |
| Vercel timeout on long form sessions | Queue (QStash); each step re-enters a fresh function |
| Claude hallucinates "this URL is about the user" → wasted removal | Require ≥2 disambiguators (e.g. name + city); confidence threshold |
| Global jurisdiction mismatch | MVP only supports US/EU; add more regions quarterly |
| Getting sued by a broker for abusing their form | Rate-limit per broker; respect robots / ToS where enforceable; LOAs documented |

## 9. Phased roadmap

**Phase 0 — Validate (2 weeks)**
- Write this doc (✅)
- Build a Claude prompt that, given a Brave Search result, returns `{is_user: bool, removal_tier: 1..4, method_hint: str}` — measure accuracy on 50 hand-labeled results.
- Manually draft 10 GDPR letters with Claude and check quality.

**Phase 1 — MVP single-user (6 weeks)**
- Everything in §5.
- Invite 10 friends. Measure: removals actually confirmed / month.

**Phase 2 — Public beta (8 weeks)**
- Expand broker coverage to 100 via Tier-3 agents.
- Add billing (Stripe).
- Add California DROP integration if API is stable.

**Phase 3 — Scale**
- 500+ brokers, multi-region letters, referral program.
- Enterprise / family plans.

## 10. First decisions I want your input on

1. **Target geo for MVP**: US-only (CCPA + DROP give strong legal footing), or US+EU (GDPR adds leverage but doubles surface area)?
2. **Freemium model**: first scan free + paid monitoring, or trial-based? DeleteMe forces you to pay to even see results — our wedge could be "see what's out there free, pay to auto-remove."
3. **LOA / legal review**: are you OK starting with a template LOA from a privacy-law firm (~$1–2k one-time) before any real user? This is the single biggest blocker to launching for real.
4. **Browser infra**: Browserbase (managed, ~$0.10/session, easy) vs self-hosted Browserless on Fly.io (cheaper at scale, more ops). MVP suggests Browserbase.
5. **Stack specifics**: Next.js + Neon Postgres + Drizzle + Clerk auth + Resend + Cloudflare Email Routing + Browserbase + Brave Search + Anthropic SDK. Any objections before I scaffold?

## References

- [DeleteMe — how it works](https://joindeleteme.com/)
- [Optery help center — opt-out process](https://help.optery.com/en/category/opt-outs-removals-9iljk3/)
- [Big-Ass Data Broker Opt-Out List (yaelwrites)](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List)
- [California DROP — privacy.ca.gov](https://privacy.ca.gov/drop/)
- [CPPA DROP system requirements](https://cppa.ca.gov/regulations/drop.html)
- [Google "Results About You"](https://myactivity.google.com/results-about-you)
- [GDPR Article 17 text](https://www.gdpr-ccpa.org/gdpr-articles/gdpr-article-17-right-to-erasure-(-right-to-be-forgotten-))
- [Vercel function duration / Fluid Compute](https://vercel.com/docs/functions/configuring-functions/duration)
- [Browserbase](https://www.browserbase.com/) · [Stagehand SDK](https://github.com/browserbase/stagehand)
- [Brave Search API pricing](https://api-dashboard.search.brave.com/documentation/pricing)
