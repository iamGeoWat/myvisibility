import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  uuid,
  boolean,
  real,
} from "drizzle-orm/pg-core";

export const regionEnum = pgEnum("region", ["US", "EU", "CN"]);
export const bucketEnum = pgEnum("bucket", [
  "broker",
  "search_cache",
  "news",
  "social",
  "gov_record",
  "other",
]);
export const difficultyEnum = pgEnum("difficulty", ["easy", "medium", "hard"]);
export const scanStatusEnum = pgEnum("scan_status", [
  "pending",
  "running",
  "done",
  "failed",
]);

// A row per Clerk-authenticated user. `id` mirrors Clerk's userId.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  region: regionEnum("region").notNull().default("US"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// The PII a user wants monitored. Stored encrypted-at-rest by Neon; we also
// treat these as secrets in the app layer (never log, never send to Claude
// without the user's explicit scan trigger).
export const targets = pgTable("targets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  names: jsonb("names").$type<string[]>().notNull().default([]),
  phones: jsonb("phones").$type<string[]>().notNull().default([]),
  emails: jsonb("emails").$type<string[]>().notNull().default([]),
  addresses: jsonb("addresses").$type<string[]>().notNull().default([]),
  // Confirmed self-identifiers: usernames, personal domains, handles.
  // Used to disambiguate namesakes (e.g. GitHub username, personal site host).
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const scans = pgTable("scans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  status: scanStatusEnum("status").notNull().default("pending"),
  queriesRun: integer("queries_run").notNull().default(0),
  resultsSeen: integer("results_seen").notNull().default(0),
  findingsKept: integer("findings_kept").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

export const findings = pgTable("findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  scanId: uuid("scan_id")
    .references(() => scans.id, { onDelete: "cascade" })
    .notNull(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  url: text("url").notNull(),
  pageTitle: text("page_title"),
  snippet: text("snippet"),
  bucket: bucketEnum("bucket").notNull(),
  difficulty: difficultyEnum("difficulty").notNull(),
  confidence: real("confidence").notNull(),
  matchedFields: jsonb("matched_fields").$type<string[]>().notNull().default([]),
  // True when the URL looks like an account the user themselves controls
  // (their LinkedIn, their GitHub, their personal domain). Changes the UI
  // card from "takedown request" to "review your own account".
  sourceIsSelfPublished: boolean("source_is_self_published")
    .notNull()
    .default(false),
  // Removal card — rendered to the user as-is.
  removalTitle: text("removal_title"),
  removalActionUrl: text("removal_action_url"),
  removalContactEmail: text("removal_contact_email"),
  removalEmailSubject: text("removal_email_subject"),
  removalEmailBody: text("removal_email_body"),
  removalLegalHint: text("removal_legal_hint"),
  userMarkedDone: boolean("user_marked_done").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
