import type { TargetPII } from "./claude";
import { allBrokers } from "./brokers";

/**
 * Build the search-query permutations we'll fan out to Brave.
 *
 * Strategy:
 *  1. Quote the strongest unique identifiers (phone + email) exactly.
 *  2. Add formatted-phone variations to catch e.g. (415) 555-1212 vs 4155551212.
 *  3. For each known data broker hostname, issue `site:<broker> "<name>"`
 *     — we can't rely on Brave indexing every broker profile page for a
 *     name-only query, but site-restricted queries cut through namespace
 *     ambiguity. When address info exists, include a locality token.
 *  4. Fan out name × locality for general web queries too.
 */
export function buildQueries(pii: TargetPII, maxQueries = 40): string[] {
  const out = new Set<string>();

  // (1) strong identifiers
  for (const phone of pii.phones) out.add(`"${phone}"`);
  for (const email of pii.emails) out.add(`"${email}"`);

  // (2) phone variations
  for (const phone of pii.phones) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 10) {
      const a = digits.slice(-10, -7);
      const b = digits.slice(-7, -4);
      const c = digits.slice(-4);
      out.add(`"(${a}) ${b}-${c}"`);
      out.add(`"${a}-${b}-${c}"`);
    }
    if (digits.length >= 7 && digits !== phone) out.add(`"${digits}"`);
  }

  const localityTokens = pii.addresses
    .flatMap((a) => a.split(/[,\s]+/).filter((t) => t.length >= 3))
    .slice(0, 3);

  // (3) site-restricted broker queries
  const brokers = allBrokers();
  for (const name of pii.names) {
    for (const broker of brokers) {
      const host = broker.hostnames[0];
      if (localityTokens.length) {
        for (const loc of localityTokens) {
          out.add(`site:${host} "${name}" "${loc}"`);
        }
      } else {
        out.add(`site:${host} "${name}"`);
      }
    }
  }

  // (4) general web name + locality
  for (const name of pii.names) {
    out.add(`"${name}"`);
    for (const loc of localityTokens) out.add(`"${name}" "${loc}"`);
  }

  return [...out].slice(0, maxQueries);
}
