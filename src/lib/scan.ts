import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { braveSearch, type BraveResult } from "./brave";
import { buildQueries } from "./queries";
import { matchBroker } from "./brokers";
import {
  classifyResult,
  generateRemovalCard,
  type ClassifyOutput,
  type Region,
  type TargetPII,
} from "./claude";
import { mapLimit } from "./concurrency";

const CONFIDENCE_THRESHOLD = 0.7;
const SEARCH_CONCURRENCY = 4;
const CLASSIFY_CONCURRENCY = 8;
const GENERATE_CONCURRENCY = 4;

export async function runScan(userId: string, scanId: string) {
  await db
    .update(schema.scans)
    .set({ status: "running" })
    .where(eq(schema.scans.id, scanId));

  try {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    const [target] = await db
      .select()
      .from(schema.targets)
      .where(eq(schema.targets.userId, userId));
    if (!user || !target) throw new Error("user or target missing");

    const pii: TargetPII = {
      names: target.names,
      phones: target.phones,
      emails: target.emails,
      addresses: target.addresses,
    };
    const aliases = target.aliases;
    const queries = buildQueries(pii);
    const region = user.region as Region;

    // Fan out searches in parallel, dedupe by URL.
    const searchResults = await mapLimit(queries, SEARCH_CONCURRENCY, (q) =>
      braveSearch(q, 20).catch((err) => {
        console.error(`brave search failed for "${q}"`, err);
        return [] as BraveResult[];
      }),
    );
    const seen = new Map<string, BraveResult>();
    for (const batch of searchResults) {
      for (const r of batch) if (!seen.has(r.url)) seen.set(r.url, r);
    }
    const unique = [...seen.values()];

    // Classify everything in parallel.
    const classified = await mapLimit(unique, CLASSIFY_CONCURRENCY, (r) =>
      classifyResult({
        pii,
        aliases,
        result: { title: r.title, url: r.url, snippet: r.description },
      }).catch((err) => {
        console.error(`classify failed for ${r.url}`, err);
        return null;
      }),
    );

    // Keep only high-confidence user matches.
    type Kept = { r: BraveResult; cls: ClassifyOutput };
    const kept: Kept[] = [];
    for (let i = 0; i < unique.length; i++) {
      const cls = classified[i];
      if (!cls) continue;
      if (!cls.isUser) continue;
      if (cls.confidence < CONFIDENCE_THRESHOLD) continue;
      kept.push({ r: unique[i], cls });
    }

    // Generate removal cards in parallel, insert as we go.
    await mapLimit(kept, GENERATE_CONCURRENCY, async ({ r, cls }) => {
      try {
        const knownBroker = matchBroker(r.url);
        const card = await generateRemovalCard({
          pii,
          region,
          result: { title: r.title, url: r.url, snippet: r.description },
          bucket: cls.bucket,
          sourceIsSelfPublished: cls.sourceIsSelfPublished,
          knownBroker: knownBroker
            ? {
                name: knownBroker.name,
                optOutUrl: knownBroker.optOutUrl,
                contactEmail: knownBroker.contactEmail ?? undefined,
                notes: knownBroker.notes,
              }
            : undefined,
        });
        await db.insert(schema.findings).values({
          scanId,
          userId,
          url: r.url,
          pageTitle: r.title,
          snippet: r.description,
          bucket: cls.bucket,
          difficulty: card.difficulty,
          confidence: cls.confidence,
          matchedFields: cls.matchedFields,
          sourceIsSelfPublished: cls.sourceIsSelfPublished,
          removalTitle: card.title,
          removalActionUrl: card.actionUrl ?? null,
          removalContactEmail: card.contactEmail ?? null,
          removalEmailSubject: card.emailSubject ?? null,
          removalEmailBody: card.emailBody ?? null,
          removalLegalHint: card.legalHint,
        });
      } catch (err) {
        console.error(`generate/insert failed for ${r.url}`, err);
      }
    });

    const kc = await db
      .select({ id: schema.findings.id })
      .from(schema.findings)
      .where(eq(schema.findings.scanId, scanId));
    await db
      .update(schema.scans)
      .set({
        status: "done",
        queriesRun: queries.length,
        resultsSeen: unique.length,
        findingsKept: kc.length,
        finishedAt: new Date(),
      })
      .where(eq(schema.scans.id, scanId));
  } catch (err) {
    await db
      .update(schema.scans)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      })
      .where(and(eq(schema.scans.id, scanId), eq(schema.scans.userId, userId)));
    throw err;
  }
}
