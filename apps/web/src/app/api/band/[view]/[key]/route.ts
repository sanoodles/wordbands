import { getBand, isView } from "@/lib/bands";
import { DEFAULT_SOURCE, isSourceLang } from "@/lib/languages";
import { keptAtCdn } from "@/lib/cdn";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ view: string; key: string }> },
) {
  const { view, key } = await params;
  if (!isView(view)) return new Response("unknown view", { status: 404, headers: keptAtCdn() });
  const source = new URL(req.url).searchParams.get("source") ?? DEFAULT_SOURCE;
  if (!isSourceLang(source)) return new Response("unknown language", { status: 404, headers: keptAtCdn() });
  const band = getBand(source, view, key);
  return band
    ? Response.json(band, { headers: keptAtCdn() })
    : new Response("unknown band", { status: 404, headers: keptAtCdn() });
}
