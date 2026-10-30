# How the page loads on a phone

The page has a budget of 0.3 seconds on a phone. `SPEC.md` holds the rules, under `LOAD`.
This page explains what the budget covers, the order the page loads in, and how to measure
it.

## What the budget covers

| Moment | First visit | Repeat visit |
| --- | --- | --- |
| The first paint | Within 0.3 s | Within 0.3 s |
| The search field shows | No budget | Within 0.3 s |

A first visit has no budget for the search field. The browser has to download the page's
JavaScript and run it first, and that takes about 650 ms on good 4G. Only rendering the
search field on the server would beat that. The server would then need the picks stored in
the browser, so the page could no longer be kept at the CDN.

The word chips have no budget either. They need a second round trip to the API, after the
word's own lookup answers.

"A phone" means 390×844 on good 4G, with the CPU 2× slower: 40 ms added to each request, 20
Mbps down and 5 Mbps up. The budget holds for a page the CDN keeps. A miss renders in `iad1`
and takes longer.

## The order

| Step | Where it happens | What decides its time |
| --- | --- | --- |
| Pick the path | Vercel's router | It reads the theme cookies and the country, and rewrites `/` to `/home/<theme>/<country>`. No function runs |
| Answer with the HTML | Vercel's CDN, or a function in `iad1` on a miss | Whether the CDN keeps that path and query |
| First paint | The browser | The stylesheets are in the HTML, so no file blocks the paint |
| Download the scripts | The browser, from the CDN | All of them are named in the HTML, so they download side by side |
| Mount the Workspace | The browser | The server sends a sized placeholder, and the first client render replaces it |
| Look the word up | The browser, then `/api/word` and `/api/bands` | The CDN keeps both answers |
| Show the word chips | The browser, then `/api/band` | This call waits for the word's band |

## Measure it

| Command | Does |
| --- | --- |
| `pnpm load:check [url]` | Loads the page five times on a simulated phone. It exits 1 when a median is over budget |
| `pnpm probe <path> [step …]` | Reads anything else on the page |

`load:check` counts only the visits the CDN answered, because the rules are about a page the
CDN keeps. It stubs `/api/translate`, so it never reaches Google.

A push empties the CDN, so run it twice after a deploy. The first run fills the entries that
the second run reads.

Three traps in reading the numbers:

| Trap | Detail |
| --- | --- |
| Chrome's `responseStart` can read too early | It can mark an interim response. `finalResponseHeadersStart` is the real wait |
| A desktop is not a phone | The checks simulate a phone in headless Chromium. Nothing here runs on an iPhone |
| One location | The figures come from a machine that reaches Vercel's Frankfurt edge. A reader further from an edge waits longer on every step |
