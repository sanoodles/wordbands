// Build Google's answers for the head of each pair in `PAIRS`, the words a learner meets
// first, so the translate route answers them without calling Google. One artifact per
// direction, `data/google.<source>-<target>.json`: the raw `gtx` answer to the dictionary
// lookup the word card makes, keyed by the word as the card sends it.
//
//   tsx scripts/build-google.ts              fetch the words the artifacts lack, most frequent first
//   tsx scripts/build-google.ts --top 500    only each direction's 500 most frequent head words
//   tsx scripts/build-google.ts --minutes 60 stop after an hour, keeping every answer fetched
//   tsx scripts/build-google.ts --refresh    fetch every answer again
//   tsx scripts/build-google.ts --check      report how far the artifacts trail the head, fetching nothing
//
// `.github/workflows/google-answers.yml` runs it every day on GitHub's runners, not from
// production: Google limits calls by address, and Vercel's is shared. CLAUDE.md holds the
// measurements behind the choice.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gtxUrl, parseGtx } from "../src/lib/translate";

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, "../data");

const PAIRS = [
  ["de", "en"],
  ["en", "de"],
  ["en", "es"],
  ["es", "en"],
  ["fr", "en"],
  ["pt", "en"],
  ["it", "en"],
  ["en", "fr"],
  ["en", "pt"],
  ["en", "it"],
] as const;
const HEAD_BANDS = ["A1", "A2"];
// One call every ten seconds: a cache has no deadline, so the pace stays far below Google's limit.
const PAUSE_MS = 10_000;
const ATTEMPTS = 3;
// A run takes this many words of each direction in turn, so one that Google cuts short has
// spent its calls on every direction's most frequent words.
const ROUND = 500;

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

/**
 * It asks Google the card's dictionary lookup of `word`. A refusal stops the run at once. Only
 * a call that got no answer at all, such as a dropped connection, is tried again.
 */
async function ask(word: string, source: string, target: string): Promise<unknown> {
  const what = `${source}->${target} "${word}"`;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(gtxUrl(word, source, target, true));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      if (attempt === ATTEMPTS) throw new Error(`${what}: ${why} after ${ATTEMPTS} attempts`);
      await sleep(60_000 * attempt);
      continue;
    }
    const data: unknown = res.ok ? await res.json().catch(() => null) : null;
    if (!Array.isArray(data)) throw new Error(`${what}: refused with status ${res.status}`);
    return data;
  }
}

interface Direction {
  source: string;
  target: string;
  path: string;
  words: string[];
  answers: Map<string, unknown>;
  /** The words Google answered without a translation in this run. */
  blank: string[];
}

const pathOf = (source: string, target: string) => resolve(DATA, `google.${source}-${target}.json`);

const stored = (path: string): Record<string, unknown> =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { answers: Record<string, unknown> }).answers : {};

/** It loads a direction's head words, with the answers its file already holds for them. */
function load(source: string, target: string): Direction {
  const path = pathOf(source, target);
  const words = head(source);
  const kept = stored(path);
  const answers = new Map<string, unknown>();
  for (const w of words) if (Object.hasOwn(kept, w)) answers.set(w, kept[w]);
  return { source, target, path, words, answers, blank: [] };
}

function save({ source, target, path, words, answers }: Direction) {
  const entries = words.filter((w) => answers.has(w)).map((w) => [w, answers.get(w)] as const);
  // Written beside the file and renamed over it, so a run killed mid-write leaves the last whole file.
  writeFileSync(`${path}.tmp`, JSON.stringify({ source, target, answers: Object.fromEntries(entries) }));
  renameSync(`${path}.tmp`, path);
}

const refresh = process.argv.includes("--refresh");
const check = process.argv.includes("--check");
const topAt = process.argv.indexOf("--top");
const top = topAt < 0 ? Infinity : Number(process.argv[topAt + 1]);
const minutesAt = process.argv.indexOf("--minutes");
const minutes = minutesAt < 0 ? Infinity : Number(process.argv[minutesAt + 1]);

async function main() {
  if (top !== Infinity && !(Number.isInteger(top) && top > 0)) throw new Error("--top takes a whole number of words");
  if (minutes !== Infinity && !(minutes > 0)) throw new Error("--minutes takes a positive number of minutes");
  if (check) {
    for (const [source, target] of PAIRS) {
      const words = head(source);
      const keys = Object.keys(stored(pathOf(source, target)));
      const has = new Set(keys);
      const want = new Set(words);
      const missing = words.filter((w) => !has.has(w)).length;
      const stale = keys.filter((w) => !want.has(w)).length;
      console.log(`${source}->${target}: ${words.length} head words, ${missing} without an answer, ${stale} answers for words no longer in the head`);
    }
    return;
  }

  const directions = PAIRS.map(([source, target]) => load(source, target));
  // A refresh asks about every word again, and keeps each old answer until its new one lands.
  const owed = (d: Direction, words: string[]) => (refresh ? words : words.filter((w) => !d.answers.has(w)));
  for (const d of directions) {
    console.log(`${d.source}->${d.target}: ${d.words.length} head words, ${d.answers.size} kept, ${owed(d, d.words.slice(0, top)).length} to fetch`);
  }

  const deadline = Date.now() + minutes * 60_000;
  const end = Math.min(top, Math.max(...directions.map((d) => d.words.length)));
  fill: for (let from = 0; from < end; from += ROUND) {
    for (const d of directions) {
      const todo = owed(d, d.words.slice(from, Math.min(from + ROUND, end)));
      if (!todo.length) continue;
      for (const word of todo) {
        if (Date.now() >= deadline) {
          console.log(`stopped after ${minutes} minutes. Run again to fetch the rest.`);
          break fill;
        }
        let answer: unknown;
        try {
          answer = await ask(word, d.source, d.target);
        } catch (err) {
          console.error(`stopped: ${(err as Error).message}. Run again later to fetch the rest.`);
          process.exit(1);
        }
        // GTX-3 forbids an answer without a translation, so it is not kept. A later run asks again.
        if (parseGtx(answer)) {
          d.answers.set(word, answer);
          save(d);
        } else d.blank.push(word);
        await sleep(PAUSE_MS);
      }
      console.log(`  ${d.source}->${d.target}: ${d.answers.size} of ${d.words.length}`);
    }
  }

  for (const d of directions) {
    console.log(`${d.source}->${d.target}: ${d.answers.size} of ${d.words.length} answered${d.blank.length ? `, ${d.blank.length} without a translation: ${d.blank.slice(0, 10).join(", ")}` : ""}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
