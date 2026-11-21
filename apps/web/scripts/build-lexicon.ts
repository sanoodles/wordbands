// What one language's own Wiktionary says about its words, for build-bands.ts: its lemma
// headwords, its proper nouns, its abbreviations, and which lemma each inflected form
// belongs to. One gitignored file per language, `data/lexicon.<code>.json`, read from
// `data/wiktextract-<code>.jsonl.gz`, so the build reads a dump of several hundred MB once
// rather than on every run.
//
//   tsx scripts/build-lexicon.ts [lang]   # one language, or all when omitted
import { createReadStream, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const data = (f: string) => resolve(here, "../data", f);

const LANGS = ["en", "es", "fr", "de", "pt", "it"];

// Parts of speech that are not a word a learner looks up.
const SKIP_POS = new Set(["name", "abbrev", "symbol", "character", "suffix", "prefix", "affix", "infix",
  "interfix", "circumfix", "phrase", "proverb", "punct", "romanization", "unknown"]);
const ABBREV_TAGS = new Set(["abbreviation", "acronym", "initialism"]);
const NOT_LEMMA_TAGS = new Set(["form-of", "alt-of", "misspelling", ...ABBREV_TAGS]);

export interface Lexicon {
  /** Lowercase lemma headwords. */
  heads: string[];
  /** Lowercase proper nouns: filed only as names, or, outside German, only ever spelt capitalized. */
  names: string[];
  /** Lowercase words filed only as abbreviations, acronyms or initialisms. */
  abbrev: string[];
  /** `[lemma, form]` pairs from the senses that say "form of", in the dump's order. */
  forms: [string, string][];
}

// The dump's lines, split on "\n" alone. node:readline also ends a line at U+2028 and
// U+2029, which JSON allows unescaped inside a string, and the German dump has some.
async function* jsonLines(file: string): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of createReadStream(file).pipe(createGunzip()).setEncoding("utf8")) {
    const parts = (rest + (chunk as string)).split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  if (rest) yield rest;
}

type Sense = { tags?: string[]; form_of?: { word?: string }[]; alt_of?: unknown[] };
type Entry = { word?: string; lang_code?: string; pos?: string; senses?: Sense[] };

async function extract(lang: string): Promise<Lexicon> {
  const lemmaSpelt = new Map<string, Set<string>>();
  const spelt = new Map<string, Set<string>>();
  const named = new Set<string>(), other = new Set<string>();
  const abbrev = new Set<string>(), plain = new Set<string>();
  const forms = new Map<string, [string, string]>();
  for await (const line of jsonLines(data(`wiktextract-${lang}.jsonl.gz`))) {
    if (!line) continue;
    const e = JSON.parse(line) as Entry;
    const w = e.word?.trim();
    if (e.lang_code !== lang || !w || w.includes(" ")) continue;
    const lw = w.toLowerCase();
    (spelt.get(lw) ?? spelt.set(lw, new Set()).get(lw)!).add(w);
    if (e.pos === "name") {
      named.add(lw);
      continue;
    }
    other.add(lw);
    const senses = e.senses ?? [];
    const abbrevSense = (s: Sense) => (s.tags ?? []).some((t) => ABBREV_TAGS.has(t));
    if (e.pos === "abbrev" || (senses.length > 0 && senses.every(abbrevSense))) abbrev.add(lw);
    else plain.add(lw);
    if (SKIP_POS.has(e.pos ?? "")) continue;
    for (const s of senses) {
      if (!(s.form_of?.length || s.alt_of?.length || (s.tags ?? []).some((t) => NOT_LEMMA_TAGS.has(t)))) {
        (lemmaSpelt.get(lw) ?? lemmaSpelt.set(lw, new Set()).get(lw)!).add(w);
      }
      for (const f of s.form_of ?? []) {
        const lemma = f.word?.trim();
        if (lemma && !lemma.includes(" ") && lemma.toLowerCase() !== lw) forms.set(`${lemma}\t${w}`, [lemma, w]);
      }
    }
  }
  const capped = (s: string) => s[0] !== s[0]!.toLowerCase();
  // Portuguese Wiktionary files `Joaçaba` as a plain noun, so the part of speech alone
  // misses its place names. German capitalizes every noun, so there it is all there is.
  const names = new Set([...named].filter((w) => !other.has(w)));
  if (lang !== "de") for (const [lw, s] of spelt) if ([...s].every(capped)) names.add(lw);
  const heads = [...lemmaSpelt.keys()].filter((w) => !names.has(w));
  const headSet = new Set(heads);
  return {
    heads: heads.sort(),
    names: [...names].sort(),
    abbrev: [...abbrev].filter((w) => !plain.has(w) && !headSet.has(w)).sort(),
    forms: [...forms.values()].filter(([lemma]) => !names.has(lemma.toLowerCase())),
  };
}

const only = process.argv[2];
if (only && !LANGS.includes(only)) {
  console.error(`unknown language "${only}" (have: ${LANGS.join(", ")})`);
  process.exit(1);
}
async function main() {
  for (const lang of LANGS) {
    if (only && only !== lang) continue;
    const lex = await extract(lang);
    writeFileSync(data(`lexicon.${lang}.json`), JSON.stringify(lex));
    console.log(`[${lang}] heads ${lex.heads.length.toLocaleString()}, names ${lex.names.length.toLocaleString()},`,
      `abbreviations ${lex.abbrev.length.toLocaleString()}, forms ${lex.forms.length.toLocaleString()}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
