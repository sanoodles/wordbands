# wordbands

A vocabulary learning tool: **which words to learn first** — in English, Spanish,
French, German, Portuguese, or Italian. Pick the language you're studying; every word
is placed on a learning band — by raw **frequency**, or by **CEFR level** — so you can
look a word up to see where it lands, or browse the whole vocabulary in order.

## How it works

Learning order is driven by **word frequency**: the words you meet most often are the
ones worth learning first. We measured frequency to be a far better predictor of
learning order than any dictionary-structure metric, so the ranking rests on it alone.

- **Frequency** is the mean of two sources. One is subtitles:
  [SUBTLEX-US](https://www.ugent.be/pp/experimentele-psychologie/en/research/documents/subtlexus)
  (Brysbaert & New, 2009) for English, and the OpenSubtitles-derived
  [FrequencyWords](https://github.com/hermitdave/FrequencyWords) lists for the other
  languages. The other is [wordfreq](https://github.com/rspeer/wordfreq) (Speer, 2022),
  which combines Wikipedia, subtitles, news, books, web text and social media. Subtitles
  alone hold too few formal and technical words to fill C1 and C2. Inflections are merged
  onto their base form via a per-language
  [lemmatization list](https://github.com/michmech/lemmatization-lists), so a concept is
  one entry carrying its combined frequency.
- **CEFR levels** (A1–C2) are derived from frequency rank, with the band boundaries
  calibrated against the [CEFR-J Wordlist](https://www.cefr-j.org/) (Tono, Tokyo
  University of Foreign Studies) — so the labels are learner-familiar while coverage
  stays the full vocabulary. CEFR-J stops at B2, so the C1 and C2 boundaries extrapolate
  the same doubling trend rather than resting on a source. The calibration is one English
  measurement, reused unchanged for every language as a first-order heuristic: no language
  has a CEFR source of its own, and no external dictionary is required at runtime.
- **The tail is filtered.** A subtitle corpus does not trail off into rare words. It
  trails off into character names, untranslated English, misspellings and OCR debris:
  past rank 25,000 only about one word in seven is in the language's own dictionary. So
  past that rank a word stays only if the lemmatization list vouches for it, or the
  language's own Wiktionary and its spell checker both do. Among the 25,000 most frequent
  words, the spell checker removes what it rejects, mostly untranslated English and names.
  Every list ends at rank 50,000, where C2 ends.
  [docs/build-filters.md](docs/build-filters.md) explains every filter the build applies.
- **Display casing** is measured from the
  [Leipzig Corpora](https://wortschatz.uni-leipzig.de/en/download) sentence collection:
  how often each word is capitalized mid-sentence decides whether it's shown capitalized.
  One rule serves every language — German nouns, and proper nouns anywhere, come out
  capitalized, while Spanish `lunes` and Italian `gennaio` correctly stay lowercase.
- **Personal names** are filtered out — subtitle corpora are full of character names, which
  aren't vocabulary. A word is dropped only when a [names gazetteer](https://github.com/smashew/NameDatabases),
  the lemma list, mid-sentence casing, and how often it follows a determiner *all* agree
  it's a name; each guard rescues words the others would wrongly take.
- **Defining levels** measure how heavily the dictionary leans on a word to define others.
  They are not a difficulty scale. They are computed from each language's own Wiktionary:
  the [English](https://en.wiktionary.org/), [Portuguese](https://pt.wiktionary.org/),
  [Italian](https://it.wiktionary.org/), [French](https://fr.wiktionary.org/),
  [Spanish](https://es.wiktionary.org/) and [German](https://de.wiktionary.org/)
  ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)), extracted by
  [Wiktextract](https://kaikki.org/) (Ylonen, 2022). The definitions are read as a graph of
  which word defines which, as in
  [Blondin Massé et al. (2008)](https://aclanthology.org/W08-2003/) and
  [Vincent-Lamarre et al. (2016)](https://doi.org/10.1111/tops.12211). The levels come from
  that graph's k-core decomposition
  ([Seidman, 1983](https://doi.org/10.1016/0378-8733(83)90028-X)). Restricted defining
  vocabularies go back to West & Endicott (1935) and the *Longman Dictionary of
  Contemporary English* (1978).
- **Translations** — the word card's short meaning — come from
  [Google Translate](https://translate.google.com/) (its public `gtx` endpoint), in the
  reader's chosen language. The server asks Google for each word. A second line comes
  from the translation tables of both languages' own Wiktionaries. Between two of Spanish,
  German, French, Italian and Portuguese, it sits under Google's line when it adds a term.
  Between English and one of them, it shows only when Google has nothing.
  [docs/translation.md](docs/translation.md) draws the order the sources are tried in.

Google is the only outside service the server calls while it runs. Everything else,
Wiktionary's translations included, is built into the committed artifacts ahead of time.

## Layout

A single Next.js app.

| Path | Role |
| --- | --- |
| `apps/web` | The website + hosted API (the band browser and word lookup). |
| `apps/web/src/lib/languages.ts` | The supported source languages + their metadata. |
| `apps/web/scripts/build-bands.ts` | Builds the per-language `wordbands.<code>.json` artifacts. |
| `apps/web/data/wordbands.<code>.json` | Committed artifacts: the ranked words + band definitions. |

## Develop

```sh
pnpm install
git config core.hooksPath .githooks   # once per clone, see below
pnpm dev         # http://localhost:3000
pnpm test        # run tests
pnpm typecheck   # type-check everything
```

A push to `main` deploys, so `.githooks/pre-push` type-checks and runs the suite first. Git
only looks in `.githooks` once `core.hooksPath` points there, hence the one-time setup above.
`git push --no-verify` skips it.

[docs/page-load.md](docs/page-load.md) explains how the page loads on a phone, and how to
measure it with `pnpm load:check`.

## Rebuild the data

The artifacts in `apps/web/data/` are committed, so the app runs without a build step.
Rebuilding them needs gitignored inputs in that directory:

| Input | Languages | Source |
| --- | --- | --- |
| `subtlex.csv` | en | SUBTLEX-US |
| `freq-<code>.txt` | es fr de pt it | FrequencyWords' `<code>_full.txt`, not `_50k`. The build sets its own floor |
| `wordfreq-<code>.msgpack.gz` | all | wordfreq 3.1.1's `large_<code>.msgpack.gz`, from its PyPI wheel |
| `lemma-<code>.txt` | all | michmech's lemmatization lists |
| `casing-<code>.txt` | all | A Leipzig Corpora sentences file |
| `names.txt` | shared | `smashew/NameDatabases` |
| `<base>.dic` and `<base>.aff` | all | LibreOffice's Hunspell dictionaries, named by `spellDict` in the build's `LANGS` table |
| `wiktextract-<code>.jsonl.gz` | all | kaikki.org's extract of the language's own Wiktionary |

The spell gate also needs the `hunspell` binary on `PATH`. Then run:

```sh
pnpm --filter @wordbands/web build:lexicon      # Wiktionary's headwords, which build:bands reads
pnpm --filter @wordbands/web build:bands        # every language
pnpm --filter @wordbands/web build:bands es     # one language
pnpm --filter @wordbands/web build:wiktionary   # Wiktionary's translations
```

The defining levels come from the separate defining-vocabulary repo. They hold one level
per ranked word, so a rebuilt list needs them emitted again.

> **Heads up:** `next dev` and `next build` share `apps/web/.next`, so running
> `pnpm build` while the web dev server is live corrupts it (its API routes start
> 500ing). To verify a production build without stopping `pnpm dev`, use
> `pnpm --filter @wordbands/web build:check` — it builds into `.next-build`.

## License

MIT
