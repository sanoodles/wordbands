// Build Google's answers for the head of German and English, the words a learner meets
// first, so the translate route answers them without calling Google. One artifact per
// direction, `data/google.<source>-<target>.json`: the raw `gtx` answer to the dictionary
// lookup the word card makes, keyed by the word as the card sends it.
//
//   tsx scripts/build-google.ts             fetch only the words the artifacts lack
//   tsx scripts/build-google.ts --refresh   fetch every answer again
//   tsx scripts/build-google.ts --check     report how far the artifacts trail the head, fetching nothing
//
// Run it here rather than from production: Google limits calls by address, and Vercel's
// is shared. CLAUDE.md holds the measurements behind the choice.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gtxUrl, parseGtx } from "../src/lib/translate";

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, "../data");

const PAIRS = [
  ["de", "en"],
  ["en", "de"],
] as const;
const HEAD_BANDS = ["A1", "A2"];
// One call at a time, half a second apart: CLAUDE.md's rule for calling a third party.
const CONCURRENCY = 1;
const PAUSE_MS = 500;
const ATTEMPTS = 3;
// Written this often, so an interrupted run keeps what it fetched.
const SAVE_EVERY = 500;

interface WordsArtifact {
  ranked: string[];
  variants: Record<string, string[]>;
  cefrBands: { key: string; min: number; max: number | null }[];
}

/** The head as the card asks for it: A1 and A2 in rank order, each casing of a case-homograph apart. */
function head(source: string): string[] {
  const a = JSON.parse(readFileSync(resolve(DATA, `wordbands.${source}.json`), "utf8")) as WordsArtifact;
  const out: string[] = [];
  for (const key of HEAD_BANDS) {
    const band = a.cefrBands.find((b) => b.key === key)!;
    const end = band.max === null ? a.ranked.length : Math.min(band.max, a.ranked.length);
    for (const w of a.ranked.slice(band.min - 1, end)) out.push(...(a.variants[w.toLowerCase()] ?? [w]));
  }
  return [...new Set(out)];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Google's answer to the card's lookup of `word`, retried with a growing pause. */
async function ask(word: string, source: string, target: string): Promise<unknown> {
  let why = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(gtxUrl(word, source, target, true));
      if (res.ok) {
        const data: unknown = await res.json();
        if (Array.isArray(data)) return data;
        why = "an answer that is not an array";
      } else {
        why = `status ${res.status}`;
      }
    } catch (err) {
      why = err instanceof Error ? err.message : String(err);
    }
    if (attempt < ATTEMPTS) await sleep(60_000 * attempt);
  }
  throw new Error(`${source}->${target} "${word}": ${why} after ${ATTEMPTS} attempts`);
}

function save(path: string, source: string, target: string, words: string[], answers: Map<string, unknown>) {
  const entries = words.filter((w) => answers.has(w)).map((w) => [w, answers.get(w)] as const);
  writeFileSync(path, JSON.stringify({ source, target, answers: Object.fromEntries(entries) }));
}

const refresh = process.argv.includes("--refresh");
const check = process.argv.includes("--check");

async function main() {
  for (const [source, target] of PAIRS) {
    const path = resolve(DATA, `google.${source}-${target}.json`);
    const words = head(source);
    if (check) {
      const stored = existsSync(path)
        ? Object.keys((JSON.parse(readFileSync(path, "utf8")) as { answers: Record<string, unknown> }).answers)
        : [];
      const has = new Set(stored);
      const want = new Set(words);
      const missing = words.filter((w) => !has.has(w)).length;
      const stale = stored.filter((w) => !want.has(w)).length;
      console.log(`${source}->${target}: ${words.length} head words, ${missing} without an answer, ${stale} answers for words no longer in the head`);
      continue;
    }
    const answers = new Map<string, unknown>();
    if (!refresh && existsSync(path)) {
      const kept = JSON.parse(readFileSync(path, "utf8")) as { answers: Record<string, unknown> };
      for (const w of words) if (Object.hasOwn(kept.answers, w)) answers.set(w, kept.answers[w]);
    }
    const todo = words.filter((w) => !answers.has(w));
    console.log(`${source}->${target}: ${words.length} head words, ${answers.size} kept, ${todo.length} to fetch`);

    let next = 0;
    let fetched = 0;
    let failure: Error | null = null;
    const worker = async () => {
      while (!failure && next < todo.length) {
        const word = todo[next++]!;
        try {
          answers.set(word, await ask(word, source, target));
        } catch (err) {
          failure = err as Error;
          return;
        }
        await sleep(PAUSE_MS);
        if (++fetched % SAVE_EVERY === 0) {
          save(path, source, target, words, answers);
          console.log(`  ${fetched}/${todo.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    save(path, source, target, words, answers);
    if (failure) {
      console.error(`stopped: ${(failure as Error).message}. Run again to fetch the rest.`);
      process.exit(1);
    }

    const blank = words.filter((w) => !parseGtx(answers.get(w)));
    console.log(`  wrote ${path}: ${answers.size} answers${blank.length ? `, ${blank.length} without a translation: ${blank.slice(0, 10).join(", ")}` : ""}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
