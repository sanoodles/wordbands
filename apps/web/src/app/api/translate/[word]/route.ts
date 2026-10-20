import { levelsOf } from "@/lib/bands";
import { keptAtCdn } from "@/lib/cdn";
import { isSourceLang } from "@/lib/languages";
import {
  alignGroup,
  baseLang,
  flattenSenses,
  gtxUrl,
  isLangCode,
  isSingleWord,
  needsPivot,
  parseGtx,
  parseSenseGroups,
  pivotTerm,
  type SenseGroup,
} from "@/lib/translate";

// How long Google's answer may be reused. Vercel may drop it sooner, and nothing relies on it.
export const revalidate = 15552000; // 180 days; a literal, since Next cannot evaluate arithmetic here

/** Google answered with something other than a translation. */
class UpstreamError extends Error {}

// Never the query, which holds the word.
function answered(res: Response): string {
  const at = res.url ? new URL(res.url) : null;
  const type = res.headers.get("content-type") ?? "no content type";
  return `${res.status} ${type}${at ? ` from ${at.host}${at.pathname}` : ""}`;
}

async function gtx(
  word: string,
  source: string,
  target: string,
  dict: boolean,
): Promise<unknown> {
  const res = await fetch(gtxUrl(word, source, target, dict), { next: { revalidate } });
  if (!res.ok) throw new UpstreamError(answered(res));
  try {
    return await res.json();
  } catch {
    // A refusal can arrive as a 200: an HTML page at the end of a redirect.
    throw new UpstreamError(answered(res));
  }
}

// Name and code only: a message could carry our internals into the response.
function failure(err: unknown): string {
  if (err instanceof UpstreamError) return err.message;
  const name = err instanceof Error ? err.name : "unknown error";
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" ? `${name} ${code}` : name;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ word: string }> },
) {
  const { word } = await params;
  const q = new URL(req.url).searchParams;
  const source = baseLang(q.get("source"));
  const target = baseLang(q.get("target"));
  // Unlike the other routes, this one answers by calling Google rather than by reading our
  // own data, so it forwards only what the card asks it for: one word, between two language
  // codes. Anything else is refused here instead of being relayed upstream on our quota.
  // @spec GATE-1, GATE-3, GATE-4, GATE-5
  if (!isSingleWord(word)) return new Response("not a word", { status: 400 });
  if (!isSourceLang(source) || !isLangCode(target)) {
    return new Response("unknown language", { status: 400 });
  }
  // `dict` mode translates one casing of a case-homograph: casing is significant, so keep
  // it; otherwise lowercase for a stable, lowercase result and better cache hits.
  const dict = q.get("dict") === "1";
  // @spec GATE-7
  const text = dict ? word : word.toLowerCase();

  try {
    // The English hop is worth starting up front: a pair Google has no dictionary for
    // always ends up needing it, and this keeps the pivot to one extra round trip.
    const pivoting = dict && needsPivot(source, target);
    const [data, viaEn] = await Promise.all([
      gtx(text, source, target, dict),
      pivoting ? gtx(text, source, "en", true) : null,
    ]);

    let groups: SenseGroup[] = dict ? parseSenseGroups(data) : [];
    if (!groups.length && viaEn) {
      const pivot = pivotTerm(viaEn);
      if (pivot) {
        groups = alignGroup(parseSenseGroups(await gtx(pivot.term, "en", target, true)), pivot.pos);
      }
    }

    const translation = parseGtx(data);
    return Response.json(
      {
        word: text,
        source,
        target,
        translation,
        senses: flattenSenses(groups),
        // Per-part-of-speech readings, so the card can show a word's distinct meanings.
        groups,
        // @spec BAND-9
        levels: levelsOf(target, [...groups.flatMap((g) => g.terms), translation]),
      },
      // Only an answer: a 502 is asked again. @spec HEAD-6
      { headers: keptAtCdn(revalidate) },
    );
  } catch (err) {
    // The 502 says it too: Hobby keeps an hour of logs, and refusals come in spells.
    // @spec GATE-6, GATE-8
    const why = failure(err);
    console.error(`[translate] ${source}->${target} ${why}`);
    return new Response(`upstream error: ${why}`, { status: 502 });
  }
}
