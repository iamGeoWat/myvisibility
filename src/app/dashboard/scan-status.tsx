"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type ScanRow = {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  queriesRun: number;
  resultsSeen: number;
  findingsKept: number;
  error: string | null;
  startedAt: string | Date;
  finishedAt: string | Date | null;
};

export function ScanStatus({ scan }: { scan: ScanRow | null }) {
  const router = useRouter();
  const active = scan && (scan.status === "pending" || scan.status === "running");

  // Poll every 3s while a scan is in flight.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);

  if (!scan) {
    return (
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        No scans yet. Click <strong>Run scan</strong> to start your first one.
      </p>
    );
  }

  const started =
    typeof scan.startedAt === "string"
      ? new Date(scan.startedAt)
      : scan.startedAt;

  return (
    <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
      {active ? (
        <>
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500 align-middle" />{" "}
          Scan {scan.status} · started {relative(started)} · findings appear
          live
        </>
      ) : scan.status === "done" ? (
        <>
          Last scan: done · {scan.findingsKept} findings from {scan.resultsSeen}{" "}
          results across {scan.queriesRun} queries
        </>
      ) : (
        <>Last scan: failed{scan.error ? ` — ${scan.error}` : ""}</>
      )}
    </p>
  );
}

function relative(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
