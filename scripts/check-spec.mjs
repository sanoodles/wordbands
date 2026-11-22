#!/usr/bin/env node
// Checks that SPEC.md and the code still agree about what this app must do.
//
// The spec is written from prompts and the code is written from the spec, both by the
// same hand. That hand can restate its own mistake in both places and notice nothing, so
// an unchecked spec is worse than none — it is a second document that can lie with
// authority. This is the thing that stops it.
//
// Two directions, because a spec rots from either end:
//   - a rule nothing asserts is a wish, not a rule
//   - an annotation naming a rule the spec no longer defines is a leftover
//
// And one on the text itself: a sentence past MAX_WORDS has packed several facts into
// one, which is how a rule comes to need two readings.
//
//   node scripts/check-spec.mjs [--list | --file]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(ROOT, "SPEC.md");
const MODE = process.argv.includes("--file") ? "file" : process.argv.includes("--list") ? "list" : null;

// A rule is defined by being the first cell of a table row. That keeps the definition and
// its statement on one line, and leaves an ID mentioned in prose as a mention.
const RULE_ROW = /^\|\s*`?([A-Z]+-\d+)`?\s*\|(.*)$/;
// `@spec GATE-1, GATE-2` — one annotation may carry several.
const ANNOTATION = /@spec\s+([A-Z]+-\d+(?:\s*[,\s]\s*[A-Z]+-\d+)*)/g;
const MAX_WORDS = 25;
// A colon introduces a list inside its sentence, so only these end one.
const SENTENCE_END = /(?<=[.;!?])\s+/;
// `/` between band names and a lone `·` are not words.
const isWord = (t) => /[\p{L}\p{N}]/u.test(t);

// Two kinds of annotation, and only one of them is proof. A rule cannot be proven by the
// code implementing it — that is the tautology this whole file exists to prevent. An
// annotation in the source says "this rule governs this code", which is what you want to
// see when you open the file to change it, and nothing more.
const SELF = "scripts/check-spec.mjs";
const isProof = (p) => /\.test\.tsx?$/.test(p) || (p.startsWith("scripts/") && p.endsWith(".mjs"));
const isCode = (p) =>
  (p.startsWith("apps/web/src/") && /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) ||
  p === "apps/web/next.config.mjs" ||
  (p.startsWith("apps/web/scripts/") && p.endsWith(".ts"));

const SKIP = new Set(["node_modules", ".git", ".next", ".next-build", ".turbo", "data", ".agents"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

function readRules() {
  const rules = new Map();
  const dupes = [];
  let area = null;
  for (const line of readFileSync(SPEC, "utf8").split("\n")) {
    const heading = /^## ([A-Z]+) /.exec(line);
    if (heading) area = heading[1];
    const m = RULE_ROW.exec(line);
    if (!m) continue;
    const [, id, rest] = m;
    // The statement is whatever the row says after the ID — the second cell for a prose
    // rule, the whole row for the decode table, which states itself in columns.
    const cells = rest.split("|").map((c) => c.trim()).filter(Boolean);
    const text = cells.join(" · ");
    if (rules.has(id)) dupes.push(id);
    else rules.set(id, { area: area ?? id.split("-")[0], text, cells, proof: [], code: [] });
  }
  return { rules, dupes };
}

const { rules, dupes } = readRules();
// A reformatted table must fail loudly rather than silently assert nothing, which is the
// same trap check-deployed-decodes.mjs guards against reading the same file.
if (rules.size < 10) {
  console.error(`spec: parsed ${rules.size} rules from SPEC.md — expected a | ID | Rule | table per section`);
  process.exit(1);
}

const unknown = [];
const byFile = new Map();
for (const file of walk(ROOT)) {
  if (file === SELF) continue;
  const kind = isProof(file) ? "proof" : isCode(file) ? "code" : null;
  if (!kind) continue;
  for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(ANNOTATION)) {
    for (const id of m[1].split(/[,\s]+/).filter(Boolean)) {
      const rule = rules.get(id);
      if (!rule) { unknown.push({ id, file }); continue; }
      if (!rule[kind].includes(file)) rule[kind].push(file);
      const seen = byFile.get(file) ?? { kind, ids: [] };
      if (!seen.ids.includes(id)) seen.ids.push(id);
      byFile.set(file, seen);
    }
  }
}

const unproven = [...rules].filter(([, r]) => !r.proof.length).map(([id]) => id);
// A row stated in several columns, like the decode table, has no sentence to measure.
const long = [];
for (const [id, r] of rules) {
  if (r.cells.length !== 1) continue;
  for (const s of r.cells[0].split(SENTENCE_END)) {
    const n = s.split(/\s+/).filter(isWord).length;
    if (n > MAX_WORDS) long.push(`${id.padEnd(10)} ${n} words: ${s}`);
  }
}
const marked = [...rules.values()].filter((r) => r.code.length).length;
const short = (f) => f.replace("apps/web/src/", "").replace("apps/web/", "");

if (MODE === "list") {
  let area = null;
  for (const [id, r] of rules) {
    if (r.area !== area) console.log(`${(area = r.area)}\n`);
    console.log(`  ${id.padEnd(9)} ${r.text}`);
    console.log(`  ${" ".repeat(9)} proof  ${r.proof.map(short).join(", ") || "—"}`);
    console.log(`  ${" ".repeat(9)} code   ${r.code.map(short).join(", ") || "—"}\n`);
  }
}

if (MODE === "file") {
  const rows = [...byFile].sort(([a], [b]) => a.localeCompare(b));
  const w = Math.max(...rows.map(([f]) => short(f).length));
  // Sorted by area then number, so a file's rules read in the spec's own order rather
  // than in whatever order the annotations happen to sit in it.
  const order = (id) => { const [a, n] = id.split("-"); return [a, Number(n)]; };
  for (const [file, { kind, ids }] of rows) {
    ids.sort((x, y) => { const [a, i] = order(x), [b, j] = order(y); return a === b ? i - j : a.localeCompare(b); });
    console.log(`${short(file).padEnd(w)}  ${kind.padEnd(5)}  ${ids.join(", ")}`);
  }
  console.log();
}

console.log(`spec: ${rules.size} rules, ${rules.size - unproven.length} proven, ${marked} marked in code`);

const say = (title, lines) => {
  if (!lines.length) return;
  console.error(`\n${title}`);
  for (const l of lines) console.error(`  ${l}`);
};

say("defined twice — an ID is for one rule and stays with it:", dupes);
say("unproven — no test names these:", unproven.map((id) => `${id.padEnd(10)} ${rules.get(id).text}`));
say(
  "unknown — these name a rule SPEC.md does not define:",
  [...new Set(unknown.map(({ id, file }) => `${file} names ${id}`))],
);

say(`too long — split these into sentences of ${MAX_WORDS} words or fewer, one fact each:`, long);

if (dupes.length || unproven.length || unknown.length) {
  console.error(`\nEither the rule needs a test, or SPEC.md and the @spec comment need to agree.`);
}
if (dupes.length || unproven.length || unknown.length || long.length) process.exit(1);
