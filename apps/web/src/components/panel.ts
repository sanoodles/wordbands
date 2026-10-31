/**
 * The hero's two facing panels — the word you ask for, and what it means. They share
 * a frame and lead their row with a language select, so the pair reads as one
 * control: source on the left, target on the right.
 */
export const PANEL =
  "tw-rounded-x-large tw-border tw-border-line-subtle tw-bg-surface tw-px-3 tw-py-4 " +
  "min-[700px]:tw-px-6 min-[700px]:tw-py-5";

/** The hero's row: the two panels, with the swap button between them from 860px. */
export const HERO =
  "tw-mb-6 tw-grid tw-grid-cols-1 tw-gap-x-4 tw-gap-y-3 min-[700px]:tw-mb-12 min-[700px]:tw-gap-y-4 " +
  "min-[860px]:tw-grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)]";

/** Language and word share one row at every width, since a phone has no line to spare. */
export const HERO_ROW = "tw-flex tw-items-start tw-gap-2 min-[700px]:tw-gap-3";

/** Whatever the select leaves, which the field then shrinks into. */
export const SEARCH_SECTION = "tw-min-w-0 tw-grow tw-basis-0";

/**
 * Stay clear of the ≥16px that keeps iOS from zooming on focus: Fondue's body-small (~13px)
 * would trigger it. The placeholder is a separate element, sized in globals.css.
 */
export const SEARCH_FIELD = "tw-relative tw-w-fit [&_input]:tw-text-x-large";

export const SEARCH_PLACEHOLDER = "look up a word…";

/** The swap button's place between the panels, held open until it mounts. */
export const SWAP_SLOT = "tw-h-11 tw-w-11";

/**
 * The language select each panel leads with. Narrow, because it shows only the ISO
 * code (see LangSelect), and one step below the word and translation it governs (20px)
 * rather than Fondue's 14px default, which reads as a stray control.
 */
export const PANEL_LANG =
  "tw-w-20 tw-shrink-0 [&_[role=combobox]]:tw-min-h-[44px] [&_[role=combobox]]:tw-text-large";

/**
 * The heading over a section, and over each of the two language selects, whose visible
 * name is otherwise only the ISO code they hold. Quiet, so a heading on every section
 * does not compete with the words themselves.
 */
export const SECTION_HEADING = "tw-mb-1.5 tw-body-small tw-font-medium text-muted-aaa";

/** A link out of a panel as a pill, a 44px target (WCAG 2.5.5). */
export const PILL =
  "tw-inline-flex tw-min-h-[44px] tw-shrink-0 tw-items-center tw-justify-center tw-gap-1 tw-rounded-full tw-border tw-px-3 tw-py-1.5 tw-body-medium tw-no-underline";

/** The quiet pill, for a link a panel offers rather than leads with. */
export const OUT_LINK = `${PILL} tw-border-line-subtle tw-text-secondary hover:tw-border-line hover:tw-text-primary`;
