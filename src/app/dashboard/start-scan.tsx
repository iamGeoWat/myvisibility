"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { startScan } from "@/app/actions";

export function StartScanButton() {
  const router = useRouter();
  const [isPending, start] = useTransition();
  return (
    <button
      disabled={isPending}
      onClick={() =>
        start(async () => {
          await startScan();
          router.refresh();
        })
      }
      className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
    >
      {isPending ? "Starting…" : "Run scan"}
    </button>
  );
}
