// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WordCard from "./WordCard";
import { etymologyHref, SOURCE_LANGS, type SourceLang } from "@/lib/languages";

// The workspace owns the target language now; a tiny stateful host stands in for it so
// picking a language in the card re-renders with the new value, as it does in the app.
function Host({
  word,
  source,
  target: initial,
}: {
  word: string;
  source: SourceLang;
  target: string;
}) {
  const [target, setTarget] = useState(initial);
  return (
    <WordCard
      word={word}
      forms={[word]}
      source={source}
      target={target}
      onTargetChange={setTarget}
    />
  );
}

// Translate stub: returns a per-language translation so we can assert re-translation.
const GLOSS: Record<string, string> = { es: "agua", fr: "eau" };
function mockFetch() {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/api/translate/")) {
      const tl = new URL(u, "http://localhost").searchParams.get("target") ?? "";
      return new Response(JSON.stringify({ word: "water", tl, translation: GLOSS[tl] ?? "" }));
    }
    return new Response("no", { status: 404 });
  });
}

const selector = () => screen.getByRole("combobox", { name: /target language/i });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", mockFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WordCard language selector", () => {
  it("shows the target language and skips translating a word into its own language", () => {
    render(<WordCard word="water" forms={["water"]} source="en" target="en" onTargetChange={() => {}} />);
    // Fondue's Select shows the picked language's endonym in its trigger, not a value.
    expect(selector()).toHaveTextContent("English");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("always offers a Google Translate link opening in a new tab, even for English", () => {
    render(<WordCard word="water" forms={["water"]} source="en" target="en" onTargetChange={() => {}} />);
    const link = screen.getByRole("link", { name: /google translate/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain("translate.google.com");
  });

  // A word of its own: glossCache is module-level and keyed source:target:word, so a
  // render here would otherwise answer a later test's stub from this one's response.
  it("names the translate link by what it opens, and describes the new tab", async () => {
    render(
      <WordCard
        word="Regenschirm"
        forms={["Regenschirm"]}
        source="de"
        target="en"
        onTargetChange={() => {}}
      />,
    );
    // The word is what the link is for (2.4.9); the visible text leads it, so speech
    // input still reaches the link by what it says (2.5.3).
    const link = await screen.findByRole("link", { name: "Google Translate: Regenschirm in English" });
    expect(link).toHaveTextContent(/^Google/);
    // What activating it does is a description, announced on focus, so the name stays
    // the purpose.
    const help = document.getElementById(link.getAttribute("aria-describedby") ?? "");
    expect(help).toHaveTextContent("Opens in a new tab.");
  });

  // @spec ETYM-1
  it("links the word to its etymology, in a new tab, named by the word", async () => {
    render(<WordCard word="Gletscher" forms={["Gletscher"]} source="de" target="en" onTargetChange={() => {}} />);
    const link = screen.getByRole("link", { name: "Etymology of Gletscher" });
    expect(link).toHaveTextContent(/^Etymology/);
    expect(link).toHaveAttribute("href", "https://www.dwds.de/wb/Gletscher#etymwb-1");
    expect(link).toHaveAttribute("hreflang", "de");
    expect(link).toHaveAttribute("target", "_blank");
    // The same sentence the translate link points at, said once for both.
    const translate = await screen.findByRole("link", { name: /google translate/i });
    expect(link.getAttribute("aria-describedby")).toBe(translate.getAttribute("aria-describedby"));
  });

  // @spec ETYM-1
  it("offers the etymology in every source language", () => {
    for (const source of SOURCE_LANGS) {
      render(<WordCard word="ola" forms={["ola"]} source={source} target={source} onTargetChange={() => {}} />);
      expect(screen.getByRole("link", { name: "Etymology of ola" })).toHaveAttribute(
        "href",
        etymologyHref("ola", source),
      );
      cleanup();
    }
  });

  it("translates the word into the target language", async () => {
    render(<WordCard word="water" forms={["water"]} source="en" target="es" onTargetChange={() => {}} />);
    expect(selector()).toHaveTextContent(/español/i);
    expect(await screen.findByText("agua")).toBeInTheDocument();
  });

  it("translates from a non-English source language, tagging the request with sl", async () => {
    render(<WordCard word="water" forms={["water"]} source="es" target="fr" onTargetChange={() => {}} />);
    expect(await screen.findByText("eau")).toBeInTheDocument();
    const call = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.find(([u]) =>
      String(u).includes("/api/translate/"),
    );
    expect(String(call![0])).toContain("source=es");
  });

  it("re-translates and reports the pick when the language changes", async () => {
    const onTargetChange = vi.fn();
    render(<WordCard word="water" forms={["water"]} source="en" target="es" onTargetChange={onTargetChange} />);
    await screen.findByText("agua");

    // Open the Fondue Select and pick French from the listbox.
    await userEvent.click(selector());
    await userEvent.click(await screen.findByRole("option", { name: /français/i }));

    expect(onTargetChange).toHaveBeenCalledWith("fr");
  });

  it("re-translates through a stateful host when the language changes", async () => {
    render(<Host word="water" source="en" target="es" />);
    await screen.findByText("agua");

    await userEvent.click(selector());
    await userEvent.click(await screen.findByRole("option", { name: /français/i }));

    expect(await screen.findByText("eau")).toBeInTheDocument();
  });
});

// A dt=1 fetch stub that translates each casing from a lookup table of senses.
function mockDict(senses: Record<string, string[]>) {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(String(url), "http://localhost");
    const form = decodeURIComponent(u.pathname.split("/api/translate/")[1] ?? "");
    const s = senses[form] ?? [];
    return new Response(JSON.stringify({ word: form, target: "en", translation: form, senses: s }));
  });
}

// The workspace renders this frame before the lookup lands, so the hero row is
// already its settled height and the browser below it never gets shoved down.
describe("WordCard pending", () => {
  it("holds the whole frame, translating nothing, until the forms arrive", async () => {
    const { rerender } = render(
      <WordCard word="water" forms={null} source="es" target="en" onTargetChange={() => {}} />,
    );
    expect(screen.getByRole("region", { name: /meaning of water/i })).toBeInTheDocument();
    expect(selector()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /etymology/i })).toBeInTheDocument();
    expect(screen.getByText("Translating…")).toBeInTheDocument();
    // Nothing is known to be translatable yet — the word may not even be a word.
    expect(fetch).not.toHaveBeenCalled();

    rerender(<WordCard word="water" forms={["water"]} source="es" target="en" onTargetChange={() => {}} />);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/translate/water"), expect.anything());
    // Google's name arrives with the line it trails.
    expect(await screen.findByRole("link", { name: /google translate/i })).toBeInTheDocument();
  });
});

