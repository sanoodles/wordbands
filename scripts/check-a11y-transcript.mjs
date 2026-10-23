#!/usr/bin/env node
// Renders the deployed page as what a screen reader would say, and diffs that against a
// committed transcript.
//
// The other two checks each read one thing at a time. The linter reads one element, so it
// cannot see a name computed from two of them. The suite reads one component in jsdom, so
// it cannot see the assembled page, real CSS, or Fondue's own markup. Both also only catch
// what someone thought to assert — and the two real problems found here were both things
// nobody had thought of: a name said four times over, and six tab stops announcing a CEFR
// level with no word attached.
//
// So this asserts nothing. It writes the page down in a form a person reads in ten
// seconds, and fails when that changes. A change is usually intended: re-run with --update
// and let the diff be the thing reviewed.
//
//   node scripts/check-a11y-transcript.mjs [url] [--update]
//
// Needs a Chromium-family browser on PATH; set CHROME to name one. lib/browser.mjs drives it.

import { readFileSync, writeFileSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluator, interceptTranslate, killOnExit, launch, openPage, press, stop } from "./lib/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, "a11y-transcript.txt");

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const TARGET = args.find((a) => !a.startsWith("--")) ?? process.env.WORDBANDS_URL ?? "https://wordbands.vercel.app";

// One fixed scenario, so the transcript is of the page and not of the day. German for the
// mid-sentence capitalization, `view=cefr` because that is the default and the band tabs
// are the widget with the most to get wrong.
const SCENARIO = "/?source=de&word=Wasser&target=en&view=cefr";
// A form the merge folded away, so the page answers for its base word and has to say so.
// "jede" reaches "jeder" through the chase past a lemma the build dropped (FILTER-8),
// which is the part of the redirect most likely to break without anything else noticing.
const FORM_SCENARIO = "/?source=de&word=jede&target=en&view=cefr";
// A pair Wiktionary's translations are built for, so the card shows two sources' lines.
const PAIR_SCENARIO = "/?source=es&word=siesta&target=de&view=cefr";

// The translation is Google's, and Google can reword it any afternoon. Stubbed, so the
// transcript is our markup rather than today's dictionary — which is the subject anyway.
const GLOSS = {
  translation: "water",
  senses: ["water", "aqua"],
  groups: [{ pos: "noun", terms: ["water", "aqua"] }],
  levels: {
    water: { key: "A1", label: "A1 · Beginner", rank: 391 },
    aqua: { key: "C1", label: "C1 · Advanced", rank: 18422 },
  },
};

// Google's line for the pair, which Wiktionary's sits under. Wiktionary's comes from
// committed data and needs no stub.
const GLOSSES = {
  siesta: {
    translation: "Schnapp",
    senses: ["Nickerchen", "Schläfchen"],
    groups: [{ pos: "noun", terms: ["Nickerchen", "Schläfchen"] }],
    levels: {
      Nickerchen: { key: "B1", label: "B1 · Intermediate", rank: 5442 },
      Schläfchen: { key: "C1", label: "C1 · Advanced", rank: 14011 },
    },
  },
};

