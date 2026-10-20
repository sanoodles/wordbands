import { getSuggestions } from "@/lib/bands";
import { DEFAULT_SOURCE, isSourceLang } from "@/lib/languages";
import { keptAtCdn } from "@/lib/cdn";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

/**
 * How many suggestions to return. Clamped, because the count is only ever a dropdown's
 * worth: unbounded, one lookup hands back the query's whole prefix bucket instead.
 * @spec ROUTE-11
 */
function limitOf(raw: string | null): number {
  const n = Number(raw || DEFAULT_LIMIT);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q") ?? "";
  const source = params.get("source") ?? DEFAULT_SOURCE;
  if (!isSourceLang(source)) return new Response("unknown language", { status: 404, headers: keptAtCdn() });
  return Response.json(getSuggestions(source, q, limitOf(params.get("limit"))), {
    headers: keptAtCdn(),
  });
}
