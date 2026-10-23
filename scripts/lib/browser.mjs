// A headless Chromium-family browser, driven over CDP with no dependencies. Shared by
// check-a11y-transcript.mjs and probe.mjs.
//
// Needs a Chromium-family browser on PATH; set CHROME to name one.

import { mkdtempSync, rmSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSERS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser"];

// Resolved before spawning, because spawn reports a missing binary through an async error
// event — by then a pid exists and the process looks launched.
function onPath(bin) {
  const paths = bin.includes("/") ? [bin] : (process.env.PATH ?? "").split(":").map((d) => join(d, bin));
  for (const p of paths) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

/** Starts the browser on a profile of its own, named `<name>-…` in the system's tmp. */
export function launch({ name }) {
  const profile = mkdtempSync(join(tmpdir(), `${name}-`));
  const flags = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--window-size=1440,1200",
    // The page formats ranks and counts with toLocaleString(), which follows the browser's
    // locale. Unpinned, the same page reads "rank 18,422" on one machine and "18 422" on
    // another, and a reading would be of the machine rather than of the app.
    "--lang=en-US",
    // CI runners have no display and no reason to keep the sandbox for a throwaway
    // browser that opens one page of ours. Left on everywhere else.
    ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
    "about:blank",
  ];
  const candidates = process.env.CHROME ? [process.env.CHROME] : BROWSERS;
  const bin = candidates.map(onPath).find(Boolean);
  if (!bin) {
    rmSync(profile, { recursive: true, force: true });
    throw new Error(`no browser on PATH; tried ${candidates.join(", ")}. Set CHROME to name one.`);
  }
  const child = spawn(bin, flags, {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "UTC" },
    // Its own process group, so `stop` reaches a browser started behind a wrapper script.
    detached: true,
  });
  child.on("error", () => {}); // surfaced by the exit handler in browserEndpoint instead
  const log = [];
  child.stderr.on("data", (d) => log.push(String(d)));
  return { child, profile, log };
}

// True while any process of the browser's group is left to receive the signal.
function signal(child, sig) {
  try {
    process.kill(-child.pid, sig);
    return true;
  } catch {
    return false;
  }
}

function dropProfile(profile) {
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch {
    /* a directory left in tmp is the OS's to reap, and no reason to fail a check */
  }
}

// Waits for the group to empty before deleting: a browser still writing makes the delete fail.
export async function stop({ child, profile }) {
  signal(child, "SIGTERM");
  for (let i = 0; i < 50 && signal(child, 0); i++) await sleep(100);
  signal(child, "SIGKILL");
  dropProfile(profile);
}

// process.exit() skips finally, and a detached group never hears the terminal's Ctrl-C.
export function killOnExit({ child, profile }) {
  process.on("exit", () => {
    signal(child, "SIGKILL");
    dropProfile(profile);
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => process.exit(1));
}

// Chrome prints the endpoint it chose to stderr, which is the only way to learn it with
// --remote-debugging-port=0. A fixed port would collide with whatever else is debugging on
// this machine — and the checks run locally as often as they run in CI.
//
// The endpoint is the browser itself, which carries no Page domain. The tab is reached
// through Target, over this same socket, rather than through the HTTP list on the port:
// that list is guarded against DNS rebinding and its rules have moved between versions,
// and a check that cannot open a tab on someone else's runner is not a check.
function browserEndpoint({ child, log }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`browser reported no debugging endpoint in 20s\n${log.join("").slice(0, 600)}`)), 20_000);
    child.stderr.on("data", () => {
      const m = /ws:\/\/[^\s]+/.exec(log.join(""));
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`browser exited (${code})\n${log.join("").slice(0, 600)}`)); });
  });
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const raw = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify(sessionId ? { id: n, method, params, sessionId } : { id: n, method, params }));
    });
  return { ws, raw, on: (l) => listeners.push(l), open: new Promise((r) => (ws.onopen = r)) };
}

/**
 * One tab of the browser. A flattened session, so the page's commands and its events ride
 * the one socket the browser already gave us. `close` ends the socket, not the browser.
 */
export async function openPage(browser) {
  const cdp = connect(await browserEndpoint(browser));
  await cdp.open;
  const { targetId } = await cdp.raw("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.raw("Target.attachToTarget", { targetId, flatten: true });
  return {
    send: (method, params) => cdp.raw(method, params, sessionId),
    on: (l) => cdp.on((msg) => msg.sessionId === sessionId && l(msg)),
    close: () => cdp.ws.close(),
  };
}

/** Evaluating in the page: `js` returns the remote object, `val` its value. */
export function evaluator(send) {
  const js = async (expression, opts = {}) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, ...opts });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result;
  };
  const val = async (e) => (await js(e)).value;
  // Settle waits key on the page, never on a number of seconds, so a slow cold start reads
  // the same as a warm one instead of reading a half-built page — or, worse, a control
  // one keystroke ahead of the panel it just changed.
  const until = async (expr, what, saw = "null") => {
    for (let i = 0; i < 75; i++) {
      if (await val(expr)) return;
      await sleep(400);
    }
    // What it was looking at matters more than the fact that it gave up: a timeout here is
    // either the page being slow or the page having changed, and those want opposite fixes.
    throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(await val(saw))}`);
  };
  return { js, val, until };
}

// Enter and Space carry text, which is what makes Chrome fire their default actions.
const KEYS = {
  Escape: [27], Enter: [13, "\r"], Tab: [9], Space: [32, " "], Backspace: [8], Delete: [46],
  ArrowUp: [38], ArrowDown: [40], ArrowLeft: [37], ArrowRight: [39],
  Home: [36], End: [35], PageUp: [33], PageDown: [34],
};
const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

/** Presses a named key, with any modifiers before it: "Escape", "Shift+Tab". */
export async function press(send, name) {
  const parts = name.split("+");
  const code = parts.pop();
  if (!KEYS[code] || parts.some((m) => !(m in MODIFIERS)))
    throw new Error(`unknown key ${JSON.stringify(name)}; known: ${Object.keys(KEYS).join(", ")}, after any of ${Object.keys(MODIFIERS).join("+ ")}+`);
  const [vk, text] = KEYS[code];
  const modifiers = parts.reduce((m, p) => m | MODIFIERS[p], 0);
  const base = { key: code === "Space" ? " " : code, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await send("Input.dispatchKeyEvent", { ...base, type: text ? "keyDown" : "rawKeyDown", ...(text && { text }) });
  await send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  await sleep(250);
}

/**
 * Answers every `/api/translate` call in the browser, so a reading never reaches Google.
 * `respond` gets the word and returns the body to send, or null to fail the request the
 * way an unreachable server would.
 */
export async function interceptTranslate(send, on, respond) {
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/translate/*" }] });
  on(async (msg) => {
    if (msg.method !== "Fetch.requestPaused") return;
    const word = decodeURIComponent(new URL(msg.params.request.url).pathname.split("/api/translate/")[1] ?? "");
    const body = respond(word);
    if (body === null) {
      await send("Fetch.failRequest", { requestId: msg.params.requestId, errorReason: "ConnectionRefused" });
      return;
    }
    await send("Fetch.fulfillRequest", {
      requestId: msg.params.requestId,
      responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    });
  });
}
