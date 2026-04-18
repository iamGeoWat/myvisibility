# Claude Code handoff

You're picking up an in-progress project. The user (Xikai Liu, handle `iamGeoWat`) is shipping a privacy-protection product — discovery + guide, not auto-removal. This doc tells you what's built, the decisions already made, how to work with him, and what's on deck.

Read this file + `FEASIBILITY.md` + `README.md` before anything substantive. The three overlap a little but each plays a different role:

- **CLAUDE.md** (this file): you ↔ user, working memory, gotchas, what's next.
- **FEASIBILITY.md**: product thesis, competitor analysis, architecture decisions. The source of truth on **why** the scope is what it is.
- **README.md**: setup and deploy, written for a developer who's never seen the repo.

## Project state (as of the handoff)

**Shipped and building cleanly (`pnpm build` passes):**

- Next.js 15 App Router + TypeScript + Tailwind, Clerk auth, Neon Postgres (lazy-initialized), Drizzle ORM, Anthropic SDK, Brave Search API.
- Full end-to-end scan flow: onboarding → `buildQueries()` fans out → Brave → `classifyResult` (Haiku) → `generateRemovalCard` (Sonnet) → findings saved → dashboard renders cards with copy-paste takedown email + direct opt-out URL.
- Region-specific legal framework in generated emails: CCPA (US) · GDPR (EU) · 个保法 §47 (CN).
- Self-published detection: the classifier flags the user's own accounts (LinkedIn/GitHub/personal site) and the generator produces a softer "review your own account" card instead of a takedown.
- Targeted broker queries: `site:<broker> "<name>"` against every entry in `src/data/brokers.json` so brokers are probed by namespace, not just found in general search.
- Background scans via `next/server`'s `after()`; dashboard polls every 3s while `status ∈ {pending, running}`. `maxDuration = 300` on `src/app/dashboard/page.tsx`.
- Phase 0 eval harness: 52 hand-labeled samples across US/CN/EU personas in `evals/samples.json`, runner at `scripts/eval.ts`, `pnpm eval` command.
- Initial Drizzle migration committed at `drizzle/0000_slow_gorilla_man.sql`.

**Not done yet:**

- Not deployed. User is about to import to Vercel and test with his own data (name `Xikai Liu` / `刘曦恺`, phone `6693698894`, email `realgeowat@gmail.com`). First real deployment is the immediate next step.
- Phase 0 eval hasn't been run (needs `ANTHROPIC_API_KEY`). User said "这个可以留到后面" — do not run it proactively; wait for him to ask.
- `src/data/brokers.json` has 12 seed brokers. DeleteMe has ~750, Optery ~955. Expanding is Phase 2.
- No Stripe, no monthly cron re-scans, no WHOIS-based email extraction.
- PII is only Neon-at-rest-encrypted — no app-layer encryption. Acceptable for MVP, not for real users.

## Product thesis — DO NOT DRIFT

We ran a full cycle of scope creep in this session and the user pushed back hard. Do not propose any of these without an explicit ask:

- ❌ LOA / acting as the user's agent
- ❌ Outbound email from our servers (Resend, Postmark, etc.)
- ❌ Headless browser / Browserbase / Stagehand / form filling
- ❌ Inbox automation (Cloudflare Email Routing, reading confirmation emails)
- ❌ California DROP API integration

The product is **"scan → tell the user where they leaked → give them a link or a copy-paste email in the right legal framework → user sends it themselves."** The thesis is that DeleteMe's moat is operational labor, AI can eat most of it, and price can drop 10×. See `FEASIBILITY.md` §2 and §3.

His actual words when I over-engineered: *"replan一下，好像你有点搞复杂了"*.

## How to work with him

He's the first user, he's technical (Apple engineer per public bio), and he's hands-on. Patterns from this session:

- He talks in mixed Chinese + English. Match his register. Respond short. He reads carefully.
- He wants **a plan before code.** We wrote `FEASIBILITY.md` v1 → he read it → asked to simplify → v2 → confirmed stack → then I scaffolded. When in doubt, surface tradeoffs first.
- He approves via short replies (`A`, `ok`, `对`, `确认`). Take those as greenlights, don't ask again.
- He'll ask you to test using his real data. Treat it as consent. Don't put his real phone/email in files committed to git (they are sensitive even though he shared them freely in chat — the eval fixtures use synthetic personas for a reason).
- He redirects decisively when he disagrees. Adjust; don't argue.
- Avoid bloated responses, emojis, exclamation marks, marketing tone.

## Decisions already locked in

Don't relitigate these unless he asks.

| Decision | Source |
|---|---|
| **Stack**: Next.js 15 + Neon + Clerk + Drizzle + Anthropic SDK + Brave Search | `FEASIBILITY.md` §10 + his `确认` |
| **Neon over Supabase** (Vercel-native) | researched + confirmed |
| **No billing, no Stripe in MVP** | Phase 2 |
| **Regions: US + EU + CN** | confirmed |
| **Freemium**: first scan free, $2 per extra scan or $3/mo | his pick |
| **Haiku 4.5 for classify, Sonnet 4.6 for generate** | see `src/lib/claude.ts` `MODEL_*` constants |
| **Classifier threshold: confidence ≥ 0.7** | `CONFIDENCE_THRESHOLD` in `src/lib/scan.ts` |
| **Run scans in `after()`**, poll dashboard every 3s | `src/app/actions.ts` + `src/app/dashboard/scan-status.tsx` |
| **`drizzle/` is tracked**, not gitignored | migrations live in git |

