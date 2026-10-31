# How the build filters and bands a word list

`apps/web/scripts/build-bands.ts` runs on a developer's machine and writes one committed
`wordbands.<code>.json` per language. This page explains each filter the build applies, what
was measured, and what was tried and rejected. It also explains where the CEFR bands come from.

`SPEC.md` holds the rules, under `FILTER` and `BAND`. `CLAUDE.md` lists the build's inputs and
its commands.

## The filters

| Filter | Knob | Rule | Effect |
| --- | --- | --- | --- |
| Frequency floor | `minCount` | Drop words under 10 raw occurrences | Below that the OpenSubtitles tail is mostly hapax noise. Stated in occurrences, not rank, so it means the same in every language. Omitted for English, whose column is per-million. **Relaxing it is measured and rejected** — see below |
| Clitics | `clitics`, `mesoEndings`, `cliticExceptions` | Strip pronouns hyphenated onto verbs and merge the frequency back into the verb | 24% of the pt list and 12% of fr. pt `lembrar` 333 → 177, fr `excuser` 761 → 297 |
| Own-entry | — | `FILTER-3` | The lists are lemma-sorted, so plain first-wins hands a shared form to the alphabetically-first claimant. That deletes common words (it `governo` into `governare`, fr `tu` into `il`; 100–160 of the top 1,000 per language) and floats the absorber into the beginner bands |
| Dictionary gate | `dictGate` | Past rank 25,000, keep a word only if the lemma list vouches for it | Drops about 80 junk words per real one. Omitted for English, whose source is curated |
| Spell gate | `spellDict`, `spellVariants` | `FILTER-9` | 1,379 to 7,204 a language. The other half of the same list — see below |
| Truncated stems | `spellDict`, `STEM_MIN_FORM` | `FILTER-8` | 14 in German, 2 to 6 elsewhere, because michmech headwords German determiners on a bare stem and does not do the same to the Romance five. `jed` → `jeder`, `mehrer` → `mehrere` |
| Morphology | `morphology` | `FILTER-10` | +17,887 in German, taking it 35.6k → 53.5k. See below |
| Personal names | `determiners`, `NAME_RANK_FLOOR` | Drop a word meeting all four tests below | 1,126 to 4,440 a language |
| Display casing | `casingFile` | Measure each word's mid-sentence capitalization and store that casing | Sentence-initial position is ignored, since it capitalizes everything |
| Case-homographs | — | Keep both casings of one entry under `variants` | `"essen" -> ["Essen","essen"]`, most frequent first. `getWord` returns them as `forms` |

## Below the frequency floor, and why it stays at 10

`minCount: 10` is the binding constraint on real-but-rare words, and lowering it is the
one option here that was measured and **rejected outright**. Do not revisit it without
new data.

Measured on German at counts 3–9: 176,647 words land nowhere. The best filter found
(hunspell plus a lemma-shaped test) admits 41,241 of them at about 3:1, and a 40-word
random sample of those held ~10 duds — inflected forms (`sondereinsätzen`,
`überschaubare`), nonce compounds (`drachenpanzer`), place names (`tölz`). Stricter
variants are *worse*: `.dic`-stems-only runs ~2.7:1, because the `.dic` carries proper
nouns (`montesquieu`, `skagerrak`, `ludwigsburg`).

The ratio is not the deciding number. **Every sub-floor word is rarer than every word
already in the list**, so they can only stack below it:

| Where the 41,241 land | Count |
| --- | --- |
| German index | 35,630 → 76,871, more than double |
| A1–C1 | **0** |
| C2 / `rare` | 14,370 / 26,871 |

Doubling the index to fill two bands nobody browses, at 3:1, is the worst trade available.

## Clitics

pt and fr hyphenate pronouns onto verbs, so every verb × pronoun pair spells its own
surface form: `deixa-me`, `fazê-lo`, `donne-moi`, `a-t-il`. None of them is vocabulary.