async function transcribe(send, on) {
  const { val, until } = evaluator(send);

  await interceptTranslate(send, on, (word) => GLOSSES[word] ?? GLOSS);
  await send("Page.enable");
  await send("Accessibility.enable");

  // Each section that presses a key starts from a freshly loaded page. Arrowing the cloud
  // queues a lookup that lands 700ms later and opens that word's band — which, left alone,
  // arrives in the middle of the next section and reverts the tab it just moved.
  const reset = async () => {
    await send("Page.navigate", { url: TARGET + SCENARIO });
    await until(
      `!!document.querySelector("[role=option]")`,
      "the word cloud",
      `document.querySelector(".BandBrowser")?.innerText?.slice(0, 80) ?? null`,
    );
    await until(
      `!!document.querySelector("[aria-live] [role=img]")`,
      "the translation",
      `document.querySelector("[aria-live]")?.innerText ?? null`,
    );
  };
  await reset();

  // The page is responsive, and below 700px the band tabs are a dropdown instead. A window
  // that came up the wrong size would otherwise transcribe as a pile of unexplained
  // differences rather than as the environment being wrong.
  for (const [sel, what] of [
    ["[role=tablist] [role=tab]", "the desktop band tabs"],
    ["form[role=search] [role=img]", "the badge in the search field"],
  ]) {
    if (!(await val(`!!document.querySelector(${JSON.stringify(sel)})`)))
      throw new Error(`${what} did not render — is the window 1440 wide and the font loaded?`);
  }

  const V = (a) => (a ? a.value : undefined);
  const out = [];
  const say = (s = "") => out.push(s);
  const rule = (t) => { say(); say(t); say("-".repeat(72)); };

  // Names and descriptions come from Chrome, because they are computed and half of this
  // page's markup is Fondue's — there is no reading them off the source.
  //
  // Roles and states do not. Both are authored, and Chrome has renamed roles between
  // versions ("img" became "image"), which would make this a transcript of whichever
  // Chrome the runner shipped that week rather than of the page.
  const speak = async () => {
    // Focus resting on <body> is the page having none — where a tab walk ends up once it
    // has passed the last control and been round the browser's own chrome.
    if (await val(`(() => { const a = document.activeElement;
      return !a || a === document.body || a === document.documentElement; })()`)) return null;
    const { result } = await send("Runtime.evaluate", { expression: "document.activeElement" });
    if (!result.objectId) return null;
    const { nodes } = await send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false });
    const n = nodes?.[0];
    if (!n) return null;
    const role = await val(`(() => { const a = document.activeElement;
      return a.getAttribute("role")
        ?? ({ A: "link", BUTTON: "button", INPUT: "textbox", SELECT: "combobox", SUMMARY: "button" })[a.tagName]
        ?? a.tagName.toLowerCase(); })()`);
    const states = await val(`(() => { const a = document.activeElement, s = [], g = (k) => a.getAttribute(k);
      if (g("aria-selected") === "true") s.push("selected");
      if (g("aria-checked") === "true") s.push("checked");
      if (g("aria-pressed") === "true") s.push("pressed");
      if (g("aria-disabled") === "true") s.push("unavailable");
      if (g("aria-expanded")) s.push(g("aria-expanded") === "true" ? "expanded" : "collapsed");
      if (g("aria-posinset")) s.push(g("aria-posinset") + " of " + g("aria-setsize"));
      return s; })()`);
    const bits = [V(n.name) || "(unnamed)", role, ...states];
    if (V(n.description)) bits.push(`— ${V(n.description)}`);
    return bits.join(", ");
  };

  // Everything that reads the page as loaded goes first: arrowing the cloud looks a new
  // word up, which rewrites the title and the translation underneath.
  rule("THE DOCUMENT — before anything is touched");
  say(`  title        ${JSON.stringify(await val(`document.title`))}`);
  say(`  description  ${JSON.stringify(await val(`document.querySelector("meta[name=description]")?.content ?? null`))}`);
  say(`  lang         ${JSON.stringify(await val(`document.documentElement.lang`))}`);

  rule("THE OUTLINE — landmarks and headings, in the order they are met");
  const { nodes } = await send("Accessibility.getFullAXTree");
  // getFullAXTree hands back a flat array in no particular order, so the outline is walked
  // from the root. An outline out of order is worse than none: it reads as a page defect.
  const kids = new Map();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const LANDMARK = new Set(["main", "navigation", "search", "banner", "contentinfo", "complementary", "region", "form"]);
  const walk = (n, depth) => {
    let next = depth;
    if (!n.ignored) {
      const role = V(n.role);
      if (LANDMARK.has(role)) {
        say(`  ${"  ".repeat(depth)}${role}${V(n.name) ? ` "${V(n.name)}"` : " (unnamed)"}`);
        next = depth + 1;
      } else if (role === "heading") {
        const lvl = (n.properties ?? []).find((p) => p.name === "level")?.value.value;
        say(`  ${"  ".repeat(depth)}h${lvl} "${V(n.name)}"`);
      }
    }
    for (const c of kids.get(n.nodeId) ?? []) walk(c, next);
  };
  for (const root of nodes.filter((n) => !n.parentId)) walk(root, 0);

  // A line as a screen reader reads it, each named element by its name, and as it copies.
  const reading = (sel) => val(`(() => { const l = document.querySelector(${JSON.stringify(sel)}); if (!l) return "(none)";
    const walk = (n) => { let o = "";
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { o += c.textContent; continue; }
        if (c.getAttribute && c.getAttribute("aria-hidden") === "true") continue;
        const al = c.getAttribute && c.getAttribute("aria-label");
        o += al ? " (" + al + ")" : walk(c);
      } return o; };
    return walk(l).replace(/\\s+/g, " ").trim(); })()`);
  const copied = async (sel) => JSON.stringify(await val(`(() => { const l = document.querySelector(${JSON.stringify(sel)});
    const s = getSelection(), r = document.createRange(); r.selectNodeContents(l); s.removeAllRanges(); s.addRange(r);
    const t = s.toString(); s.removeAllRanges(); return t; })()`));

  rule("READING THE TRANSLATION, rather than tabbing to it");
  say(`  ${await reading("[aria-live] span[lang]")}`);
  say(`  copied as    ${await copied("[aria-live] span[lang]")}`);

  // Tab moves focus and activates nothing, so this leaves the page as it found it.
  rule("TAB THROUGH THE PAGE");
  // The walk has to start above the first stop, and blurring the autofocused field does not
  // put it there: Chrome leaves its sequential-focus starting point on the blurred element,
  // so the first Tab lands on what follows the field and the four stops before it go
  // unwalked. `#main` is where a click on empty page space lands, since it covers the whole
  // page, and the skip link is the one focusable the body holds before it — so stepping back
  // once from `#main` reaches the top of the page whatever else moves.
  await val(`(document.getElementById("main").focus(), window.scrollTo(0, 0), true)`);
  await press(send, "Shift+Tab");
  for (let i = 0, stop = 0; i < 40; i++) {
    // The step back above already landed on the first stop, so a stop is read and then left.
    if (i) await press(send, "Tab");
    // `next dev` serves its own dev-tools overlay as a focusable custom element that
    // production never has, so without this a local run differs from the deployed page by
    // one stop and the check is useless as a pre-push read. Skipped rather than stopped
    // on: the walk has to carry on past it, and the numbering has to not count it.
    if (await val(`!!document.activeElement?.closest("nextjs-portal")`)) continue;
    const line = await speak();
    // Past the last control, focus leaves for the browser's own chrome and comes back on
    // the body. Anything after that is the walk going round a second time.
    if (line === null) break;
    say(`  ${String(++stop).padStart(2)}. ${line}`);
  }

  rule("THE WORD CLOUD — a listbox of the band's words");
  await reset();
  await val(`(document.querySelector("[role=option][tabindex='0']").focus(), true)`);
  say(`  on entry     ${await speak()}`);
  for (const k of ["ArrowRight", "ArrowDown"]) {
    await press(send, k);
    say(`  ${k.padEnd(12)} ${await speak()}`);
  }

  // A redirect adds exactly one sentence to the page, in a live region, and swaps the word
  // out from under the field — so those three readings are the whole scenario. Its own
  // navigation rather than reset()'s, because the deeplink is the scenario.
  rule("LOOKING UP AN INFLECTED FORM — the word answered for is not the one asked for");
  await send("Page.navigate", { url: TARGET + FORM_SCENARIO });
  await until(
    `(document.querySelector("[role=status]")?.textContent ?? "").length > 0`,
    "the redirect notice",
    `document.querySelector("[role=status]")?.textContent ?? null`,
  );
  say(`  asked for    jede`);
  say(`  announced    ${await val(`document.querySelector("[role=status]").textContent`)}`);
  say(`  the field    ${JSON.stringify(await val(`document.querySelector("form[role=search] input").value`))}`);
  // Through aria-labelledby, which is how the card is named: its own visible heading.
  say(`  the card     ${await val(`(() => { const c = document.querySelector(".WordCard");
    return document.getElementById(c?.getAttribute("aria-labelledby"))?.textContent.trim() ?? null; })()`)}`);

  // Each source's line ends in its name, which is also the way to its page for the word.
  rule("TWO SOURCES — Spanish into German, with Wiktionary's line under Google's");
  await send("Page.navigate", { url: TARGET + PAIR_SCENARIO });
  // Keyed on Wiktionary's link: while the lookup is in flight the spinner's own wrapper
  // has two children as well, so a count of them reads the spinner.
  const LINE = "[aria-live] > div > span[lang]";
  await until(
    `!!document.querySelector('${LINE}:last-child a[href*="wiktionary.org"]')`,
    "both sources' lines",
    `document.querySelector("[aria-live]")?.innerText ?? null`,
  );
  for (const [name, sel] of [["Google", `${LINE}:first-child`], ["Wiktionary", `${LINE}:last-child`]]) {
    say(`  ${name.padEnd(12)} ${await reading(sel)}`);
    say(`  ${"copied as".padEnd(12)} ${await copied(sel)}`);
  }
  await val(`document.querySelector('${LINE}:last-child a').focus()`);
  say(`  ${"its link".padEnd(12)} ${await speak()}`);

  // Last, because moving off A1 leaves a different band open behind it.
  rule("THE BAND TABS — one stop, arrows inside it");
  await reset();
  await val(`(document.querySelector("[role=tab][aria-selected=true]").focus(), true)`);
  say(`  on entry     ${await speak()}`);
  for (const k of ["ArrowRight", "End", "Home"]) {
    await press(send, k);
    // The tab takes focus in the key handler and its state a render later, so reading it
    // straight away catches it selected sometimes and not others.
    await until(
      `document.activeElement.getAttribute("aria-selected") === "true"`,
      "the tab to take the selection",
      `document.activeElement.getAttribute("aria-label")`,
    );
    const line = await speak();
    // The panel is fetched, so it lands after the tab moves. Waiting for it is the point:
    // a transcript of a tab already moved and a panel not yet is a transcript of nothing.
    const label = await val(`document.activeElement.getAttribute("aria-label").split(",")[0]`);
    await until(
      `document.querySelector("[role=tabpanel] [role=listbox]")?.getAttribute("aria-label").startsWith("Words in " + ${JSON.stringify(label)})`,
      "the panel to follow the tab",
      `document.querySelector("[role=tabpanel]")?.innerText?.slice(0, 60) ?? null`,
    );
    say(`  ${k.padEnd(12)} ${line}`);
    say(`  ${" ".repeat(12)}   cloud: ${await val(`document.querySelector("[role=tabpanel] [role=listbox]").getAttribute("aria-label")`)}`);
  }
  return out.join("\n").trimStart() + "\n";
}