## Stack cheat sheet

```
Next.js 15 App Router (Node runtime, not Edge)
  ├─ @clerk/nextjs               auth; middleware protects /dashboard + /onboarding
  ├─ @neondatabase/serverless    lazy-initialized via Proxy in src/lib/db/index.ts
  ├─ drizzle-orm                 schema in src/lib/db/schema.ts
  ├─ @anthropic-ai/sdk           Haiku classify, Sonnet generate (src/lib/claude.ts)
  └─ Brave Search API            HTTP, no SDK, one-shot (src/lib/brave.ts)

Concurrency: src/lib/concurrency.ts → mapLimit(items, limit, fn).
  Scan fan-out: 4 searches, 8 classify, 4 generate — all parallel.

Dashboard polling: src/app/dashboard/scan-status.tsx setInterval 3s
  while scan.status is pending|running; calls router.refresh().
```

### Commands

```bash
pnpm install
pnpm dev                  # http://localhost:3000
pnpm build                # verifies typecheck + build; needs env (or dummy) vars
pnpm typecheck            # tsc --noEmit, fast, no env needed
pnpm db:generate          # regenerate SQL migration from schema.ts
pnpm db:migrate           # apply migrations to $DATABASE_URL
pnpm eval                 # Phase 0 classifier eval (needs ANTHROPIC_API_KEY)
pnpm eval --persona jordan_us --limit 10
```

### Env vars

See `.env.example`. Four keys needed at runtime: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `BRAVE_SEARCH_API_KEY`.

## Gotchas

1. **`pnpm build` without env**: Clerk validates the publishable key at build time; Neon would instantiate if not lazy. If the build breaks later, check:
   - `src/app/page.tsx` has `export const dynamic = "force-dynamic"` — don't remove without a real Clerk key in the build env.
   - `src/lib/db/index.ts` uses a `Proxy` to defer `neon(url)` until first use. Don't replace with direct `const sql = neon(...)`.

2. **`after()` import**: it's `import { after } from "next/server"` in Next 15. Not `unstable_after`.

3. **`maxDuration`** must be on a route segment (page/layout/route handler), not on a server action. We set it on `src/app/dashboard/page.tsx`. If you add more action-heavy pages, propagate.

4. **Vercel Hobby** caps function duration at 60s regardless of our `maxDuration = 300`. Expect scans to truncate there. The user hasn't picked Pro yet — if scans truncate on first test, reduce `maxQueries` in `src/lib/queries.ts` (currently 40) or upgrade.

5. **Clerk middleware matcher**: `middleware.ts` excludes `_next` and static assets. If new protected routes are added, update `isProtectedRoute`.

6. **Scan reads live**: dashboard query is `findings.scanId = latest.id`. As findings insert during the run, polling shows them. Don't batch the insert at the end or the live-render UX breaks.

7. **Data broker list**: `src/data/brokers.json` is the seed. Adding entries: only need `name`, `hostnames` (all variants), `optOutUrl`, optional `contactEmail`, `notes`. The classifier doesn't read this file; `src/lib/brokers.ts`'s `matchBroker(url)` routes a finding's URL to its broker via hostname.

8. **Classifier output schema**: keep `{isUser, confidence, bucket, matchedFields, sourceIsSelfPublished}` in sync across `src/lib/claude.ts` (`ClassifyOutput`), `src/lib/scan.ts` (what it consumes), and the system prompt. The prompt JSON-parses with `JSON.parse(text)` — adding fields requires updating all three.

## Next up (priority order)

1. **Deploy to Vercel.** The user's next action. You should expect him to come back with the production URL or an issue from logs. Be ready to debug: check Vercel function logs, Neon query logs, Clerk sign-in flow, Brave API usage.
2. **Post-deploy smoke test**: run a scan on his own PII. Expect most findings to be his voluntarily-published accounts (GitHub `iamGeoWat`, `xikai.me`, LinkedIn). The previous test (simulated with WebSearch) found zero broker listings because his phone/email aren't indexed — good for him, less impressive as a demo. Consider a second persona with a known-exposed identity.
3. **Run Phase 0 eval** once he's ready — `pnpm eval` on the 52 samples. If precision < 85%, iterate `CLASSIFY_SYSTEM` in `src/lib/claude.ts`.
4. **Expand `brokers.json`** — target 50+ high-value brokers from the Big-Ass Data Broker Opt-Out List.
5. **Stripe billing** (Phase 2) — $2 per scan / $3 monthly.
6. **Monthly cron re-scan** (Phase 2) — Vercel Cron.
7. **App-layer PII encryption** before real users.

## Branching

Work this session happened on `claude/privacy-protection-search-Ebc62` (mandated by the session system prompt). Your branch policy may differ — follow your own instructions, but inherit the code from this branch.

## One thing to remember

When he says something like "*好像你有点搞复杂了*" — stop, don't defend, replan smaller. That was the best moment in this session.
