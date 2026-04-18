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
  /**
   * Confirmed self-identifiers: personal domains, usernames, handles the user
   * has told us they own. The classifier uses these both to resolve
   * namesakes and to mark a finding as self-published.
   */
  aliases: string[];
  result: { title: string; url: string; snippet: string };
};

export type ClassifyOutput = {
  isUser: boolean;
  confidence: number; // 0..1
  bucket: Bucket;
  matchedFields: string[]; // e.g. ["name", "phone"]
  sourceIsSelfPublished: boolean;
};

const CLASSIFY_SYSTEM = `You are a privacy analyst. Given a search result, a
target person's PII, and a list of confirmed self-identifiers (aliases /
personal domains / known usernames), decide:
  1. is this result actually about that specific person (not a namesake)?
  2. which removal channel applies?
  3. does this look like an account the target themselves controls?

Rules:
- To return isUser=true with confidence ≥ 0.7 you need EITHER:
    (a) a match on a uniquely-identifying field (phone / email / a confirmed
        alias appears in the URL or snippet), OR
    (b) a name match plus at least one corroborating signal (locality,
        employer, school, or another alias hint).
  A matching name alone is NOT enough — return isUser=false if unsure.
- bucket: "broker" = people-search sites (Spokeo, Whitepages, BeenVerified,
  Radaris, Intelius, TruePeopleSearch, etc.); "search_cache" = Google/Bing
  cache or SERP page directly; "news" = news article or blog post; "social"
  = LinkedIn/Facebook/Twitter/Instagram/GitHub/personal blog;
  "gov_record" = court, permit, or school directory; "other" = anything else.
- matchedFields: subset of ["name", "phone", "email", "address", "alias"].
- sourceIsSelfPublished = true when the URL is an account or site the target
  themselves operates. Signals: URL host matches a confirmed alias /
  personal domain; the URL is the profile page (not a post *about* them) on
  a social platform and the username matches an alias; the page is the
  target's own blog, portfolio, or GitHub. Posts/articles written by third
  parties about the target are NOT self-published.

Output ONLY a single JSON object, no prose, no markdown fences.
Schema:
{
  "isUser": boolean,
  "confidence": number,
  "bucket": string,
  "matchedFields": string[],
  "sourceIsSelfPublished": boolean
}`;

export async function classifyResult(input: ClassifyInput): Promise<ClassifyOutput> {
  const res = await anthropic.messages.create({
    model: MODEL_CLASSIFY,
    max_tokens: 250,
    system: CLASSIFY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `TARGET PII:
${JSON.stringify(input.pii, null, 2)}

CONFIRMED ALIASES (self-identifiers):
${JSON.stringify(input.aliases, null, 2)}

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
  sourceIsSelfPublished: boolean;
  knownBroker?: {
    name: string;
    optOutUrl?: string;
    contactEmail?: string;
    notes?: string;
  };
};

const GENERATE_SYSTEM = `You produce a concise, actionable card the user will
read and act on themselves. You do NOT act on their behalf.

There are two card kinds:

A) sourceIsSelfPublished = FALSE  (third party exposes the user)
   - Produce a takedown card:
       title: one line on what to do
       difficulty: easy | medium | hard
       actionUrl: direct opt-out URL when applicable (null otherwise)
       contactEmail: privacy/webmaster/abuse contact (null if uncertain —
         NEVER invent an email)
       emailSubject + emailBody: ready-to-paste takedown request in the
         user's region language and legal framework:
           US → CCPA §1798.105 (45-day response), English
           EU → GDPR Art. 17 (30-day response), English
           CN → 《个人信息保护法》第47条 (15日), 中文
       legalHint: one sentence on the legal basis + response deadline

B) sourceIsSelfPublished = TRUE  (the user's own account / site)
   - Produce a self-review card instead:
       title: "Review your own <platform> profile" (or similar)
       difficulty: "easy"
       actionUrl: the URL itself (so the user can open and edit it)
       contactEmail: null
       emailSubject: null
       emailBody: null
       legalHint: a one-sentence reminder that this account is under the
         user's control and suggesting the specific privacy setting to
         check (e.g. "Make your LinkedIn profile private to non-connections"
         or "Review pinned repos and commit email on your GitHub account").
   - Do NOT produce a legal takedown email for self-published content.

Difficulty rubric (kind A only):
  easy = direct opt-out URL, one click
  medium = email required, or multi-step form
  hard = phone verification / ID upload / notarized letter

If a known-broker entry is provided, use its optOutUrl as actionUrl and set
difficulty=easy.

Output ONLY a single JSON object matching:
{
  "title": string,
  "difficulty": "easy" | "medium" | "hard",
  "actionUrl": string | null,
  "contactEmail": string | null,
  "emailSubject": string | null,
  "emailBody": string | null,
  "legalHint": string
}`;

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
SOURCE_IS_SELF_PUBLISHED: ${input.sourceIsSelfPublished}

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
