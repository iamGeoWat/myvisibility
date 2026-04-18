import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { StartScanButton } from "./start-scan";
import { FindingCard } from "./finding-card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const [target] = await db
    .select()
    .from(schema.targets)
    .where(eq(schema.targets.userId, userId));
  if (!target) redirect("/onboarding");

  const latestScans = await db
    .select()
    .from(schema.scans)
    .where(eq(schema.scans.userId, userId))
    .orderBy(desc(schema.scans.startedAt))
    .limit(1);
  const latest = latestScans[0];

  const items = latest
    ? await db
        .select()
        .from(schema.findings)
        .where(eq(schema.findings.scanId, latest.id))
        .orderBy(desc(schema.findings.confidence))
    : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your exposure</h1>
        <div className="flex gap-2">
          <Link
            href="/onboarding"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
          >
            Edit targets
          </Link>
          <StartScanButton />
        </div>
      </div>

      {latest && (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Last scan: {latest.status} · {latest.findingsKept} findings from{" "}
          {latest.resultsSeen} results across {latest.queriesRun} queries
          {latest.error ? ` · error: ${latest.error}` : ""}
        </p>
      )}

      {!latest && (
        <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
          No scans yet. Click <strong>Run scan</strong> to start your first one.
        </p>
      )}

      <ul className="mt-8 space-y-4">
        {items.map((f) => (
          <FindingCard key={f.id} f={f} />
        ))}
      </ul>
    </main>
  );
}