| Detail | Rule |
| --- | --- |
| Mesoclisis | pt puts the pronoun inside the verb (`contar-te-ia`), so `mesoEndings` also strips a trailing future or conditional ending |
| Stem repair | `STEM_REPAIR` restores the infinitive `-r` that pt drops before `-lo`/`-la` (`fazer` + `o` → `fazê-lo`) |
| Unknown stem | Dropped, not kept: 346 forms in pt, 400 in fr |
| Whole segments | Segments are matched whole. This is the load-bearing detail: it keeps `guarda-chuva` (ends in "chuva", not "a") and `arc-en-ciel` (ends in "ciel", not "en") |
| Why whole | No lemma list holds a single hyphenated entry, so the dictionary cannot referee it, and rank cannot either — `peut-être` and `rendez-vous` sit among `avez-vous` and `dis-moi` |
| Not clitics | `là` and `ci`, since `celui-là` and `là-bas` are vocabulary. `cliticExceptions` covers the rest (`rendez-vous`, `garde-à-vous`) |

## The tail and the dictionary gate

The subtitle tail is not rare vocabulary. Past rank 25k only about 14% of it is in the
language's own lemma list.

| Junk kind | Examples |
| --- | --- |
| Character names | `ryûji` |
| Untranslated English | `truck`, `workshop` |
| Misspellings | `gerer` for "gérer", `règler` |
| OCR debris | `lslam`, `arrãªtez` |
| Noise | `rrr`, `shhhh` |

Neither frequency nor the name gazetteer can tell that from a rare word; the gazetteer has
no entry for `ryûji` or `rrr`. The dictionary can, which is what `dictGate` uses.

| Known cost | Detail |
| --- | --- |
| Not used for English | Its source is curated and its lemma list is the smallest by far, 808KB against French's 4.9MB. Gating it would cut 11k mostly-real words. The spell gate below still runs there, since it judges the head rather than the tail |
| Real words lost | 1–3% of what the gate drops, 900–2,700 per language |
| Where they cluster | Productive morphology the lists do not headword: `-mente`/`-ment` adverbs, `-ità`/`-ité` nouns, superlatives — `logicamente`, `unanimità`, `rigoureusement`, `Geborgenheit` |
| Spot-check | Italian's list has no `entropia`, so the build's spot-check for it reports `—` |

## Morphology, the second way past the gate

The gate asks the lemma list to vouch for a word, and German loses most by it. German
spells compounding **inside one word**, and compounding is productive: `Bananenbrotrezept`
is ordinary German that no list will ever hold, because the rule makes words faster than
anyone can enumerate them. English writes the same thing as three words and needs three
entries; German needs one per combination, forever. So the rule is re-derived rather than
looked up, and `FILTER-10` is the result.

| Signal | Catches |
| --- | --- |
| Compound split, on `links` | `Gletscherspalte`, `Schneemaschine`, `Geiselrettung` |
| Derivational suffix | `Appetitlosigkeit`, `Beurlaubung`, `Gutherzigkeit` |
| Prefix | `Vergabe` = ver + gabe |

| Load-bearing detail | Why |
| --- | --- |
| The head of a compound and the stem of a derivation must be a **lemma**, not any known form | Otherwise inflections walk in as base words: `rettungsbooten` splits on `booten`, `bundeskanzlers` on `kanzlers` |
| A part in the gazetteer that the lemma list lacks poisons the split | German compounding licenses names freely — `carleton` is carl+ton, `paulchen` is paul+chen. Costs ~1,083 words, and cleared the sample |
| The split is a yes/no vouch and is never shown | So a wrong analysis of a real word costs nothing: `gaststube` splits as gasts+tube and is admitted anyway |
| Only German supplies `morphology` | The Romance five compound phrasally (`arc-en-ciel`), so there is nothing for them to re-derive |

**This is the one thing in the build that is not language-agnostic**, against a script whose
design is "per language this is pure data". It is the first place to look when the build
stops generalising.

Hunspell alone past the gate is about 2:1, because it accepts inflections wholesale: it is a
spell checker, and an inflected form is spelt correctly.

## Words that are absent on purpose

Four German words come up because they are the ones someone notices missing. None of them
is a defect to be fixed:

