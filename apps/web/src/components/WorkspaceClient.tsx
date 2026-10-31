"use client";

import { useRef, useSyncExternalStore, type RefObject } from "react";
import { TextInput } from "@frontify/fondue/components";
import {
  HERO,
  HERO_ROW,
  PANEL,
  PANEL_LANG,
  SEARCH_FIELD,
  SEARCH_PLACEHOLDER,
  SEARCH_SECTION,
  SECTION_HEADING,
  SWAP_SLOT,
} from "@/components/panel";
import Workspace from "@/components/Workspace";

const nothingToWatch = () => () => {};

/**
 * What the server sends: the hero of the Workspace, laid out the same with the same heights, so
 * the search field is in the first paint and nothing moves when the Workspace replaces it. It
 * works with no script: Enter loads the word through the URL. @spec LOAD-4
 */
function ServerField({ form, word }: { form: RefObject<HTMLFormElement | null>; word: string }) {
  return (
    <div className={`${HERO} tw-min-h-[560px] tw-content-start`}>
      <div className={PANEL}>
        <div className={HERO_ROW}>
          <section aria-labelledby="lang-heading">
            <h2 id="lang-heading" className={SECTION_HEADING}>
              Language
            </h2>
            <div className={`${PANEL_LANG} tw-h-11`} />
          </section>
          <section aria-labelledby="search-heading" className={SEARCH_SECTION}>
            <h2 id="search-heading" className={SECTION_HEADING}>
              Look up a word
            </h2>
            <form ref={form} action="/" className="tw-flex" role="search">
              <div className={SEARCH_FIELD}>
                <TextInput.Root
                  // Forwarded to the <input> at runtime, and absent from Fondue's types.
                  {...({ name: "word", defaultValue: word, size: 40 } as object)}
                  aria-labelledby="search-heading"
                  autoComplete="off"
                  placeholder={SEARCH_PLACEHOLDER}
                  spellCheck={false}
                />
              </div>
            </form>
            <div className="tw-mt-3 tw-h-11" />
          </section>
        </div>
      </div>
      <div className={SWAP_SLOT} />
      <div className={`${PANEL} tw-min-h-[100px]`} />
    </div>
  );
}

// The Workspace reads the browser's storage and language, so the server cannot render it, and
// the first client render swaps it in. It is a static import, because next/dynamic with
// ssr:false leaves the chunk out of the HTML, and the browser would ask for it only after
// hydration.
export default function WorkspaceClient({ country, word }: { country: string | null; word: string }) {
  const form = useRef<HTMLFormElement>(null);
  const inBrowser = useSyncExternalStore(
    nothingToWatch,
    () => true,
    () => false,
  );
  if (!inBrowser) return <ServerField form={form} word={word} />;
  const value = form.current?.querySelector("input")?.value ?? word;
  return <Workspace country={country} typedBefore={value === word ? null : value} />;
}
