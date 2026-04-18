# MyVisibility

Find where your personal info is exposed on the public web, and get direct
opt-out links + copy-paste takedown emails in the right legal framework
(CCPA / GDPR / PIPL). Discovery + guidance, not auto-removal.

See `FEASIBILITY.md` for product thesis, architecture, and roadmap.

## Stack

- Next.js 15 (App Router) on Vercel
- Neon Postgres + Drizzle ORM
- Clerk auth
- Brave Search API (scan)
- Anthropic SDK (Haiku 4.5 classify · Sonnet 4.6 generate)

## Setup

1. `pnpm install`
2. Copy `.env.example` → `.env.local` and fill in:
   - Clerk keys: https://dashboard.clerk.com → new application
   - Neon Postgres: https://vercel.com/marketplace/neon (or console.neon.tech);
     set `DATABASE_URL` to the pooled connection string
   - Anthropic API key: https://console.anthropic.com
   - Brave Search API key: https://api-dashboard.search.brave.com
3. `pnpm db:generate && pnpm db:migrate` — create tables
4. `pnpm dev` — http://localhost:3000

## Flow

1. User signs in (Clerk) and enters their PII + region on `/onboarding`.
2. User clicks **Run scan** on `/dashboard`.
3. Server action `startScan`:
   - Builds ~10 Brave Search queries from the PII
   - Haiku classifies each result (is this actually about the user? what bucket?)
   - For kept results (confidence ≥ 0.7), Sonnet generates a removal card:
     direct opt-out URL (from `src/data/brokers.json` if known), contact email,
     region-appropriate takedown email, legal hint
4. Dashboard renders cards; user copies email / opens opt-out link / marks done.

## Key files

```
src/lib/claude.ts         Classify + generate prompts
src/lib/brave.ts          Brave Search client
src/lib/brokers.ts        hostname → known opt-out URL lookup
src/lib/queries.ts        Build search-query permutations from PII
src/lib/scan.ts           The scan pipeline
src/lib/db/schema.ts      Drizzle schema
src/app/actions.ts        Server actions (upsertTarget, startScan, markDone)
src/app/onboarding/       PII input form
src/app/dashboard/        Findings view + scan button
src/data/brokers.json     Known data-broker opt-out seed list
```

## Phase 0 validation (before shipping MVP)

The single biggest risk is Claude's `is_user` accuracy. Before wiring up
billing, hand-label ≥50 real Brave Search results against a test persona and
measure the classifier. Target: ≥85% precision on `isUser=true`.

## License

TBD.
