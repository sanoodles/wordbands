// The response headers are config, not code, so nothing else fails when they go missing.
// NODE_ENV is "test" under vitest, which means these assertions see the production
// policy — the strict one, without the eval and websocket that dev needs for HMR.

import { describe, expect, it } from "vitest";
import { PREF_COOKIE, RESOLVED_COOKIE, themeOf } from "@/lib/theme";
import nextConfig from "../../next.config.mjs";

async function sentHeaders(source = "/:path*"): Promise<Record<string, string>> {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === source);
  expect(rule).toBeDefined();
  return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
}

const directives = (csp: string) =>
  new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...sources] = d.split(/\s+/);
        return [name!, sources] as const;
      }),
  );

describe("response headers", () => {
  // @spec HEAD-1
  it("sends the set on every path", async () => {
    const headers = await sentHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy"]).toBeTruthy();
  });

  // @spec HEAD-5
  it("does not name the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  // @spec HEAD-7
  it("lets the browser keep the manifest and the icon for a day", async () => {
    for (const path of ["/manifest.webmanifest", "/icon.svg"]) {
      expect((await sentHeaders(path))["Cache-Control"]).toBe("public, max-age=86400");
    }
  });

  // Only those two: the page and the API must never be kept by the browser across a deploy.
  it("lets the browser keep nothing else", async () => {
    const rules = await nextConfig.headers!();
    const keeping = rules.filter((r) => r.headers.some((h) => h.key === "Cache-Control"));
    expect(keeping.map((r) => r.source).sort()).toEqual(["/icon.svg", "/manifest.webmanifest"]);
  });
});

/** Where Vercel's router sends a request for `/`, by the rules in `next.config.mjs`. */
async function homePath(cookies: Record<string, string>, country?: string) {
  const rules = (await nextConfig.rewrites!()) as {
    has?: { type: string; key: string; value?: string }[];
    destination: string;
  }[];
  for (const rule of rules) {
    const groups: Record<string, string> = {};
    const matches = (rule.has ?? []).every(({ type, key, value }) => {
      const read = type === "cookie" ? cookies[key] : key === "x-vercel-ip-country" ? country : undefined;
      const match = read === undefined ? null : new RegExp(`^${value}$`).exec(read);
      Object.assign(groups, match?.groups);
      return match !== null;
    });
    if (matches) return rule.destination.replace(/:(\w+)/g, (_, name: string) => groups[name]!);
  }
  throw new Error("no rule matched");
}

describe("the page at the CDN", () => {
  // @spec HEAD-8
  it("may be kept by Vercel's CDN and not by the browser", async () => {
    const headers = await sentHeaders("/");
    expect(headers["Vercel-CDN-Cache-Control"]).toBe("max-age=31536000");
    expect(headers["Cache-Control"]).toBeUndefined();
  });

  // Vercel's CDN keeps nothing that varies on Cookie, and Next's own Vary could replace ours.
  // @spec HEAD-8
  it("varies on nothing of ours", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.flatMap((r) => r.headers).some((h) => h.key.toLowerCase() === "vary")).toBe(false);
  });

  // @spec HEAD-9
  it("gives each theme and each country a path of its own", async () => {
    const paths = new Set<string>();
    for (const cookies of [
      {},
      { [PREF_COOKIE]: "light" },
      { [PREF_COOKIE]: "dark" },
      { [RESOLVED_COOKIE]: "light" },
    ])
      for (const country of ["DE", "ES", undefined]) paths.add(await homePath(cookies, country));
    expect(paths.size).toBe(12);
  });

  it("keeps a country it cannot read out of the path", async () => {
    expect(await homePath({}, "not a country")).toBe("/home/system-dark/none");
  });

  // @spec LOAD-3
  it.each([
    [{}, { preference: "system", resolved: "dark" }],
    [{ [RESOLVED_COOKIE]: "light" }, { preference: "system", resolved: "light" }],
    [{ [RESOLVED_COOKIE]: "dark" }, { preference: "system", resolved: "dark" }],
    [{ [PREF_COOKIE]: "system", [RESOLVED_COOKIE]: "light" }, { preference: "system", resolved: "light" }],
    [{ [PREF_COOKIE]: "light", [RESOLVED_COOKIE]: "dark" }, { preference: "light", resolved: "light" }],
    [{ [PREF_COOKIE]: "dark", [RESOLVED_COOKIE]: "light" }, { preference: "dark", resolved: "dark" }],
    [{ [PREF_COOKIE]: "junk" }, { preference: "system", resolved: "dark" }],
  ])("renders the theme the cookies %j name", async (cookies, theme) => {
    const [, , segment] = (await homePath(cookies, "DE")).split("/");
    expect(themeOf(segment!)).toEqual(theme);
  });
});

describe("the content security policy", () => {
  /**
   * The whole policy rests on the page loading nothing off-origin. This is the assertion
   * that notices when that stops being true: a webfont stylesheet, a CDN script or an
   * outbound beacon has to name a host, and a host is not one of these.
   * @spec HEAD-2
   */
  it("names no host anywhere", async () => {
    const csp = (await sentHeaders())["Content-Security-Policy"]!;
    const allowed = new Set(["'self'", "'none'", "'unsafe-inline'", "data:"]);
    for (const [name, sources] of directives(csp)) {
      for (const source of sources) {
        expect(allowed.has(source), `${name} names ${source}`).toBe(true);
      }
    }
  });

  // @spec HEAD-3
  it("closes the directives an unlisted one would fall back to", async () => {
    const d = directives((await sentHeaders())["Content-Security-Policy"]!);
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
  });

  // Dev adds these for HMR; production must not carry them.
  // @spec HEAD-4
  it("keeps eval and the websocket out of production", async () => {
    const csp = (await sentHeaders())["Content-Security-Policy"]!;
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
  });
});
