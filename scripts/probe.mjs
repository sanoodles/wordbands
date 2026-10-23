#!/usr/bin/env node
// Opens one page in a headless browser, runs steps against it in the order given, and
// prints what they read. A quick look at the deployed page, or at `pnpm dev`, without
// writing a script for it.
//
//   node scripts/probe.mjs <url | path> [step ...] [--size WxH]
//
//   --wait <js>    wait until the expression is truthy, for up to 30s
//   --eval <js>    print the expression's value as JSON
//   --click <css>  click the first element the selector matches, once one does
//   --key <key>    press a key: Escape, Enter, Tab, Shift+Tab, ArrowDown …
//   --type <text>  type the text into whatever has focus
//   --shot <file>  save the viewport as a PNG
//   --size <WxH>   the window's size, 1440x1200 unless given
//
// For example, the order of the source picker's languages:
//
//   pnpm probe '/?source=en&word=water' \
//     --click '[aria-label="Source language"]' \
//     --wait 'document.querySelector("[role=option] .lang-code")' \
//     --eval '[...document.querySelectorAll("[role=option] .lang-code")].map((e) => e.textContent)'
//
// A path is read against WORDBANDS_URL, or against the production site. Every
// /api/translate call fails in the browser, so a probe never reaches Google, and the card
// shows what it shows when Google cannot be reached.

import { writeFileSync } from "node:fs";
import { evaluator, interceptTranslate, killOnExit, launch, openPage, press, stop } from "./lib/browser.mjs";

const BASE = process.env.WORDBANDS_URL ?? "https://wordbands.vercel.app";
const STEPS = new Set(["--wait", "--eval", "--click", "--key", "--type", "--shot"]);

function usage(message) {
  console.error(`${message}\nusage: pnpm probe <url | path> [--wait|--eval|--click|--key|--type|--shot <arg>] … [--size WxH]`);
  process.exit(2);
}

let target;
let size;
const steps = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith("--")) {
    if (target) usage(`a second url: ${a}`);
    target = a;
    continue;
  }
  const arg = args[++i];
  if (arg === undefined) usage(`${a} needs an argument`);
  if (a === "--size") {
    if (!/^\d+x\d+$/.test(arg)) usage(`--size takes WxH, such as 390x844, not ${arg}`);
    size = arg.split("x").map(Number);
  } else if (STEPS.has(a)) steps.push([a, arg]);
  else usage(`unknown option ${a}`);
}
if (!target) usage("no url");
const url = new URL(target, BASE).href;

let browser;
try {
  browser = launch({ name: "probe" });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
killOnExit(browser);

let failed = false;
try {
  const { send, on, close } = await openPage(browser);
  const { val, until } = evaluator(send);
  await interceptTranslate(send, on, () => null);
  await send("Page.enable");
  // Emulated, since headless Chrome makes no window narrower than 500px.
  if (size) await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });

  const loaded = new Promise((resolve) => on((msg) => msg.method === "Page.loadEventFired" && resolve()));
  const { errorText } = await send("Page.navigate", { url });
  if (errorText) throw new Error(`could not open ${url}: ${errorText}`);
  await loaded;

  for (const [n, [step, arg]] of steps.entries()) {
    try {
      // Coerced, since an element cannot be returned by value.
      if (step === "--wait") await until(`!!(${arg})`, arg);
      else if (step === "--eval") {
        const v = await val(arg);
        console.log(v === undefined ? "undefined" : JSON.stringify(v));
      } else if (step === "--click") {
        // The load event fires before the client-only Workspace mounts.
        await until(`!!document.querySelector(${JSON.stringify(arg)})`, "an element to match it");
        const at = await val(`(() => { const e = document.querySelector(${JSON.stringify(arg)});
          e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
        for (const type of ["mousePressed", "mouseReleased"])
          await send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
      } else if (step === "--key") await press(send, arg);
      else if (step === "--type") await send("Input.insertText", { text: arg });
      else if (step === "--shot") {
        const { data } = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(arg, Buffer.from(data, "base64"));
        console.log(`saved ${arg}`);
      }
    } catch (err) {
      throw new Error(`step ${n + 1}, ${step} ${arg}: ${err.message}`);
    }
  }
  close();
} catch (err) {
  console.error(err.message);
  failed = true;
} finally {
  await stop(browser);
}
process.exit(failed ? 1 : 0);
