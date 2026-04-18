import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { braveSearch, type BraveResult } from "./brave";
import { buildQueries } from "./queries";
import { matchBroker } from "./brokers";
import {
  classifyResult,
  generateRemovalCard,
  type Region,
  type TargetPII,
} from "./claude";

const CONFIDENCE_THRESHOLD = 0.7;

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
    const queries = buildQueries(pii);
    const region = user.region as Region;

    // Fan out queries, dedupe by URL.
    const seen = new Map<string, BraveResult>();
    for (const q of queries) {
      const results = await braveSearch(q, 20);
      for (const r of results) if (!seen.has(r.url)) seen.set(r.url, r);
    }

    let kept = 0;
    for (const r of seen.values()) {
      const cls = await classifyResult({
        pii,
        result: { title: r.title, url: r.url, snippet: r.description },
      });
      if (!cls.isUser || cls.confidence < CONFIDENCE_THRESHOLD) continue;

      const knownBroker = matchBroker(r.url);
      const card = await generateRemovalCard({
        pii,
        region,
        result: { title: r.title, url: r.url, snippet: r.description },
        bucket: cls.bucket,
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
        removalTitle: card.title,
        removalActionUrl: card.actionUrl ?? null,
        removalContactEmail: card.contactEmail ?? null,
        removalEmailSubject: card.emailSubject ?? null,
        removalEmailBody: card.emailBody ?? null,
        removalLegalHint: card.legalHint,
      });
      kept++;
    }

    await db
      .update(schema.scans)
      .set({
        status: "done",
        queriesRun: queries.length,
        resultsSeen: seen.size,
        findingsKept: kept,
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
