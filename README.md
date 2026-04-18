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

## Local setup

```bash
pnpm install
cp .env.example .env.local  # fill in the four keys — see below
pnpm db:migrate             # apply migrations to your Neon DB
pnpm dev                    # http://localhost:3000
```

### Getting the four keys

| Env var | Where |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | https://dashboard.clerk.com → new application |
| `DATABASE_URL` | Neon: either https://console.neon.tech or (on Vercel) add Neon from the marketplace — it auto-populates |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| `BRAVE_SEARCH_API_KEY` | https://api-dashboard.search.brave.com (Data for AI plan, ~$3/1k queries) |

## Deploying to Vercel

1. Push this repo to GitHub (it's already set up on the `claude/…` branch).
2. On https://vercel.com/new, import the repo.
3. **Storage → Neon** from the Vercel marketplace; select/create a Neon
   project. This automatically sets `DATABASE_URL`.
4. **Settings → Environment Variables**, add the remaining four keys
   (Clerk × 2, Anthropic, Brave).
5. Deploy. The first build will produce a live URL.
6. Run migrations once against the production DB:
   ```bash
   DATABASE_URL="<neon-pooled-url>" pnpm db:migrate
   ```
   (Grab the URL from Vercel → Settings → Environment Variables → Neon
   integration, or the Neon console.)
7. Visit the URL, sign up, complete onboarding, run a scan.

Notes:
- `src/app/dashboard/page.tsx` sets `maxDuration = 300`. On Hobby the
  cap is 60s, so long scans (many queries) will be truncated; upgrade to
  Pro for full runs or reduce `buildQueries`' limit.
- Scans run in `after()` so the UI returns immediately and findings
  stream into the dashboard; the client polls every 3s while the scan
  is active.

## Flow

1. User signs in (Clerk) and enters PII + region on `/onboarding`.
   Optional "aliases" (usernames, personal URLs) help the classifier
   distinguish the user from namesakes.
2. User clicks **Run scan** on `/dashboard`.
3. Server action `startScan`:
   - Builds ~10–40 Brave queries (strong identifiers + name×locality +
     `site:<broker>` for every known broker).
   - Haiku classifies each result: `{isUser, confidence, bucket,
     matchedFields, sourceIsSelfPublished}`.
   - For confidence ≥ 0.7 hits, Sonnet generates a region-appropriate
     removal card (takedown email for third-party exposure, or
     "review your own account" for self-published content).
4. Dashboard polls while running; cards appear live.

## Key files

```
src/lib/claude.ts         Classify + generate prompts
src/lib/brave.ts          Brave Search client
src/lib/brokers.ts        Hostname → known opt-out URL lookup
src/lib/queries.ts        Build search-query permutations
src/lib/scan.ts           The parallelized scan pipeline
src/lib/concurrency.ts    mapLimit() helper
src/lib/db/schema.ts      Drizzle schema
src/app/actions.ts        Server actions (upsertTarget, startScan, markDone)
src/app/onboarding/       PII input form
src/app/dashboard/        Findings view + scan button + polling
src/data/brokers.json     Known data-broker opt-out seed list
drizzle/                  SQL migrations
```

## Phase 0 validation

The single biggest risk is Claude's `isUser` accuracy. Ship broadly only if
**precision ≥ 85%** on a held-out eval set (false positives waste users on
phantom takedowns more than false negatives hurt).

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm eval                      # run all ~50 labeled samples
pnpm eval --persona jordan_us  # filter
pnpm eval --limit 10           # smoke test
```

The runner (`scripts/eval.ts`) prints a confusion matrix + precision /
recall / F1 / bucket accuracy / self-published accuracy, plus per-sample
disagreements. Exit code is non-zero if precision < 85% so it can gate CI.

Add new samples to `evals/samples.json`. Personas are synthetic.

## License

TBD.
