// A year is the longest Vercel's CDN keeps anything; a deploy empties it sooner.
const A_YEAR = 31536000;

/**
 * Lets Vercel's CDN answer a repeat of the same URL without running the route. Its cache key
 * includes the deployment, and the browser never receives the header.
 * @spec HEAD-6
 */
export function keptAtCdn(seconds = A_YEAR): Record<string, string> {
  return { "Vercel-CDN-Cache-Control": `max-age=${seconds}` };
}
