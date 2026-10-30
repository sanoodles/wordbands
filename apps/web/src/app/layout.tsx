// Install server-side DOM stand-ins before any Fondue module is evaluated.
import "@/ssr-dom-globals";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
// Fondue base tokens first (the `:root` design-token variables), then the compiled
// component styles, then our Tailwind layer so `tw-` utilities can win where needed.
import "@frontify/fondue/tokens/base";
import "./fondue.css";
import "./globals.css";
import Providers, {
  PREF_COOKIE,
  RESOLVED_COOKIE,
  type Theme,
  type ThemePreference,
} from "./providers";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

// `metadataBase` is what lets the relative urls below resolve; without it Next drops
// og:url and warns. A deeplink's word rides in from `page.tsx`, which restates the
// Open Graph fields it needs — nested metadata is replaced by a child, not merged.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en",
  },
  twitter: { card: "summary", title: SITE_NAME, description: SITE_DESCRIPTION },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Server-render the stored theme so the class is on <html> before first paint —
  // no flash, and SSR/client agree (they read the same cookies). A "system" preference
  // can't be resolved on the server (prefers-color-scheme is client-only), so we paint
  // the last resolved colour we cached; a mount effect corrects it if the OS changed.
  const cookieStore = await cookies();
  const stored = cookieStore.get(PREF_COOKIE)?.value;
  const preference: ThemePreference =
    stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  const resolved: Theme =
    preference === "system"
      ? cookieStore.get(RESOLVED_COOKIE)?.value === "light"
        ? "light"
        : "dark"
      : preference;
  return (
    <html lang="en" className={`RootLayout ${resolved}`} data-theme={resolved}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Providers initialPreference={preference} initialResolved={resolved}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
