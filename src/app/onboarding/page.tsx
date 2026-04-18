import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { OnboardingForm } from "./form";

export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const [target] = await db
    .select()
    .from(schema.targets)
    .where(eq(schema.targets.userId, userId));
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Tell us what to look for</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        We search the public web for these values. They're stored encrypted
        and only sent to the search/classify pipeline when you run a scan.
      </p>
      <OnboardingForm
        initial={{
          region: (user?.region as "US" | "EU" | "CN") ?? "US",
          names: target?.names ?? [],
          phones: target?.phones ?? [],
          emails: target?.emails ?? [],
          addresses: target?.addresses ?? [],
        }}
      />
    </main>
  );
}