describe("WordCard case-homographs", () => {
  it("shows a distinct translation for each casing", async () => {
    vi.stubGlobal("fetch", mockDict({ Essen: ["food", "meal"], essen: ["to eat", "dine"] }));
    render(<WordCard word="Essen" forms={["Essen", "essen"]} source="de" target="en" onTargetChange={() => {}} />);
    // Both lines and the lowercase casing label appear (the noun label doubles the hero).
    expect(await screen.findByText("food, meal")).toBeInTheDocument();
    expect(await screen.findByText("to eat, dine")).toBeInTheDocument();
    expect(screen.getByText("essen")).toBeInTheDocument();
  });

  it("collapses to one line when the casings mean the same thing", async () => {
    // "wer"/"Wer" both translate to "who" — no distinct sense, so only one line shows.
    vi.stubGlobal("fetch", mockDict({ Wer: ["who"], wer: ["who"] }));
    render(<WordCard word="Wer" forms={["Wer", "wer"]} source="de" target="en" onTargetChange={() => {}} />);
    expect(await screen.findByText("who")).toBeInTheDocument();
    expect(screen.getAllByText("who")).toHaveLength(1);
    expect(screen.queryByText("wer")).not.toBeInTheDocument();
  });
});

// A dict-mode stub returning Google's part-of-speech groups for a single-casing word.
function mockGroups(
  groups: { pos: string; terms: string[] }[],
  translation: string,
  levels: Record<string, { key: string; label: string; rank: number }> = {},
) {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(String(url), "http://localhost");
    const word = decodeURIComponent(u.pathname.split("/api/translate/")[1] ?? "");
    return new Response(
      JSON.stringify({ word, target: "en", translation, senses: [], groups, levels }),
    );
  });
}

