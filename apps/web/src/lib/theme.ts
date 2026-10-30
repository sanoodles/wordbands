// The resolved colour applied to the UI…
export type Theme = "light" | "dark";
// …vs. what the user picked. "system" follows the OS via prefers-color-scheme.
export type ThemePreference = Theme | "system";

export const PREF_COOKIE = "wordbands:theme";
// Last resolved colour, cached so the HTML can paint the right theme for a "system" visitor
// on the very next request. Fondue scopes its tokens to a React-rendered div, so the HTML
// (not a pre-paint script) has to get the colour right.
export const RESOLVED_COOKIE = "wordbands:theme-resolved";

export const DEFAULT_THEME = { preference: "system", resolved: "dark" } as const;

const SEGMENTS = new Map<string, { preference: ThemePreference; resolved: Theme }>([
  ["light", { preference: "light", resolved: "light" }],
  ["dark", { preference: "dark", resolved: "dark" }],
  ["system-light", { preference: "system", resolved: "light" }],
  ["system-dark", DEFAULT_THEME],
]);

/** The theme a path segment of `next.config.mjs`'s rewrites names, if it names one. */
export const themeOf = (segment: string) => SEGMENTS.get(segment) ?? null;
