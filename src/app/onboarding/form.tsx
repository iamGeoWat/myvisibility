"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertTarget } from "@/app/actions";

type Region = "US" | "EU" | "CN";
type Initial = {
  region: Region;
  names: string[];
  phones: string[];
  emails: string[];
  addresses: string[];
  aliases: string[];
};

export function OnboardingForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [region, setRegion] = useState<Region>(initial.region);
  const [names, setNames] = useState(initial.names.join("\n"));
  const [phones, setPhones] = useState(initial.phones.join("\n"));
  const [emails, setEmails] = useState(initial.emails.join("\n"));
  const [addresses, setAddresses] = useState(initial.addresses.join("\n"));
  const [aliases, setAliases] = useState(initial.aliases.join("\n"));

  const toLines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  return (
    <form
      className="mt-8 space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          await upsertTarget({
            region,
            names: toLines(names),
            phones: toLines(phones),
            emails: toLines(emails),
            addresses: toLines(addresses),
            aliases: toLines(aliases),
          });
          router.push("/dashboard");
        });
      }}
    >
      <Field label="Region (legal framework for takedowns)">
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value as Region)}
          className="input"
        >
          <option value="US">United States (CCPA)</option>
          <option value="EU">European Union (GDPR)</option>
          <option value="CN">中国 (个人信息保护法)</option>
        </select>
      </Field>

      <Field label="Names (one per line — include nicknames, maiden names)">
        <textarea
          value={names}
          onChange={(e) => setNames(e.target.value)}
          rows={3}
          className="input font-mono text-sm"
        />
      </Field>
      <Field label="Phone numbers">
        <textarea
          value={phones}
          onChange={(e) => setPhones(e.target.value)}
          rows={3}
          className="input font-mono text-sm"
        />
      </Field>
      <Field label="Email addresses">
        <textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={3}
          className="input font-mono text-sm"
        />
      </Field>
      <Field label="Home / previous addresses">
        <textarea
          value={addresses}
          onChange={(e) => setAddresses(e.target.value)}
          rows={3}
          className="input font-mono text-sm"
        />
      </Field>
      <Field label="Usernames / personal URLs (helps us tell you apart from namesakes — e.g. github.com/iamGeoWat, xikai.me, @mytwitterhandle)">
        <textarea
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          rows={3}
          className="input font-mono text-sm"
        />
      </Field>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {isPending ? "Saving…" : "Save and continue"}
      </button>

      <style>{`.input{width:100%;border:1px solid rgb(0 0 0 / 0.15);border-radius:6px;padding:8px 10px;background:transparent}`}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