describe("WordCard multi-sense words", () => {
  // Italian "solo": adjective "only/alone" and adverb "just" — one word, two readings.
  it("lists a line per part of speech when a word reads as more than one", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups(
        [
          { pos: "adjective", terms: ["only", "alone"] },
          { pos: "adverb", terms: ["just"] },
        ],
        "Alone",
      ),
    );
    render(<WordCard word="solo" forms={["solo"]} source="it" target="en" onTargetChange={() => {}} />);
    expect(await screen.findByText("only, alone")).toBeInTheDocument();
    expect(screen.getByText("just")).toBeInTheDocument();
    expect(screen.getByText("adjective")).toBeInTheDocument();
    expect(screen.getByText("adverb")).toBeInTheDocument();
  });

  it("keeps a single reading as one unlabelled line", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["water"] }], "water"));
    render(
      <WordCard word="acqua" forms={["acqua"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    expect(await screen.findByText("water")).toBeInTheDocument();
    expect(screen.queryByText("noun")).not.toBeInTheDocument();
  });

  it("prefers the dictionary terms over a poor plain translation", async () => {
    // Real case: "acqua" plainly translates to "waterfall", but the dictionary is right.
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["water", "aqua"] }], "waterfall"));
    render(
      <WordCard word="acquario" forms={["acquario"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    expect(await screen.findByText("water, aqua")).toBeInTheDocument();
    expect(screen.queryByText("waterfall")).not.toBeInTheDocument();
  });

  it("falls back to the plain translation when there is no dictionary entry", async () => {
    vi.stubGlobal("fetch", mockGroups([], "Milan"));
    render(
      <WordCard word="Milano" forms={["Milano"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    expect(await screen.findByText("Milan")).toBeInTheDocument();
  });

  // The spinner row is shorter than the translation it stands in for.
  it("reserves the translation's line box while translating", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["sky"] }], "sky"));
    render(
      <WordCard word="cielo" forms={["cielo"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    const spinner = screen.getByText("Translating…").closest("div.Loading");
    expect(spinner).toHaveClass("tw-min-h-[var(--typography-line-height-loose)]");
    // Not a nested live region: the card's own wrapper announces this already.
    expect(spinner).not.toHaveAttribute("role");
    expect((await screen.findByText("sky")).style.lineHeight).toBe(
      "var(--typography-line-height-loose)",
    );
  });

  it("asks for the dictionary block, which is what carries the readings", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["need"] }], "need"));
    // A word no other test looks up — `glossCache` is module-level, by design.
    render(
      <WordCard word="bisogno" forms={["bisogno"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    await screen.findByText("need");
    const call = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls[0]!;
    expect(String(call[0])).toContain("dict=1");
  });
});

