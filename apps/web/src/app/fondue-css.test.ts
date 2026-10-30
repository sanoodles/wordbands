import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFondueCss, OUTPUT } from "../../scripts/build-fondue-css";

describe("fondue.css", () => {
  // Fails on a Fondue upgrade and on a newly imported component, whose styles would be missing.
  it("is what the installed Fondue and the app's imports produce", () => {
    const stale = "Stale. Run `pnpm --filter @wordbands/web build:fondue-css`.";
    expect(readFileSync(OUTPUT, "utf8") === buildFondueCss(), stale).toBe(true);
  });
});
