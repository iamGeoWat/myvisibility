"use client";

import { useState, useTransition } from "react";
import { markFindingDone } from "@/app/actions";

type Finding = {
  id: string;
  url: string;
  pageTitle: string | null;
  snippet: string | null;
  bucket: string;
  difficulty: string;
  confidence: number;
  matchedFields: string[];
  removalTitle: string | null;
  removalActionUrl: string | null;
  removalContactEmail: string | null;
  removalEmailSubject: string | null;
  removalEmailBody: string | null;
  removalLegalHint: string | null;
  userMarkedDone: boolean;
};

const bucketLabel: Record<string, string> = {
  broker: "Data broker",
  search_cache: "Search engine",
  news: "News / blog",
  social: "Social media",
  gov_record: "Public record",
  other: "Other",
};

const difficultyColor: Record<string, string> = {
  easy: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
  hard: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function FindingCard({ f }: { f: Finding }) {
  const [done, setDone] = useState(f.userMarkedDone);
  const [, start] = useTransition();
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);

  function copy(kind: "subject" | "body") {
    const text =
      kind === "subject" ? f.removalEmailSubject : f.removalEmailBody;
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <li
      className={`rounded-lg border border-neutral-200 p-5 dark:border-neutral-800 ${
        done ? "opacity-50" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium dark:bg-neutral-800">
          {bucketLabel[f.bucket] ?? f.bucket}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${difficultyColor[f.difficulty] ?? ""}`}
        >
          {f.difficulty}
        </span>
        <span className="text-neutral-500">
          matched: {f.matchedFields.join(", ") || "?"} ·{" "}
          {Math.round(f.confidence * 100)}%
        </span>
      </div>

      <a
        href={f.url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 block font-medium hover:underline"
      >
        {f.pageTitle || f.url}
      </a>
      <p className="mt-1 truncate text-xs text-neutral-500">{f.url}</p>
      {f.snippet && (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {f.snippet}
        </p>
      )}

      {f.removalTitle && (
        <div className="mt-4 rounded-md bg-neutral-50 p-4 text-sm dark:bg-neutral-900">
          <p className="font-medium">{f.removalTitle}</p>
          {f.removalLegalHint && (
            <p className="mt-1 text-xs text-neutral-500">
              {f.removalLegalHint}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {f.removalActionUrl && (
              <a
                href={f.removalActionUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
              >
                Open opt-out page
              </a>
            )}
            {f.removalContactEmail && (
              <a
                href={`mailto:${f.removalContactEmail}?subject=${encodeURIComponent(
                  f.removalEmailSubject ?? "",
                )}&body=${encodeURIComponent(f.removalEmailBody ?? "")}`}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
              >
                Email {f.removalContactEmail}
              </a>
            )}
          </div>

          {f.removalEmailBody && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-neutral-600 dark:text-neutral-400">
                Show takedown email template
              </summary>
              <div className="mt-2 space-y-2">
                {f.removalEmailSubject && (
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-xs text-neutral-500">
                      Subject
                    </span>
                    <code className="flex-1 rounded bg-white px-2 py-1 text-xs dark:bg-neutral-950">
                      {f.removalEmailSubject}
                    </code>
                    <button
                      onClick={() => copy("subject")}
                      className="text-xs text-blue-600"
                    >
                      {copied === "subject" ? "✓" : "Copy"}
                    </button>
                  </div>
                )}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-neutral-500">Body</span>
                    <button
                      onClick={() => copy("body")}
                      className="text-xs text-blue-600"
                    >
                      {copied === "body" ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap rounded bg-white p-3 text-xs dark:bg-neutral-950">
                    {f.removalEmailBody}
                  </pre>
                </div>
              </div>
            </details>
          )}
        </div>
      )}

      <div className="mt-3">
        <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => {
              const next = e.target.checked;
              setDone(next);
              start(() => markFindingDone(f.id, next));
            }}
          />
          I've submitted the removal request
        </label>
      </div>
    </li>
  );
}
