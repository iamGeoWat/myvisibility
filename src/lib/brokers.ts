import brokersData from "@/data/brokers.json";

export type Broker = {
  name: string;
  hostnames: string[];
  optOutUrl?: string;
  contactEmail?: string | null;
  notes?: string;
};

const brokers = brokersData as Broker[];

const hostIndex: Map<string, Broker> = new Map();
for (const b of brokers) {
  for (const h of b.hostnames) hostIndex.set(h.toLowerCase(), b);
}

export function matchBroker(url: string): Broker | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return hostIndex.get(host) ?? hostIndex.get(host.replace(/^www\./, ""));
  } catch {
    return undefined;
  }
}

export function allBrokers(): Broker[] {
  return brokers;
}