| Word | Why it is out | What would bring it back |
| --- | --- | --- |
| `Semikolon` | Loanword past the gate, with no German morphology to grab | The hunspell-plus-morphology vouch, at about a third of `morphology`'s precision |
| `polyglott` | Count 3, so below the floor, *and* no morphology | Nothing sensible |
| `Strichpunkt` | Count 3, below the floor | Relaxing the floor, which is rejected above |
| `Vergabestelle` | Count **1** in a 100M-word corpus | Nothing will ever justify it |

## Two filters that look obviously right and are not

Both were tried on the junk problem and both are worse than what the build does.

| Idea | What actually happens |
| --- | --- |
| Cross-corpus attestation (Leipzig) as a junk filter | A dud. It scores `truck` 69 and `workshop` 93, gives the OCR fragment `cklich` 1,257, and has zero hits for `Strichpunkt` or `Semikolon` |
| Longest-common-prefix for lemma disambiguation | Worse than `lemmaOf`. `worse`→`wrong`, `aale`→`aalen`, `acciones`→`accionar` |

## The head of the list, and the spell gate

The dictionary gate answers the tail. The head has the opposite problem and needs the
opposite tool, so `spellDict` runs a Hunspell dictionary over everything *below* rank
25,000 and drops what it refuses. `FILTER-9` is the rule, and every language has one.

The bound is `DICT_GATE`, but it is not the dictionary gate's to set: 25,000 is where a
checker stops being right about a corpus, which is a property of the checker. English has
no `dictGate` and still has a head worth cleaning, so `spellGate` takes the lower of the
two rather than reading `cfg.dictGate`.

Measured against German at rank 25,000, the two sources' blind spots are mirror images:

| | Below the gate | Past the gate |
| --- | --- | --- |
| What the junk is | Untranslated English and names the gazetteer spared | OCR debris, character names, misspellings |
| Spell checker there | **~89% right** | ~84% *wrong* |
| So the judge is | The spell checker | The lemma list |

A checker is thin on exactly what the rare tail is made of — colloquial and
separable-prefix verbs, diminutives, superlatives, intensifier compounds. It rejected
`Nobelpreisträger`, `Jungfernfahrt`, `blitzsauber`, `Spätzchen` and `grabschen`, and a
40-word sample of its rejections past 25,000 held no junk at all. Run there it would be a
vandal. Run on the head it removes `elizabeth` (frequency 5,084), `up`, `janet`, `night`,
`squad` and `scouts` — and every one of its 4,561 drops is below rank 25,000 by
construction, which is the range anyone browses.

A word is refused only when **none of the spellings its language writes it in** is a word.
Both casings, or German's own capitalization decides vocabulary questions. Plus whatever
`spellVariants` adds, which is French's ligature: the corpus writes `oeil`, `coeur` and
`soeur`, the dictionary holds `œil`, `cœur` and `sœur`, and `œ` is on no keyboard. Asking about
the ligature too keeps 26 French words, every one of them real, and admits no junk —
`goes`, `moe` and `tahoe` are no more words with the ligature than without it.

The cost in German is the ~11% it takes with them: real words the dictionary lacks
(`Viech`, `Klunker`, `rabauke`) and pre-1996 spellings (`daß`, `Haß`, `Imbiß`), which
igerman98 is post-reform and does not carry.

A spell checker cannot be the judge of a name, and neither can `names.txt`, which is where
`NAME_RANK_FLOOR` already conceded the point. The Portuguese dictionaries hold `john`, `jack`
and `michael`, so the checker vouches for them as readily as the gazetteer refuses to.

### What it does language by language

German's ~89% is no guide to the rest, so each was measured the same way: dump the
drop list, bucket it by CEFR band, and hand-audit ~20 random words a band. An evenly-spaced
sample lies — it reads near-perfect where a random one reads 85–90%.

| | en | es | fr | de | pt | it |
| --- | --- | --- | --- | --- | --- | --- |
| Dropped below 25,000 | 1,379 | 7,139 | 6,056 | 4,561 | 7,204 | 6,064 |
| Junk, in a hand-audit | ~85% | 92% | 94% | ~89% | 85% | 97% |