// Nothing on Google's line leaves its page as the way to a translation.
describe("WordCard where Google has nothing", () => {
  const ANSWERS = {
    fails: () => new Response("upstream error", { status: 502 }),
    "answers with no translation": () =>
      Response.json({ translation: "", senses: [], groups: [], levels: {} }),
  };

  // A word per case, since `glossCache` keeps an answer that landed. A failure reads as
  // temporary, not as a word with no translation.
  it.each([
    ["fails", "Fernweh", "couldn’t translate"],
    ["answers with no translation", "Heimweh", "no translation"],
  ] as const)("says what happened and spells out Google Translate when Google %s", async (how, word, status) => {
    vi.stubGlobal("fetch", vi.fn(async () => ANSWERS[how]()));
    // Japanese, which has no Wiktionary line to stand in.
    render(<WordCard word={word} forms={[word]} source="de" target="ja" onTargetChange={() => {}} />);
    const link = await screen.findByRole("link", { name: `Google Translate: ${word} in Japanese` });
    expect(link).toHaveTextContent(/^Google Translate/);
    expect(link).toHaveAttribute("target", "_blank");
    // A control of its own, not the end of the status sentence.
    expect(screen.getByText(status)).not.toContainElement(link);
  });
});

const A1 = { key: "A1", label: "A1 · Beginner", rank: 391 };
const B2 = { key: "B2", label: "B2 · Upper-intermediate", rank: 9002 };

// Google orders the alternatives by confidence, not by difficulty, so "water" and
// "aqua" arrive as equals. The level is what tells a learner which one is theirs.

/** A line as it reads: the badges annotate it and its source's name trails it. */
function reading(line: Element | null = document.querySelector("[aria-live] span[lang]")): string {
  if (!line) throw new Error("no translation line");
  const copy = line.cloneNode(true) as Element;
  for (const aside of copy.querySelectorAll('[role="img"], a, span[lang="en"]')) aside.remove();
  return copy.textContent ?? "";
}

describe("WordCard levels", () => {
  it("trails each alternative with its own CEFR level", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["water", "aqua"] }], "water", { water: A1, aqua: B2 }),
    );
    render(<WordCard word="agua" forms={["agua"]} source="es" target="en" onTargetChange={() => {}} />);

    // The badges annotate the line; its text is still the translation itself.
    await screen.findByText("water");
    expect(reading()).toBe("water, aqua");
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("B2")).toBeInTheDocument();
  });

  // Tabbing lands on a badge on its own, where "A1 · Beginner" has no subject unless the
  // badge says which word it is for. Reading the line, the two are already adjacent.
  it("tells each badge which word it belongs to", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["water", "aqua"] }], "water", { water: A1, aqua: B2 }),
    );
    render(<WordCard word="agua" forms={["agua"]} source="es" target="en" onTargetChange={() => {}} />);
    await screen.findByText("water");

    for (const [term, band] of [["water", "A1"], ["aqua", "B2"]]) {
      const badge = screen.getByText(band!);
      const described = badge.getAttribute("aria-describedby");
      expect(described).toBeTruthy();
      expect(document.getElementById(described!)).toHaveTextContent(term!);
    }
  });

  it("names the badge with its band and rank, for hover and for AT alike", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["sea"] }], "sea", { sea: A1 }));
    render(<WordCard word="mare" forms={["mare"]} source="it" target="en" onTargetChange={() => {}} />);
    await screen.findByText("sea");
    expect(screen.getByRole("img", { name: "A1 · Beginner · rank 391" })).toBeInTheDocument();
  });

  // Only the six indexed languages have levels; the server sends none for the rest.
  it("leaves the line unbadged when the language has no levels", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["mizu"] }], "mizu"));
    render(<WordCard word="acqua" forms={["acqua"]} source="it" target="ja" onTargetChange={() => {}} />);
    await screen.findByText("mizu");
    expect(screen.queryByText("A1")).not.toBeInTheDocument();
  });

  it("badges only the terms the target language actually carries", async () => {
    vi.stubGlobal(
      "fetch",
      // "usar naja" is a phrase, so it has no rank to show.
      mockGroups([{ pos: "noun", terms: ["knife", "usar naja"] }], "knife", { knife: A1 }),
    );
    render(<WordCard word="faca" forms={["faca"]} source="pt" target="en" onTargetChange={() => {}} />);
    await screen.findByText("knife");
    expect(reading()).toBe("knife, usar naja");
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("levels each casing's translation of a case-homograph", async () => {
    vi.stubGlobal("fetch", (async (url: string | URL) => {
      const u = new URL(String(url), "http://localhost");
      const form = decodeURIComponent(u.pathname.split("/api/translate/")[1] ?? "");
      const senses = form === "Essen" ? ["food"] : ["dine"];
      const levels = form === "Essen" ? { food: A1 } : { dine: B2 };
      return new Response(JSON.stringify({ word: form, target: "en", translation: form, senses, levels }));
    }) as typeof fetch);
    render(<WordCard word="Essen" forms={["Essen", "essen"]} source="de" target="en" onTargetChange={() => {}} />);

    expect(await screen.findByText("food")).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("B2")).toBeInTheDocument();
  });
});

