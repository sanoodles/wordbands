# How the page loads on a phone

The page has a budget of 0.3 seconds on a phone. `SPEC.md` holds the rules, under `LOAD`.
This page explains what the budget covers, the order the page loads in, and how to measure
it.

## What the budget covers

| Moment | First visit | Repeat visit |
| --- | --- | --- |
| The first paint | Within 0.3 s | Within 0.3 s |
| The search field shows | No budget | Within 0.3 s |

The search field is in the HTML, so it shows at the first paint on either visit. That is when
it shows, not when it is ready. The field reacts once the browser has run the page's
JavaScript, about 600 ms into a repeat visit on a simulated phone. Text typed before then stays
in the field, and Enter works, because the field is a plain form.

The word chips have no budget. They need a second round trip to the API, after the word's own
lookup answers.

"A phone" means 390×844 on good 4G, with the CPU 2× slower: 40 ms added to each request, 20
Mbps down and 5 Mbps up. A repeat visit opens a new connection, with the files in the disk
cache. The budget holds for a page the CDN keeps. A miss renders in `iad1` and takes longer.

## The order

| Step | Where it happens | What decides its time |
| --- | --- | --- |
| Pick the path | Vercel's router | It reads the theme cookies and the country, and rewrites `/` to `/home/<theme>/<country>`. No function runs |
| Answer with the HTML | Vercel's CDN, or a function in `iad1` on a miss | Whether the CDN keeps that path and query |
| First paint | The browser | The stylesheets and the search field are in the HTML, so no file blocks the paint |
| Download the scripts | The browser, from the CDN | All of them are named in the HTML, so they download side by side |
| Mount the Workspace | The browser | The first client render replaces what the server sent, without moving the field |
| Look the word up | The browser, then `/api/word` and `/api/bands` | The CDN keeps both answers |
| Show the word chips | The browser, then `/api/band` | This call waits for the word's band |

## Where the first paint goes

A trace of the deployed page on the simulated phone, in headless Brave with no GPU:

| Time | First visit | Repeat visit |
| --- | --- | --- |
| The HTML has arrived | About 210 ms | About 170–195 ms |
| Parse the HTML | About 25 ms | About 25 ms |
| Work out the styles | 29 ms | 28 ms |
| Lay the page out | 50 ms | 56 ms |
| The first paint | About 340 ms | 310–390 ms |

No script holds the paint back. They run after it. So the paint is the connection, which
nothing in this repo sets, plus the browser's work on its first frame. The long font stack
accounts for about 16 ms of the layout on the Linux machine that measured this. An iPhone looks
fonts up differently, so that number does not carry over.

## Measure it

| Command | Does |
| --- | --- |
| `pnpm load:check [url]` | Makes five first visits and five repeat visits on a simulated phone. It exits 1 when a median is over budget |
| `pnpm probe <path> [step …]` | Reads anything else on the page |

`load:check` restarts the browser between the two visits, so a repeat visit keeps the disk
cache and loses the connection and the memory cache. A reload in one session keeps both and
reads too fast. The check counts only the visits the CDN answered, because the rules are about a
page the CDN keeps. It stubs `/api/translate`, so it never reaches Google.

A push empties the CDN, so run it twice after a deploy. The first run fills the entries that
the second run reads.

Four traps in reading the numbers:

| Trap | Detail |
| --- | --- |
| Chrome's `responseStart` can read too early | It can mark an interim response. `finalResponseHeadersStart` is the real wait |
| A desktop is not a phone | The checks simulate a phone in headless Chromium. Nothing here runs on an iPhone |
| A field in the DOM is not yet on screen | The search field enters the DOM before the first paint, so `load:check` takes the later of the two |
| One location | The figures come from a machine that reaches Vercel's Frankfurt edge. A reader further from an edge waits longer on every step |