// A line diff, so an inserted line shows as one insertion rather than shifting everything
// below it into noise. Longest common subsequence, small enough to write, with a couple of
// lines of context so a changed line can be placed by eye.
function diff(a, b, context = 2) {
  const m = a.length, n = b.length;
  const lcs = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const rows = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) rows.push({ mark: "  ", text: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) rows.push({ mark: "- ", text: a[i++] });
    else rows.push({ mark: "+ ", text: b[j++] });
  }
  while (i < m) rows.push({ mark: "- ", text: a[i++] });
  while (j < n) rows.push({ mark: "+ ", text: b[j++] });

  // Unchanged runs longer than the context window collapse, so a one-line change in a
  // hundred-line transcript prints as a few lines and not as the whole file.
  const keep = rows.map((r, k) =>
    r.mark !== "  " || rows.some((o, l) => o.mark !== "  " && Math.abs(l - k) <= context));
  const out = [];
  let skipped = false;
  for (const [k, r] of rows.entries()) {
    if (keep[k]) {
      if (skipped) out.push("  …");
      skipped = false;
      out.push(r.mark + r.text);
    } else skipped = true;
  }
  return out;
}

// GitHub renders one of these as an annotation on the run itself, so a failure says what
// changed where it is read — the log is behind a click, and behind admin rights for anyone
// reading over the API.
function annotate(title, body) {
  if (!process.env.GITHUB_ACTIONS) return;
  const esc = (t) => t.replaceAll("%", "%25").replaceAll("\n", "%0A").replaceAll("\r", "%0D");
  // writeSync, not console.log: process.exit() below truncates a piped stdout mid-write,
  // and in Actions stdout is always a pipe. The first attempt at this lost every
  // annotation that way, which read as the command never having run.
  writeSync(1, `::error title=${esc(title)}::${esc(body.slice(0, 4000))}\n`);
}

