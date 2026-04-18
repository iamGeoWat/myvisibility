"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { runScan } from "@/lib/scan";

const upsertTargetSchema = z.object({
  region: z.enum(["US", "EU", "CN"]),
  names: z.array(z.string().min(1)).max(10),
  phones: z.array(z.string().min(4)).max(10),
  emails: z.array(z.string().email()).max(10),
  addresses: z.array(z.string().min(3)).max(10),
});

async function requireUserId() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthenticated");
  return userId;
}

export async function upsertTarget(input: z.infer<typeof upsertTargetSchema>) {
  const userId = await requireUserId();
  const parsed = upsertTargetSchema.parse(input);

  await db
    .insert(schema.users)
    .values({ id: userId, region: parsed.region })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { region: parsed.region },
    });

  const existing = await db
    .select()
    .from(schema.targets)
    .where(eq(schema.targets.userId, userId));

  if (existing.length) {
    await db
      .update(schema.targets)
      .set({
        names: parsed.names,
        phones: parsed.phones,
        emails: parsed.emails,
        addresses: parsed.addresses,
        updatedAt: new Date(),
      })
      .where(eq(schema.targets.userId, userId));
  } else {
    await db.insert(schema.targets).values({
      userId,
      names: parsed.names,
      phones: parsed.phones,
      emails: parsed.emails,
      addresses: parsed.addresses,
    });
  }

  revalidatePath("/dashboard");
}

export async function startScan() {
  const userId = await requireUserId();
  const [scan] = await db
    .insert(schema.scans)
    .values({ userId, status: "pending" })
    .returning();

  // Fire-and-forget; runScan awaits Claude + Brave sequentially.
  // For MVP single-user, this fits in a 60s serverless window.
  // Phase 2 moves this to a queue.
  runScan(userId, scan.id).catch((err) => {
    console.error("scan failed", scan.id, err);
  });

  revalidatePath("/dashboard");
  return scan.id;
}

export async function markFindingDone(findingId: string, done: boolean) {
  const userId = await requireUserId();
  await db
    .update(schema.findings)
    .set({ userMarkedDone: done })
    .where(
      and(eq(schema.findings.id, findingId), eq(schema.findings.userId, userId)),
    );
  revalidatePath("/dashboard");
}
