#!/usr/bin/env node
// Reports when the pinned Node or pnpm trails a major behind upstream.
//
// Dependabot moves the npm packages and the actions, and neither of these two: Node is in
// .node-version, pnpm in package.json's `packageManager`. Nothing else proposes a newer
// one, so without this a pin stalls silently. It compares majors only and changes
// nothing, because taking a major is a decision. It exits 1 when one trails, so the weekly
// run in versions-freshness.yml turns red and says which.
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
async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { "user-agent": "wordbands-versions-check" } });
  } catch {
    await sleep(RETRY_MS);
    res = await fetch(url, { headers: { "user-agent": "wordbands-versions-check" } });
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

if (trailing) {
  console.error(
    "\nRead the new major's release notes, then raise the pin. A Node major goes in" +
      " .node-version and apps/web/package.json's engines together, and only once Vercel" +
      " offers it.",
  );
  process.exit(1);
}
