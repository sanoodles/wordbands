import type { TouchEvent } from "react";

/**
 * Spread onto every `Select.Item`. Fondue calls the row's click handler on touchstart, before
 * a finger can become a scroll. The flag stops downshift's handler for that one event, so
 * only a real click picks. It is an object because `onTouchStart` is not on Item's typed
 * surface. @spec SELECT-1
 */
export const PICK_ON_CLICK = {
  onTouchStart: ({ nativeEvent }: TouchEvent) =>
    Object.assign(nativeEvent, { preventDownshiftDefault: true }),
} as object;
