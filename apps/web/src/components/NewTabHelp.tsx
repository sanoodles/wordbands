/** The id every new-tab link on the page is described by. */
export const NEW_TAB_HELP = "new-tab-help";

/**
 * What activating a new-tab link does, said once for all of them: the etymology link
 * under the search field and the source links on the card. A description, not part of a
 * name, so it is announced on focus while the name stays what the link is for.
 * aria-hidden so browse mode does not meet it again as loose content.
 */
export default function NewTabHelp() {
  return (
    <p id={NEW_TAB_HELP} className="visually-hidden" aria-hidden="true">
      Opens in a new tab.
    </p>
  );
}