// A level is the target language's own list vouching for the term, so a badged term is a
// word that language has — which is exactly the condition for going and studying it.
describe("WordCard picking a translation", () => {
  it("offers each alternative the target language carries as a way into it", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["lake", "loch"] }], "lake", { lake: A1, loch: B2 }),
    );
    const picked: string[] = [];
    render(
      <WordCard
        word="lago"
        forms={["lago"]}
        source="it"
        target="en"
        onTargetChange={() => {}}
        onPickTerm={(t) => picked.push(t)}
      />,
    );
    await userEvent.setup().click(await screen.findByRole("button", { name: "loch" }));
    expect(picked).toEqual(["loch"]);
  });

  // A phrase has no rank, so it has no entry to land on either.
  it("leaves a term the language does not carry as plain text", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["blade", "usar faca"] }], "blade", { blade: A1 }),
    );
    render(
      <WordCard
        word="lâmina"
        forms={["lâmina"]}
        source="pt"
        target="en"
        onTargetChange={() => {}}
        onPickTerm={() => {}}
      />,
    );
    await screen.findByRole("button", { name: "blade" });
    expect(screen.queryByRole("button", { name: "usar faca" })).not.toBeInTheDocument();
    expect(reading()).toBe("blade, usar faca");
  });

  // The word is the name; what clicking does is a description, announced on focus alone.
  // A name saying it would replace the word, and the line would stop reading as the
  // translation it is.
  it("names the button with the word and describes it with what a pick does", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["book"] }], "book", { book: A1 }));
    render(
      <WordCard
        word="libro"
        forms={["libro"]}
        source="it"
        target="en"
        onTargetChange={() => {}}
        onPickTerm={() => {}}
      />,
    );
    const button = await screen.findByRole("button", { name: "book" });
    const described = button.getAttribute("aria-describedby");
    expect(document.getElementById(described!)).toHaveTextContent(
      "Look this word up in English, swapping the two languages.",
    );
    expect(reading()).toBe("book");
  });

  // The pick turns the pair over at once and the word lands with the lookup a tick later,
  // which is the order the workspace does it in — and the order that matters, since the
  // button is gone before the new word arrives.
  function PickHost() {
    const [pair, setPair] = useState<{ source: SourceLang; target: string }>({ source: "it", target: "en" });
    const [word, setWord] = useState("lago");
    return (
      <WordCard
        word={word}
        forms={[word]}
        source={pair.source}
        target={pair.target}
        onTargetChange={() => {}}
        onPickTerm={(t) => {
          setPair({ source: "en", target: "it" });
          setTimeout(() => setWord(t), 0);
        }}
      />
    );
  }

  it("takes focus to the card when the pick removes the button holding it", async () => {
    vi.stubGlobal(
      "fetch",
      mockGroups([{ pos: "noun", terms: ["lake", "loch"] }], "lake", { lake: A1, loch: B2 }),
    );
    render(<PickHost />);
    const button = await screen.findByRole("button", { name: "loch" });
    button.focus();
    await userEvent.setup().click(button);
    // Named for the word picked, not the one left behind.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Meaning of loch" })).toHaveFocus(),
    );
    // A landing place only: nothing puts the card in the tab order.
    expect(screen.getByRole("region", { name: "Meaning of loch" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  // At 320px a long German word fills the search field and the badge there is hidden,
  // which in Frequency and Defining view left the level showing nowhere (WCAG 1.4.10).
  // The workspace hands it here instead, and only then.
  it("shows the word's own level beside the heading when the field cannot", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["speed"] }], "speed", {}));
    render(
      <WordCard
        word="Geschwindigkeit"
        level={B2}
        forms={["Geschwindigkeit"]}
        source="de"
        target="en"
        onTargetChange={() => {}}
      />,
    );
    const badge = await screen.findByRole("img", { name: B2.label + " · rank 9,002" });
    // Beside the heading, not inside it: the heading alone is the card's name.
    expect(screen.getByRole("region", { name: "Meaning of Geschwindigkeit" })).toBeInTheDocument();
    // And it says which word the level is for.
    const described = badge.getAttribute("aria-describedby");
    expect(document.getElementById(described!)).toHaveTextContent("Geschwindigkeit");
  });

  it("keeps the heading bare where the field shows the level itself", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["water"] }], "water", {}));
    render(
      <WordCard word="Wasser" forms={["Wasser"]} source="de" target="en" onTargetChange={() => {}} />,
    );
    await screen.findByText("water");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("offers nothing to click where the workspace passes no way to pick", async () => {
    vi.stubGlobal("fetch", mockGroups([{ pos: "noun", terms: ["river"] }], "river", { river: A1 }));
    render(
      <WordCard word="fiume" forms={["fiume"]} source="it" target="en" onTargetChange={() => {}} />,
    );
    await screen.findByText("river");
    expect(screen.queryByRole("button", { name: "river" })).not.toBeInTheDocument();
    // Still the badge's subject, so tabbing to the level still says which word it is for.
    const described = screen.getByText("A1").getAttribute("aria-describedby");
    expect(document.getElementById(described!)).toHaveTextContent("river");
  });
});

