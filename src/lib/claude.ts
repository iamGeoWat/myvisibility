import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Classify model: cheap, high-throughput. Generate model: better prose for
// region-specific takedown emails.
export const MODEL_CLASSIFY = "claude-haiku-4-5-20251001";
export const MODEL_GENERATE = "claude-sonnet-4-6";

export type Region = "US" | "EU" | "CN";

export type TargetPII = {
  names: string[];
  phones: string[];
  emails: string[];
  addresses: string[];
};

export type Bucket =
  | "broker"
  | "search_cache"
  | "news"
  | "social"
  | "gov_record"
  | "other";

export type Difficulty = "easy" | "medium" | "hard";

export type ClassifyInput = {
  pii: TargetPII;
  result: { title: string; url: string; snippet: string };
};

export type ClassifyOutput = {
  isUser: boolean;
  confidence: number; // 0..1
  bucket: Bucket;
  matchedFields: string[]; // e.g. ["name", "phone"]
};

const CLASSIFY_SYSTEM = `You are a privacy analyst. Given a search result and a
target person's PII, decide whether the result is actually about that specific
person (not a namesake) and which removal channel applies.

Rules:
- Require at least TWO corroborating fields to return isUser=true with
  confidence ≥ 0.7. A matching name alone is NOT enough.
- bucket: "broker" = people-search sites (Spokeo, Whitepages, BeenVerified,
  Radaris, Intelius, etc.); "search_cache" = a Google/Bing cache or SERP page
  directly; "news" = news article or blog; "social" = LinkedIn/Facebook/Twitter/
  Instagram/etc.; "gov_record" = court, permit, or school directory;
  "other" = anything else.
- matchedFields: subset of ["name", "phone", "email", "address"].

Output ONLY a single JSON object, no prose, no markdown fences.
Schema: {"isUser": boolean, "confidence": number, "bucket": string, "matchedFields": string[]}`;

export async function classifyResult(input: ClassifyInput): Promise<ClassifyOutput> {
  const res = await anthropic.messages.create({
    model: MODEL_CLASSIFY,
    max_tokens: 200,
    system: CLASSIFY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `TARGET PII:
${JSON.stringify(input.pii, null, 2)}

SEARCH RESULT:
Title: ${input.result.title}
URL: ${input.result.url}
Snippet: ${input.result.snippet}`,
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text) as ClassifyOutput;
}

export type RemovalCard = {
  title: string;
  difficulty: Difficulty;
  actionUrl?: string;
  contactEmail?: string;
  emailSubject?: string;
  emailBody?: string;
  legalHint: string;
};

export type GenerateCardInput = {
  pii: TargetPII;
  region: Region;
  result: { title: string; url: string; snippet: string };
  bucket: Bucket;
  knownBroker?: {
    name: string;
    optOutUrl?: string;
    contactEmail?: string;
    notes?: string;
  };
};

const GENERATE_SYSTEM = `You produce a concise, actionable removal card. The
user will read this and act themselves — you do NOT act on their behalf.

Output ONLY a single JSON object matching:
{
  "title": string,          // one-line describing what to do
  "difficulty": "easy" | "medium" | "hard",
  "actionUrl": string | null,     // direct opt-out URL if applicable
  "contactEmail": string | null,  // privacy/webmaster/abuse contact
  "emailSubject": string | null,  // ready-to-paste subject
  "emailBody": string | null,     // ready-to-paste body, in user's region language
  "legalHint": string             // one sentence on legal basis + response deadline
}

Regional framing:
- US → CCPA §1798.105 (45-day response), English
- EU → GDPR Art. 17 (30-day response), English
- CN → 《个人信息保护法》第47条 (15日), 中文

Difficulty:
- easy: direct opt-out URL exists, one click
- medium: email required, or multi-step form
- hard: phone verification / ID upload / notarized letter required

If a known broker opt-out URL is provided, use it as actionUrl and set
difficulty=easy. Do not invent emails — leave contactEmail null if uncertain.`;

export async function generateRemovalCard(
  input: GenerateCardInput,
): Promise<RemovalCard> {
  const res = await anthropic.messages.create({
    model: MODEL_GENERATE,
    max_tokens: 800,
    system: GENERATE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `REGION: ${input.region}
BUCKET: ${input.bucket}

TARGET PII (for personalizing the email — do not leak more than necessary):
${JSON.stringify(input.pii, null, 2)}

OFFENDING RESULT:
Title: ${input.result.title}
URL: ${input.result.url}
Snippet: ${input.result.snippet}

${
  input.knownBroker
    ? `KNOWN BROKER ENTRY:\n${JSON.stringify(input.knownBroker, null, 2)}`
    : "(no known broker entry for this URL)"
}`,
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as {
    title: string;
    difficulty: Difficulty;
    actionUrl: string | null;
    contactEmail: string | null;
    emailSubject: string | null;
    emailBody: string | null;
    legalHint: string;
  };
  return {
    title: parsed.title,
    difficulty: parsed.difficulty,
    actionUrl: parsed.actionUrl ?? undefined,
    contactEmail: parsed.contactEmail ?? undefined,
    emailSubject: parsed.emailSubject ?? undefined,
    emailBody: parsed.emailBody ?? undefined,
    legalHint: parsed.legalHint,
  };
}
