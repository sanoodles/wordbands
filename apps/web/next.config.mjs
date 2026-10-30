const dev = process.env.NODE_ENV === "development";

// Everything the page loads is same-origin — no CDN, no webfont host, no analytics — so
// the policy can name 'self' and stop. `unsafe-inline` stays for scripts because Next
// streams the RSC payload through inline <script> tags; nonces would need middleware,
// which is a bigger surface than the one this buys. Dev additionally evals (HMR) and
// opens a websocket back.
// @spec HEAD-2, HEAD-3, HEAD-4
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// @spec HEAD-1
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // frame-ancestors covers this for anything current; kept for browsers that don't read it.
  { key: "X-Frame-Options", value: "DENY" },
  // The page asks for none of these, so nothing it loads should be able to either.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

// The browser asks for both on every visit, and each ask is a CDN request. @spec HEAD-7
const KEPT_A_DAY = [{ key: "Cache-Control", value: "public, max-age=86400" }];

// Vercel's CDN keeps nothing that varies on a cookie, so its router reads the theme cookies
// and the country before any function runs, and writes them into the path the CDN keys on.
// Each pair is one rule for a visitor with a country and one for a visitor without.
// @spec HEAD-9
const PREF_COOKIE = "wordbands:theme";
const RESOLVED_COOKIE = "wordbands:theme-resolved";
const COUNTRY = { type: "header", key: "x-vercel-ip-country", value: "(?<country>[A-Z0-9]{2})" };
const home = (theme, ...cookie) => [
  { source: "/", has: [...cookie, COUNTRY], destination: `/home/${theme}/:country` },
  { source: "/", ...(cookie.length > 0 && { has: cookie }), destination: `/home/${theme}/none` },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next dev` and `next build` both default to `.next`; building into it while a
  // dev server is live corrupts the server. `build:check` overrides this so a
  // verification build lands in a separate dir and can't clobber dev.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // bands.ts imports each data/wordbands.<code>.json directly, so the tracer bundles it
  // automatically — no outputFileTracingIncludes needed.
  // @spec HEAD-5
  poweredByHeader: false,
  // The agent instructions live in the root CLAUDE.md, not in files `next dev` writes here.
  agentRules: false,
  // fondue-icons does not declare itself free of side effects, so Fondue's imports from its
  // barrel would otherwise keep all 407 icons in the page's JS.
  // inlineCss puts the stylesheets in the HTML, so a first visit paints without a round trip.
  experimental: { optimizePackageImports: ["@frontify/fondue-icons"], inlineCss: true },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/manifest.webmanifest", headers: KEPT_A_DAY },
      { source: "/icon.svg", headers: KEPT_A_DAY },
      // A deploy empties it. The browser never receives the header. @spec HEAD-8
      { source: "/", headers: [{ key: "Vercel-CDN-Cache-Control", value: "max-age=31536000" }] },
    ];
  },
  async rewrites() {
    return [
      ...home("light", { type: "cookie", key: PREF_COOKIE, value: "light" }),
      ...home("dark", { type: "cookie", key: PREF_COOKIE, value: "dark" }),
      ...home("system-light", { type: "cookie", key: RESOLVED_COOKIE, value: "light" }),
      ...home("system-dark"),
    ];
  },
};

export default nextConfig;
