import type { TargetPII } from "./claude";

/**
 * Build the search-query permutations we'll fan out to Brave.
 * Strategy: always quote the strongest unique identifier (phone or email);
 * pair name with a locality anchor (address fragment) for name-only queries.
 */
export function buildQueries(pii: TargetPII, maxQueries = 10): string[] {
  const out = new Set<string>();

  for (const phone of pii.phones) out.add(`"${phone}"`);
  for (const email of pii.emails) out.add(`"${email}"`);

  // Phone/email variations to catch formatted differences.
  for (const phone of pii.phones) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 7) out.add(`"${digits}"`);
  }

  // Name + locality combos: use the first locality token from each address.
  const localityTokens = pii.addresses
    .flatMap((a) => a.split(/[,\s]+/).filter((t) => t.length >= 3))
    .slice(0, 3);

  for (const name of pii.names) {
    out.add(`"${name}"`);
    for (const loc of localityTokens) out.add(`"${name}" "${loc}"`);
  }

  return [...out].slice(0, maxQueries);
}