let browser;
try {
  browser = launch({ name: "a11y-transcript" });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
killOnExit(browser);

let actual;
try {
  const page = await openPage(browser);
  actual = await transcribe(page.send, page.on);
  page.close();
} catch (err) {
  // A check that could not check is not a pass.
  console.error(`could not transcribe ${TARGET}${SCENARIO}`);
  console.error(err.message);
  annotate("Could not transcribe the page", `${TARGET}${SCENARIO}\n\n${err.stack ?? err.message}`);
  process.exit(1);
} finally {
  await stop(browser);
}

if (UPDATE) {
  writeFileSync(BASELINE, actual);
  console.log(`wrote ${BASELINE} from ${TARGET}`);
  console.log("Read the diff before committing it — that reading is the whole check.");
  process.exit(0);
}

let expected;
try {
  expected = readFileSync(BASELINE, "utf8");
} catch {
  console.error(`no transcript at ${BASELINE}. Create it with --update.`);
  process.exit(1);
}

if (expected === actual) {
  console.log(`the page still reads the same on ${TARGET}`);
  process.exit(0);
}

const lines = diff(expected.split("\n"), actual.split("\n"));
console.error(`the page reads differently on ${TARGET}:\n`);
for (const line of lines) console.error(line);
annotate("The page reads differently", `${TARGET}\n\n${lines.join("\n")}`);
console.error(`
- is scripts/a11y-transcript.txt, + is ${TARGET} now.
If the change is meant, re-run with --update and commit the diff.`);
process.exit(1);
