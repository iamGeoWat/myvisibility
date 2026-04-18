/**
 * Phase 0 classifier eval.
 *
 *   pnpm eval                     # run all samples
 *   pnpm eval --persona jordan_us # filter
 *   pnpm eval --limit 10          # first N samples
 *
 * Requires ANTHROPIC_API_KEY in env.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { classifyResult, type ClassifyOutput, type TargetPII } from "../src/lib/claude";

type Persona = {
  region: string;
  pii: TargetPII;
  aliases: string[];
};

type Sample = {
  persona: string;
  result: { title: string; url: string; snippet: string };
  expected: {
    isUser: boolean;
    bucket: string;
    sourceIsSelfPublished: boolean;
  };
};

type Fixture = {
  personas: Record<string, Persona>;
  samples: Sample[];
};

function argv(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(here, "..", "evals", "samples.json");
  const raw = await readFile(fixturePath, "utf8");
  const fx = JSON.parse(raw) as Fixture;

  const personaFilter = argv("--persona");
  const limit = Number(argv("--limit") ?? "0") || Infinity;

  let samples = fx.samples;
  if (personaFilter) samples = samples.filter((s) => s.persona === personaFilter);
  samples = samples.slice(0, limit);

  console.log(`running ${samples.length} samples\n`);

  const concurrency = 6;
  const results: Array<{
    sample: Sample;
    got: ClassifyOutput | { error: string };
  }> = new Array(samples.length);

  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= samples.length) return;
      const s = samples[i];
      const persona = fx.personas[s.persona];
      if (!persona) {
        results[i] = { sample: s, got: { error: `unknown persona ${s.persona}` } };
        continue;
      }
      try {
        const got = await classifyResult({
          pii: persona.pii,
          aliases: persona.aliases,
          result: s.result,
        });
        results[i] = { sample: s, got };
        process.stdout.write(
          got.isUser === s.expected.isUser ? "." : "X",
        );
      } catch (err) {
        results[i] = {
          sample: s,
          got: { error: err instanceof Error ? err.message : String(err) },
        };
        process.stdout.write("E");
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log("\n");

  // Metrics
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0,
    errors = 0;
  let bucketRight = 0,
    selfRight = 0,
    bucketTotal = 0,
    selfTotal = 0;
  const failures: string[] = [];

  for (const { sample, got } of results) {
    if ("error" in got) {
      errors++;
      failures.push(
        `[error]  ${sample.persona}  ${sample.result.url}\n         ${got.error}`,
      );
      continue;
    }
    const expIs = sample.expected.isUser;
    const gotIs = got.isUser && got.confidence >= 0.7;
    if (expIs && gotIs) tp++;
    else if (!expIs && gotIs) fp++;
    else if (!expIs && !gotIs) tn++;
    else fn++;

    // Bucket / self-published only scored on true positives (where we agree
    // the result is about the user).
    if (expIs && gotIs) {
      bucketTotal++;
      selfTotal++;
      if (got.bucket === sample.expected.bucket) bucketRight++;
      if (got.sourceIsSelfPublished === sample.expected.sourceIsSelfPublished)
        selfRight++;
    }

    if (expIs !== gotIs) {
      failures.push(
        `[${expIs ? "FN" : "FP"}]  ${sample.persona}  ${sample.result.url}\n` +
          `       expected: isUser=${expIs} bucket=${sample.expected.bucket} self=${sample.expected.sourceIsSelfPublished}\n` +
          `       got:      isUser=${got.isUser} conf=${got.confidence.toFixed(2)} bucket=${got.bucket} self=${got.sourceIsSelfPublished} matched=${got.matchedFields.join("+") || "-"}`,
      );
    } else if (expIs && gotIs) {
      if (got.bucket !== sample.expected.bucket) {
        failures.push(
          `[bkt]  ${sample.persona}  ${sample.result.url}\n` +
            `       expected bucket=${sample.expected.bucket}, got ${got.bucket}`,
        );
      }
      if (got.sourceIsSelfPublished !== sample.expected.sourceIsSelfPublished) {
        failures.push(
          `[self] ${sample.persona}  ${sample.result.url}\n` +
            `       expected self=${sample.expected.sourceIsSelfPublished}, got ${got.sourceIsSelfPublished}`,
        );
      }
    }
  }

  const total = tp + fp + tn + fn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const acc = total > 0 ? (tp + tn) / total : 0;

  console.log("─".repeat(60));
  console.log(`isUser confusion matrix (confidence ≥ 0.7)`);
  console.log(
    `  TP ${tp}  FP ${fp}  TN ${tn}  FN ${fn}  errors ${errors}  (n=${total})`,
  );
  console.log(`  accuracy   ${(acc * 100).toFixed(1)}%`);
  console.log(`  precision  ${(precision * 100).toFixed(1)}%  ← false-positive noise`);
  console.log(`  recall     ${(recall * 100).toFixed(1)}%  ← missed exposures`);
  console.log(`  F1         ${(f1 * 100).toFixed(1)}%`);
  console.log(`bucket accuracy (on TPs):            ${bucketTotal ? ((bucketRight / bucketTotal) * 100).toFixed(1) : "-"}%  (${bucketRight}/${bucketTotal})`);
  console.log(`self-published accuracy (on TPs):    ${selfTotal ? ((selfRight / selfTotal) * 100).toFixed(1) : "-"}%  (${selfRight}/${selfTotal})`);
  console.log("─".repeat(60));
  console.log(`TARGET: precision ≥ 85% (FPs waste a user's time)`);
  console.log();

  if (failures.length) {
    console.log(`${failures.length} disagreement(s):`);
    for (const f of failures) console.log(f);
  } else {
    console.log("no disagreements 🎯");
  }

  process.exit(precision < 0.85 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
