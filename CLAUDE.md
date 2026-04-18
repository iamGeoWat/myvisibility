# Claude Code handoff

You're picking up an in-progress project: a privacy-protection product — discovery + guide, not auto-removal. This doc captures what's built and the technical state.

Read alongside `FEASIBILITY.md` (product thesis, architecture, competitor analysis) and `README.md` (setup + deploy).

## Project state

**Shipped and building cleanly (`pnpm build` passes with env or dummy vars):**

- Next.js 15 App Router + TypeScript + Tailwind, Clerk auth, Neon Postgres (lazy-initialized), Drizzle ORM, Anthropic SDK, Brave Search API.
- Full end-to-end scan flow: onboarding → `buildQueries()` fans out → Brave → `classifyResult` (Haiku) → `generateRemovalCard` (Sonnet) → findings saved → dashboard renders cards with copy-paste takedown email + direct opt-out URL.
- Region-specific legal framework in generated emails: CCPA (US) · GDPR (EU) · 个保法 §47 (CN).
- Self-published detection: classifier flags accounts the user owns (LinkedIn/GitHub/personal site) and the generator produces a softer "review your own account" card instead of a takedown.
- Targeted broker queries: `site:<broker> "<name>"` against every entry in `src/data/brokers.json`.
- Background scans via `next/server`'s `after()`; dashboard polls every 3s while `status ∈ {pending, running}`. `maxDuration = 300` on `src/app/dashboard/page.tsx`.
- Phase 0 eval harness: 52 hand-labeled samples across US/CN/EU personas in `evals/samples.json`, runner at `scripts/eval.ts`, `pnpm eval` command. Hasn't been run yet.
- Initial Drizzle migration committed at `drizzle/0000_slow_gorilla_man.sql`.

**Not done yet:**

- Not deployed. Vercel import is the immediate next step.
- `src/data/brokers.json` has 12 seed brokers. Expanding toward 50–200 is Phase 2.
- No Stripe, no monthly cron re-scans, no WHOIS-based email extraction.
- PII is only Neon-at-rest-encrypted — no app-layer encryption. Acceptable for MVP, not for real users.

## Product thesis

The product is **"scan → tell the user where they leaked → give them a link or a copy-paste email in the right legal framework → user sends it themselves."** Thesis: DeleteMe's moat is operational labor, AI can eat most of it, price drops 10×. See `FEASIBILITY.md` §2–3.

Several adjacent directions were considered and deferred during planning — not because they're bad ideas, but because they push scope toward DeleteMe-style automation and away from the thin-guide product:

- Acting as the user's agent (LOA) — we inform, they submit.
- Outbound email from our servers (Resend/Postmark). The user sends from their own inbox.
- Headless-browser form filling (Browserbase/Stagehand).
- Inbox automation (Cloudflare Email Routing + reading confirmation mails).
- California DROP API integration.

Revisit any of these if the product later moves up-market, but the current scope deliberately avoids them.

## Technical decisions

| Decision | Notes |
|---|---|
| **Stack**: Next.js 15 + Neon + Clerk + Drizzle + Anthropic SDK + Brave Search | see `FEASIBILITY.md` §10 |
| Neon over Supabase | Vercel-native marketplace integration |
| No billing / Stripe in MVP | Phase 2 |
| Regions: US + EU + CN | legal templates only differ by region |
| Freemium: first scan free, $2 per extra scan or $3/mo | Phase 2 wiring |
| Haiku 4.5 classify, Sonnet 4.6 generate | `MODEL_*` in `src/lib/claude.ts` |
| Classifier confidence threshold: 0.7 | `CONFIDENCE_THRESHOLD` in `src/lib/scan.ts` |
| Scans run in `after()`; dashboard polls every 3s | `src/app/actions.ts` + `src/app/dashboard/scan-status.tsx` |
| `drizzle/` is tracked, not gitignored | migrations live in git |

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

See `.env.example`. Five keys at runtime: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `BRAVE_SEARCH_API_KEY`.

## Gotchas

1. **`pnpm build` without env**: Clerk validates the publishable key at build time; Neon would instantiate if not lazy. If a build breaks:
   - `src/app/page.tsx` has `export const dynamic = "force-dynamic"` — don't remove without a real Clerk key in the build env.
   - `src/lib/db/index.ts` uses a `Proxy` to defer `neon(url)` until first use. Don't replace with a direct `const sql = neon(...)`.

2. **`after()` import**: `import { after } from "next/server"` in Next 15. Not `unstable_after`.

3. **`maxDuration`** must be on a route segment (page/layout/route handler), not on a server action. Currently set on `src/app/dashboard/page.tsx`. If you add action-heavy pages, propagate.

4. **Vercel Hobby** caps function duration at 60s regardless of `maxDuration = 300`. Scans will truncate there. If that happens, lower `maxQueries` in `src/lib/queries.ts` (currently 40) or upgrade to Pro.

5. **Clerk middleware matcher**: `middleware.ts` excludes `_next` and static assets. If new protected routes are added, update `isProtectedRoute`.

6. **Findings insert is live, not batched**: dashboard query is `findings.scanId = latest.id`. Insertions during the run are picked up by polling. Don't change to batch-at-end or the live-render UX breaks.

7. **Data broker list**: `src/data/brokers.json` is the seed. Adding entries: `name`, `hostnames` (all variants), `optOutUrl`, optional `contactEmail`, `notes`. The classifier doesn't read this file; `src/lib/brokers.ts`'s `matchBroker(url)` routes a finding's URL to its broker via hostname.

8. **Classifier output schema**: keep `{isUser, confidence, bucket, matchedFields, sourceIsSelfPublished}` in sync across `src/lib/claude.ts` (`ClassifyOutput`), `src/lib/scan.ts` (consumer), and the system prompt. The prompt output is parsed with `JSON.parse(text)` — adding fields means updating all three.

9. **Eval fixtures use synthetic personas only.** Do not commit real PII to `evals/samples.json`.

## Next up (priority order)

1. **Deploy to Vercel.** Import repo → Neon marketplace integration → set Clerk/Anthropic/Brave env vars → `pnpm db:migrate` once locally against the production `DATABASE_URL`.
2. **Post-deploy smoke test** on a real persona. Voluntary public accounts (GitHub, personal site, LinkedIn) will be the most common findings; broker listings need an address to query effectively.
3. **Run Phase 0 eval** — `pnpm eval` on the 52 samples. Iterate `CLASSIFY_SYSTEM` in `src/lib/claude.ts` until precision ≥ 85%.
4. **Expand `brokers.json`** — target 50+ from the Big-Ass Data Broker Opt-Out List.
5. **Stripe billing** (Phase 2) — $2 per scan / $3 monthly.
6. **Monthly cron re-scan** (Phase 2) — Vercel Cron.
7. **App-layer PII encryption** before real users.

## Branching

Work so far is on `claude/privacy-protection-search-Ebc62`. Follow whatever branch policy your session specifies; inherit the code from this branch.