Every one of them is dominated by the same two kinds: untranslated English, and the names the
gazetteer's four-way test spared. What differs is the third kind and the cost:

| Language | The third kind of junk | What it takes with them |
| --- | --- | --- |
| en | Contraction debris the tokenizer left: `didn` at rank 87, `doesn`, `isn`, `wouldn`, `hasn`, ten more inside the top 800 | `tv`, `snuck`, `meds`, `arse` — abbreviations and the informal. Its drop is the smallest because SUBTLEX is curated |
| es | Accentless spellings: `aqui`, `asi`, `estan`, `habia` | Enclitic verb forms (`vámonos`, `llevémoslo`, `págame`), diminutives (`amiguito`, `bolsitas`), loanwords `picnic`, `surf`, `beicon` |
| fr | Accentless spellings: `ca`, `plait`, `ecoutez`, `etais` | The 1990 rectifications, which the *classique* list refuses: `diner`, `entrainement`, `traitres` |
| pt | The pre-AO90 orthography, which is most of the drop above rank 3,000: `exactamente`, `acção`, `directo`, `objecto` | 89 of those 166 have no reformed twin in the list, so they go outright — `correcto`, `acto`, `efectuar`. The other 77 keep theirs: `ação` 3,010, `exatamente` 1,306, `diretor` 3,129 |
| it | Accent-stripped duplicates, and almost nothing else: `perche`, `piu`, `gia`, `citta`, `realta`, `verita` | Almost nothing, which is why it audits at 97%. `più` and `può` are the exception: neither has an accented entry, so the word leaves as an entry and stays only as a redirect, `più` → `molto` |

| Measured and rejected | Why |
| --- | --- |
| Asking about the all-caps spelling too | It would keep `tv`, `gps`, `dvd` and the real acronyms `EEUU`, `OTAN`, `VIH`, `IVA` — and with them French's `ok`(133) and `ca`(158), and German's pre-1996 `ungewiß`, `bewußt`, `anschluß`, `rußland`, because uppercase `ß` is `SS`. It would change German's list for junk it does not have |

## Truncated lemma stems

michmech headwords some German determiners and adjectives on a bare stem — `jed` for
jede/jedem/jeden/jeder, `ander`, `beid`, `mehrer`. The own-entry rule (`FILTER-3`) then
hands every inflection to it. `FILTER-8` is the rule; the entry moves to whichever form the
corpus writes.

**The corpus cannot referee this on its own**, which is the trap. A German adjective is
nearly always written declined, so bare `afrikanisch` occurs twice in a million sentences
where `jed` occurs three times — and a rule reading only corpus counts "repairs"
`afrikanisch` to `afrikanischen`, replacing a real word with an inflected one. The
dictionary is what separates them, so a headword moves only when Hunspell says it is not
a word. That is why this needs `spellDict` rather than the casing corpus alone.

| Limit | Detail |
| --- | --- |
| The repair picks the corpus-dominant form | The citation form for `jed` → `jeder`, but not for `ander` → `anderen`. Both are real words, so the wart is cosmetic |
| A headword whose forms do not all extend it is left alone | A different defect: michmech maps *both* `Dach` and the past tense of `denken` onto `dachen`, and there is no splitting that from the list. The spell gate above drops `dachen` instead |

## Personal names

Names like "Ahmed", "Moretti" and "Kendra" crowd subtitle corpora without being
vocabulary. A word is dropped only when all four tests agree.

| Test | Spares |
| --- | --- |
| In the `names.txt` gazetteer | |
| Absent from the language's lemma list | Surnames that are also words: "Koch", "Berg" |
| Capitalized mid-sentence | Lowercase function words that collide with short names: "in", "von", "man" |
| Rarely preceded by a determiner | Ordinary nouns michmech lacks, which surname lists are full of: "Kuss", "Fass", "Geduld", "Sheriff" |

The top `NAME_RANK_FLOOR` (1,000) is exempt, because a hit there is likelier a loanword
noun than a name. A language without a `casingFile` is skipped, since the gazetteer alone
would eat "que", "por", "he" and "she".

