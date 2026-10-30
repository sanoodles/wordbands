import type { TouchEvent } from "react";

/** Longer than a second touch takes to land, and shorter than a reader takes to aim at the page. */
const QUIET_MS = 500;

/**
 * Spread onto every `Select.Item`. Fondue calls the row's click handler on touchstart, before
 * a finger can become a scroll. The flag stops downshift's handler for that one event, so
 * only a real click picks. The pick closes the menu, so a lifted finger also drops clicks
 * outside the menu for a moment, or a second touch lands on what the menu covered. It is an
 * object because neither handler is on Item's typed surface. @spec SELECT-1, SELECT-2
 */
export const PICK_ON_CLICK = {
  onTouchStart: ({ nativeEvent }: TouchEvent) =>
    Object.assign(nativeEvent, { preventDownshiftDefault: true }),
  onTouchEnd: ({ currentTarget }: TouchEvent<HTMLElement>) => {
    const menu = currentTarget.closest("ul");
    const drop = (e: MouseEvent) => {
      if (menu?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", drop, true);
    setTimeout(() => document.removeEventListener("click", drop, true), QUIET_MS);
  },
} as object;
