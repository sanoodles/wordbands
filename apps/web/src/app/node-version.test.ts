// Vercel reads no version file, so the Node major it builds and runs on is repeated in this
// package's `engines`. CI reads .node-version itself. Apart, the two would test one Node
// and ship another, and nothing else would notice.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Node version", () => {
  it("is the major .node-version names, for Vercel as for CI", () => {
    const pinned = read("../../../../.node-version").trim();
    const { engines } = JSON.parse(read("../../package.json"));
    expect(engines.node).toBe(`${pinned}.x`);
  });
});