Known wart: a few country names sit in the surname list and go with them — `england`,
`france`, `africa`, `canada`, `india` (en), `francia` and `italia` (es), `italia` and
`inghilterra` (it). The determiner test rescues the rest, so fr and pt lose none, but
English never articles a country ("the France" is ungrammatical) so it cannot fire there.
The result looks arbitrary: `germany` stays, `france` goes.

## Display casing

Measuring mid-sentence capitalization needs no per-language rules and gets the right
answer in every language.

| Outcome | Examples |
| --- | --- |
| Capitalized | German nouns and names: `Wasser`, `Berlin`. Proper nouns anywhere: `Roma`, `Lisboa`, `London`, `Dios` |
| Lowercase | Verbs and pronouns. es `lunes`, `enero`, `español`; it `lunedì`, `gennaio` |

The lemma list is the authoritative fallback for the rare tail. The stored `ranked` words
carry display casing, and every lookup in `bands.ts` keys on lowercase, so search and
typeahead stay case-insensitive. A language without a `casingFile` stays lowercase; all
six have one.

## CEFR bands

The thresholds are `BAND-1`, and `BAND-2` is that every language uses them unchanged. No graph
and no external dictionary is involved. Past C2 sits `rare` ("Rare · beyond C2"), open-ended
at `max: null`.

| Detail | Why |
| --- | --- |
| Tops roughly double, so C2 ends at 50k | Rather than running open-ended to the end of the list |
| `rare` past it is open-ended | It is what lets `getWord` assert a band exists at every rank — keep `max: null` on whichever band is last |
| **German reaches it and the other five do not** | The morphology vouch buys back ~18k compounds, taking the list past 50k, while `dictGate` and the spell gate keep the other five inside C2 |

**No language has a CEFR source of its own.** The whole calibration is one English
measurement, and the rest is reuse:

| Element | Where it comes from |
| --- | --- |
| The A1 to B2 medians, A1≈635 A2≈2275 B1≈4692 B2≈8394 | The CEFR-J Wordlist, English. Which version was used at calibration time was not recorded; the medians reproduce within 8–17% against Wordlist 1.5 on the current artifact |
| The C1 and C2 tops | Nothing external. CEFR-J stops at B2, so 25k and 50k extrapolate the doubling trend |
| CEFR itself | No vocabulary at all. The framework specifies ability, not words, so every CEFR word list is a third party's construction and there is no ground truth under the labels |

**How far the reuse holds was measured once**, against the CEFR-J Wordlist 1.5 plus the
Octanove C1/C2 profile 1.0 (`openlanguageprofiles/olp-en-cefrj`), on the 8,259 of its 8,690
single-word headwords that the English artifact holds:

| Measure | Value |
| --- | --- |
| Spearman ρ (frequency rank, profile level) | 0.71 |
| The band `BAND-1` assigns is the profile's | 38% |
| Within one band | 84% |
| Ceiling for any one-band-per-word scheme, scored per (headword, pos) sense | 92% |
| Refitting all five thresholds to the profile | 38% → 43%, and A2 and C1 collapse to slivers |

So the thresholds are leaving almost nothing on the table — the ceiling is the signal, not
the calibration. Both figures are floors, since error in either variable attenuates the
correlation, and neither variable is ground truth: the rank is exact about the artifact and
an estimate about the language. The misses are register, in both directions. The profile
calls `volleyball`, `aeroplane`, `jewellery` and `seventy` A1 where the corpus ranks them
past 7,000, and calls `corpse`, `convict` and `trauma` C1 where subtitles put them inside
3,000. A1 words carrying one of the profile's syllabus-topic tags have median rank 1,154
against 449 for the untagged, which is that difference made countable.

The profiles are not committed, so this run is not reproducible from the repo. It predates
the spell gate, and nothing has re-measured it.

Comparing one language against another through the bands is the weaker reading. The six
agree almost everywhere, and where they disagree it is usually a word within 20% of a
threshold: en "green" at rank 909 against es 1,170 straddles the A1/A2 line at 1,000. The
rank in the tooltip is what tells that apart from a real difference, like it "parete" at
2,702.
