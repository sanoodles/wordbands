#!/usr/bin/env node
// Checks that every major we tell Dependabot to ignore is still actually blocked, and that
// every peer range we accept in pnpm-workspace.yaml is still one the package declares.
//
// An `ignore` entry is a decision to stop hearing about something, and nothing pulls on
// it. Both of ours are blocked by a peer range in a package we do not control, so the day
// that range widens the entry becomes a silent veto on an upgrade we now want — and no
// PR, no build and no test would ever mention it again.
//
// So the entries state their reason in a form this can read:
//
//   # blocked-by: <blocker> peers <dependency> <range>
//   - dependency-name: "<dependency>"
//
// The claim is read out of dependabot.yml rather than restated here, the same bargain
// check-deployed-decodes.mjs makes with its table: one source, and this parses it.
//
// A peer range accepted in pnpm-workspace.yaml is the same kind of decision, so it states
// its reason the same way, above its entry under `allowedVersions`:
//
//   # accepted-over: <package> peers <dependency> <range>
//   <package>><dependency>: "<accepted>"
//
// It compares each claim against pnpm-lock.yaml and fails when they disagree — which is
// the moment to revisit the ignore, or to drop an accepted range the package now declares. Reading the installed lockfile is the right scope:
// an upstream release we have not taken cannot unblock anything anyway, so this fires
// exactly when the blocker is upgraded, which is when the answer can change.
//
//   node scripts/check-dependabot-ignores.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(ROOT, ".github/dependabot.yml");
const WORKSPACE = join(ROOT, "pnpm-workspace.yaml");
const LOCK = join(ROOT, "pnpm-lock.yaml");

const CLAIM = /^\s*#\s*blocked-by:\s*(\S+)\s+peers\s+(\S+)\s+(.+?)\s*$/;
const IGNORED = /^\s*-\s*dependency-name:\s*["']?([^"'\s]+)["']?\s*$/;
const ACCEPTED_CLAIM = /^\s*#\s*accepted-over:\s*(\S+)\s+peers\s+(\S+)\s+(.+?)\s*$/;
const ACCEPTED = /^\s*["']?([^"'\s>]+)>([^"'\s:]+)["']?:\s*\S/;

/** Each ignored dependency with the claim written above it, in file order. */
function readClaims() {
  const lines = readFileSync(CONFIG, "utf8").split("\n");
  const out = [];
  let pending = null;
  let inIgnore = false;
  for (const line of lines) {
    if (/^\s{4}ignore:\s*$/.test(line)) { inIgnore = true; continue; }
    // The block ends at the next key at the same indent.
    if (inIgnore && /^\s{4}\S/.test(line) && !/^\s{4}-/.test(line)) inIgnore = false;
    if (!inIgnore) continue;
    const claim = CLAIM.exec(line);
    if (claim) { pending = { blocker: claim[1], dep: claim[2], range: claim[3] }; continue; }
    const ignored = IGNORED.exec(line);
    if (ignored) { out.push({ name: ignored[1], claim: pending }); pending = null; }
  }
  return out;
}

/** Each peer range accepted in pnpm-workspace.yaml, with the claim written above it. */
function readAccepted() {
  const out = [];
  let pending = null;
  let inAllowed = false;
  for (const line of readFileSync(WORKSPACE, "utf8").split("\n")) {
    if (/^\s{2}allowedVersions:\s*$/.test(line)) { inAllowed = true; continue; }
    // The block ends at the next line indented less than its entries.
    if (inAllowed && /^\s{0,3}\S/.test(line)) inAllowed = false;
    if (!inAllowed) continue;
    const claim = ACCEPTED_CLAIM.exec(line);
    if (claim) { pending = { pkg: claim[1], dep: claim[2], range: claim[3] }; continue; }
    const entry = ACCEPTED.exec(line);
    if (entry) { out.push({ pkg: entry[1], dep: entry[2], claim: pending }); pending = null; }
  }
  return out;
}

/** Every installed version of `pkg`, with the peer range it declares for `dep`. */
function peerRanges(pkg, dep) {
  const lock = readFileSync(LOCK, "utf8");
  const found = [];
  // Entries are `  '<name>@<version>':` followed by an indented block; peerDependencies,
  // when present, lists one `      <dep>: <range>` per peer.
  const entry = new RegExp(`^  '?${pkg.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}@([^'(:\\s]+)'?:$`, "gm");
  for (const m of lock.matchAll(entry)) {
    const rest = lock.slice(m.index + m[0].length);
    const block = rest.slice(0, rest.search(/\n(?=\S|  \S)/) + 1 || rest.length);
    const peers = /\n    peerDependencies:\n((?:      .*\n)+)/.exec(block);
    const range = peers && new RegExp(`^      '?${dep}'?:\\s*(.+)$`, "m").exec(peers[1]);
    found.push({ version: m[1], range: range ? range[1].trim().replace(/^['"]|['"]$/g, "") : null });
  }
  return found;
}

const claims = readClaims();
const accepted = readAccepted();
const problems = [];

for (const { name, claim } of claims) {
  if (!claim) {
    problems.push(`${name} is ignored with no "# blocked-by:" line saying why`);
    continue;
  }
  if (claim.dep !== name) {
    problems.push(`${name} is ignored, but the line above it claims a block on ${claim.dep}`);
    continue;
  }
  const found = peerRanges(claim.blocker, name);
  if (!found.length) {
    problems.push(`${name}: ${claim.blocker} is not in the lockfile — the block cannot be verified`);
    continue;
  }
  for (const { version, range } of found) {
    const at = `${claim.blocker}@${version}`;
    if (range === null) problems.push(`${name}: ${at} no longer peers on it — the ignore may be stale`);
    else if (range !== claim.range) problems.push(`${name}: ${at} peers ${range}, the entry claims ${claim.range}`);
    else console.log(`  ok  ${name.padEnd(12)} blocked by ${at} peering ${range}`);
  }
}

for (const { pkg, dep, claim } of accepted) {
  const name = `${pkg}>${dep}`;
  if (!claim || claim.pkg !== pkg || claim.dep !== dep) {
    problems.push(`${name} is accepted with no matching "# accepted-over:" line saying why`);
    continue;
  }
  const found = peerRanges(pkg, dep);
  if (!found.length) {
    problems.push(`${name}: ${pkg} is not in the lockfile — the acceptance cannot be verified`);
    continue;
  }
  for (const { version, range } of found) {
    const at = `${pkg}@${version}`;
    if (range === null) problems.push(`${name}: ${at} no longer peers on ${dep} — the acceptance may be stale`);
    else if (range !== claim.range) problems.push(`${name}: ${at} peers ${range}, the entry claims ${claim.range}`);
    else console.log(`  ok  ${name} accepted over ${at} peering ${range}`);
  }
}

if (!problems.length) {
  console.log(`\ndependabot: ${claims.length} ignored majors, all still blocked`);
  console.log(`pnpm: ${accepted.length} accepted peer range${accepted.length === 1 ? "" : "s"}, all still undeclared`);
  process.exit(0);
}
console.error("\na claim no longer matches the lockfile:");
for (const p of problems) console.error(`  ${p}`);
console.error(
  "\nIf a peer widened, the major may now be takeable, or the accepted range declared: drop" +
  "\nthe entry in .github/dependabot.yml or pnpm-workspace.yaml, or correct the claim above it.",
);
process.exit(1);
