#!/usr/bin/env node
// Loads the page on a simulated phone and fails when it is slower than SPEC.md allows.
//
//   pnpm load:check [url]
//
// A run is a first visit in a new browser, then a repeat visit in a browser restarted on the same
// profile. That keeps the disk cache and the cookies, and loses the open connection and the
// memory cache, as a visit on another day does. A reload in one session keeps both, so it reads
// sooner than any reader will see. A deployed page counts only where the CDN answered, since the
// rules are about a page the CDN holds. `/api/translate` is stubbed, so a run never reaches Google.
//
// @spec LOAD-1, LOAD-2

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluator, interceptTranslate, killOnExit, launch, openPage, sleep, stop } from "./lib/browser.mjs";

const BASE = process.argv[2] ?? "https://wordbands.vercel.app";
const RUNS = 5;
const PACE_MS = 1000;
const BUDGET_MS = 300;
const FIELD = "input";
// The Workspace has written the theme cookies by now, which a repeat visit depends on.
const READY = 'a[aria-label^="Etymology"]';

const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const NETWORK = { offline: false, latency: 40, downloadThroughput: 2_500_000, uploadThroughput: 625_000 };
const CPU_SLOWDOWN = 2;

const SPY = `(() => {
  const marks = (window.__marks = {});
  new MutationObserver(() => {
    if (!marks.field && document.querySelector(${JSON.stringify(FIELD)})) marks.field = performance.now();
  }).observe(document, { subtree: true, childList: true });
})()`;

const READ = `({
  paint: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
  field: window.__marks.field,
})`;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// A field in the HTML is in the DOM before it is on screen, so it shows at whichever is later.
async function visit(profile) {
  const browser = launch({ name: "load", profile });
  killOnExit(browser);
  try {
    const { send, on, close } = await openPage(browser);
    const { val, until } = evaluator(send);
    await interceptTranslate(send, on, () => null);
    await send("Page.enable");
    await send("Network.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY });
    await send("Emulation.setDeviceMetricsOverride", PHONE);
    await send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
    await send("Network.emulateNetworkConditions", NETWORK);

    let cache;
    on((m) => {
      if (m.method !== "Network.responseReceived" || m.params.type !== "Document") return;
      const headers = Object.entries(m.params.response.headers);
      cache = headers.find(([name]) => name.toLowerCase() === "x-vercel-cache")?.[1];
    });
    const loaded = new Promise((r) => on((m) => m.method === "Page.loadEventFired" && r()));
    await send("Page.navigate", { url: `${BASE}/` });
    await loaded;
    await until(`!!document.querySelector(${JSON.stringify(READY)})`, "the Workspace");
    await sleep(PACE_MS);
    const { paint, field } = await val(READ);
    close();
    return { paint, field: Math.max(paint, field), cache };
  } finally {
    await stop(browser);
  }
}

async function run() {
  const profile = mkdtempSync(join(tmpdir(), "load-"));
  try {
    return { first: await visit(profile), repeat: await visit(profile) };
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

process.setMaxListeners(RUNS * 2);
const runs = [];
for (let i = 0; i < RUNS; i++) {
  runs.push(await run());
  await sleep(PACE_MS);
}

const held = (kind) => runs.map((r) => r[kind]).filter((v) => v.cache === undefined || v.cache === "HIT");
const checks = [
  ["LOAD-1 first paint, first visit", held("first"), "paint"],
  ["LOAD-1 first paint, repeat visit", held("repeat"), "paint"],
  ["LOAD-2 search field, repeat visit", held("repeat"), "field"],
];

let failed = false;
for (const [name, visits, mark] of checks) {
  if (visits.length === 0) {
    console.error(`${name}: the CDN answered none of ${RUNS} visits`);
    failed = true;
    continue;
  }
  const ms = Math.round(median(visits.map((v) => v[mark])));
  const over = ms > BUDGET_MS;
  failed ||= over;
  console.log(`${over ? "FAIL" : "ok  "} ${name}: ${ms} ms, of ${visits.length} visits the CDN answered`);
}
process.exit(failed ? 1 : 0);
