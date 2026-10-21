#!/usr/bin/env node
// Reports when the pinned Node or pnpm trails a major behind upstream, or when an advisory
// affects the exact pnpm pinned.
//
// Dependabot moves the npm packages and the actions, and neither of these two: Node is in
// .node-version, pnpm in package.json's `packageManager`. Dependabot raises no alert for
// either. Nothing else proposes a newer one, so without this a pin stalls silently. It
// changes nothing, because taking a major is a decision. It exits 1 on a trailing major or
// an advisory, so the weekly run in versions-freshness.yml turns red and says which.
//
//   node scripts/check-versions.mjs

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// One call at a time, a second apart: CLAUDE.md's rule for calling a third party.
const PAUSE_MS = 1000;
// A call that got no answer at all is tried once more, after this long.
const RETRY_MS = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// An answer that is not a 200 is never retried. A weekly check can wait a week, and a
// refusal means the pace was too fast.
async function getJson(url, extra = {}) {
  const headers = { "user-agent": "wordbands-versions-check", ...extra };
  let res;
  try {
    res = await fetch(url, { headers });
  } catch {
    await sleep(RETRY_MS);
    res = await fetch(url, { headers });
  }
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  const body = await res.json();
  await sleep(PAUSE_MS);
  return body;
}

const major = (version) => Number(String(version).replace(/^v/, "").split(".")[0]);

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const pnpmPin = /^pnpm@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager ?? "")?.[1];
if (!pnpmPin) throw new Error(`package.json's packageManager is not pnpm@x.y.z: ${manifest.packageManager}`);
const nodePin = readFileSync(join(ROOT, ".node-version"), "utf8").trim();

// Node is held to its newest LTS line, not its newest release: an odd major never becomes
// LTS, and an even one becomes LTS only in the October after its release. The index lists
// the newest release first.
const releases = await getJson("https://nodejs.org/dist/index.json");
const nodeLts = releases.find((r) => r.lts)?.version;
const pnpmLatest = (await getJson("https://registry.npmjs.org/pnpm/latest")).version;

// A patch release can carry a security fix that a comparison of majors never sees, so the
// exact pnpm pinned is also looked up. Node needs no such lookup: setup-node and Vercel
// both take the newest release of the pinned major on every run.
const advisories = await getJson(
  `https://api.github.com/advisories?ecosystem=npm&affects=pnpm@${pnpmPin}&per_page=100`,
  {
    accept: "application/vnd.github+json",
    ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  },
);

const pins = [
  { name: "Node", pinned: nodePin, where: ".node-version", upstream: nodeLts, of: "newest LTS" },
  { name: "pnpm", pinned: pnpmPin, where: "packageManager", upstream: pnpmLatest, of: "latest" },
];

let trailing = 0;
for (const p of pins) {
  const behind = major(p.pinned) < major(p.upstream);
  if (behind) trailing++;
  console.log(`${behind ? "trails" : "ok    "}  ${p.name} ${p.pinned} in ${p.where}; its ${p.of} is ${p.upstream}`);
}
console.log(`${advisories.length ? "affected" : "ok      "}  pnpm ${pnpmPin}: ${advisories.length} advisories`);
for (const a of advisories) console.log(`            ${a.ghsa_id} ${a.severity}: ${a.summary}`);

if (advisories.length) {
  console.error(`\nMove packageManager to a pnpm that none of these affects. Its lockfile changes too.`);
}
if (trailing) {
  console.error(
    "\nRead the new major's release notes, then raise the pin. A Node major goes in" +
      " .node-version and apps/web/package.json's engines together, and only once Vercel" +
      " offers it.",
  );
}
if (trailing || advisories.length) process.exit(1);