type Google = { groups: { pos: string; terms: string[] }[]; translation: string };
type Wiktionary = { terms: string[]; title: string | null };

/** Both sources' routes. A null Google answers the way the route does when Google fails. */
function mockSources(google: Google | null, wiktionary: Wiktionary, held?: Promise<void>) {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(String(url), "http://localhost");
    if (u.pathname.startsWith("/api/wiktionary/")) {
      await held;
      return Response.json({ levels: {}, ...wiktionary });
    }
    if (u.pathname.startsWith("/api/translate/"))
      return google
        ? Response.json({ senses: [], levels: {}, ...google })
        : new Response("upstream error", { status: 502 });
    return new Response("no", { status: 404 });
  });
}

const NAP = { pos: "noun", terms: ["Nickerchen", "Schläfchen", "Flor", "Strich"] };

/** Every URL the card fetched, in order. */
const urls = () => (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([u]) => String(u));

/** Google's link, where another line translates: its source's name alone, after that line. */
function quietAfter(line: HTMLElement) {
  const google = screen.getByRole("link", { name: /google translate/i });
  expect(google).toHaveTextContent(/^Google ↗$/);
  expect(line.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/** Every source's line, in the order they show. */
const sourceLines = (target: string) => [...document.querySelectorAll(`[aria-live] span[lang="${target}"]`)];

describe("WordCard Wiktionary's line", () => {
  // @spec WIKT-1, WIKT-2
  it("shows Wiktionary's terms on a line beneath Google's, each trailed by its source", async () => {
    vi.stubGlobal(
      "fetch",
      mockSources(
        { groups: [NAP], translation: "Schnapp" },
        { terms: ["Nickerchen", "Mittagsschlaf", "Siesta"], title: "siesta" },
      ),
    );
    render(<WordCard word="siesta" forms={["siesta"]} source="es" target="de" onTargetChange={() => {}} />);

    const wiktionary = await screen.findByRole("link", { name: "Wiktionary entry for siesta" });
    expect(wiktionary).toHaveTextContent(/^Wiktionary/);
    expect(wiktionary).toHaveAttribute("href", "https://es.wiktionary.org/wiki/siesta");
    expect(wiktionary).toHaveAttribute("hreflang", "es");
    expect(wiktionary).toHaveAttribute("target", "_blank");
    const google = screen.getByRole("link", { name: "Google Translate: siesta in German" });
    expect(google.getAttribute("href")).toContain("translate.google.com");

    const [first, second, ...rest] = sourceLines("de");
    expect(rest).toHaveLength(0);
    expect(first).toContainElement(google);
    expect(reading(first!)).toBe("Nickerchen, Schläfchen, Flor, Strich");
    expect(second).toContainElement(wiktionary);
    expect(reading(second!)).toBe("Nickerchen, Mittagsschlaf, Siesta");
    // One sentence says what every new-tab link does.
    expect(wiktionary.getAttribute("aria-describedby")).toBe(google.getAttribute("aria-describedby"));
  });

  // @spec WIKT-3
  it("leaves Wiktionary's line out when Google's already holds every term on it", async () => {
    vi.stubGlobal(
      "fetch",
      mockSources({ groups: [{ pos: "noun", terms: ["Wasser"] }], translation: "Wasser" }, { terms: ["wasser"], title: "agua" }),
    );
    render(<WordCard word="agua" forms={["agua"]} source="es" target="de" onTargetChange={() => {}} />);
    await screen.findByRole("link", { name: /google translate/i });
    expect(sourceLines("de")).toHaveLength(1);
    expect(screen.queryByText("Wiktionary")).not.toBeInTheDocument();
  });

  // @spec WIKT-5, WIKT-1
  it("still shows Wiktionary's line when Google fails, and leads with it", async () => {
    vi.stubGlobal("fetch", mockSources(null, { terms: ["Alien", "Außerirdischer"], title: "alienígena" }));
    render(<WordCard word="alienígena" forms={["alienígena"]} source="es" target="de" onTargetChange={() => {}} />);
    const wiktionary = await screen.findByRole("link", { name: "Wiktionary entry for alienígena" });
    expect(reading(sourceLines("de")[0]!)).toBe("Alien, Außerirdischer");
    // Google's line says its lookup failed, after the meaning, and still leads to its page.
    expect(screen.getByText("couldn’t translate")).toBeInTheDocument();
    quietAfter(wiktionary);
  });

  // @spec WIKT-1
  it("asks Wiktionary only for the pairs it is built for, even when Google fails", async () => {
    vi.stubGlobal("fetch", mockSources(null, { terms: ["x"], title: "x" }));
    render(<WordCard word="Schirm" forms={["Schirm"]} source="de" target="ja" onTargetChange={() => {}} />);
    await screen.findByText("couldn’t translate");
    expect(urls().some((u) => u.includes("/api/wiktionary/"))).toBe(false);
  });

  it("names Wiktionary without a link where its edition has no page for the word", async () => {
    vi.stubGlobal(
      "fetch",
      mockSources({ groups: [{ pos: "noun", terms: ["Hölle"] }], translation: "Hölle" }, { terms: ["Unterwelt"], title: null }),
    );
    render(<WordCard word="averno" forms={["averno"]} source="es" target="de" onTargetChange={() => {}} />);
    expect(await screen.findByText("Wiktionary")).not.toHaveAttribute("href");
    expect(screen.queryByRole("link", { name: /wiktionary/i })).not.toBeInTheDocument();
  });

  // Each landing would otherwise change the card's height, and the page below it with it.
  it("lands both lines together", async () => {
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      "fetch",
      mockSources({ groups: [NAP], translation: "Schnapp" }, { terms: ["Mittagsruhe"], title: "sesteo" }, held),
    );
    render(<WordCard word="sesteo" forms={["sesteo"]} source="es" target="de" onTargetChange={() => {}} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Translating…")).toBeInTheDocument();
    expect(screen.queryByText(/Nickerchen/)).not.toBeInTheDocument();
    release();
    expect(await screen.findByRole("link", { name: "Wiktionary entry for sesteo" })).toBeInTheDocument();
    expect(sourceLines("de")).toHaveLength(2);
  });
});

// Google's dictionary for a pair with English is direct, so Wiktionary's line stands in only
// where Google's has nothing.
describe("WordCard Wiktionary standing in for Google", () => {
  // @spec WIKT-6
  it("asks nothing of Wiktionary for a pair with English while Google answers", async () => {
    vi.stubGlobal(
      "fetch",
      mockSources({ groups: [{ pos: "noun", terms: ["parasol"] }], translation: "parasol" }, { terms: ["x"], title: "x" }),
    );
    // A word of its own: `glossCache` keeps whatever another test's stub answered for it.
    render(<WordCard word="Sonnenschirm" forms={["Sonnenschirm"]} source="de" target="en" onTargetChange={() => {}} />);
    await screen.findByText("parasol");
    expect(urls().some((u) => u.includes("/api/wiktionary/"))).toBe(false);
  });

  // @spec WIKT-6, WIKT-2
  it.each([
    ["de", "en", "Regenbogen", ["rainbow"]],
    ["en", "es", "rainbow", ["arcoíris", "arco iris"]],
  ] as const)("stands its line in for %s into %s when Google fails", async (source, target, word, terms) => {
    vi.stubGlobal("fetch", mockSources(null, { terms: [...terms], title: word }));
    render(<WordCard word={word} forms={[word]} source={source} target={target} onTargetChange={() => {}} />);
    const wiktionary = await screen.findByRole("link", { name: `Wiktionary entry for ${word}` });
    expect(wiktionary).toHaveAttribute("href", `https://${source}.wiktionary.org/wiki/${encodeURIComponent(word)}`);
    expect(reading(sourceLines(target)[0]!)).toBe(terms.join(", "));
    // Google's line still says what happened, after the meaning, and leads to its page.
    expect(screen.getByText("couldn’t translate")).toBeInTheDocument();
    quietAfter(wiktionary);
    // Asked only once Google's line had come back with nothing.
    const asked = urls();
    expect(asked.findIndex((u) => u.includes("/api/wiktionary/"))).toBeGreaterThan(
      asked.findIndex((u) => u.includes("/api/translate/")),
    );
  });

  // @spec WIKT-6
  it("stands in where Google answers with nothing, too", async () => {
    vi.stubGlobal("fetch", mockSources({ groups: [], translation: "" }, { terms: ["windbreak"], title: "Windschutz" }));
    render(<WordCard word="Windschutz" forms={["Windschutz"]} source="de" target="en" onTargetChange={() => {}} />);
    expect(await screen.findByRole("link", { name: "Wiktionary entry for Windschutz" })).toBeInTheDocument();
    expect(screen.getByText("no translation")).toBeInTheDocument();
  });

  // Each landing would otherwise change the card's height, and the page below it with it.
  it("keeps translating until Wiktionary's line lands, then lands both lines together", async () => {
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", mockSources(null, { terms: ["staircase"], title: "Treppenhaus" }, held));
    render(<WordCard word="Treppenhaus" forms={["Treppenhaus"]} source="de" target="en" onTargetChange={() => {}} />);
    await waitFor(() => expect(urls().some((u) => u.includes("/api/wiktionary/"))).toBe(true));
    expect(screen.getByText("Translating…")).toBeInTheDocument();
    expect(screen.queryByText("couldn’t translate")).not.toBeInTheDocument();
    release();
    expect(await screen.findByRole("link", { name: "Wiktionary entry for Treppenhaus" })).toBeInTheDocument();
    expect(screen.getByText("couldn’t translate")).toBeInTheDocument();
  });
});
