import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

/**
 * A gzipped JSON Lines file's lines, split on "\n" alone. node:readline also ends a line at
 * U+2028 and U+2029, which JSON allows unescaped inside a string, and the German Wiktionary
 * extract has some, so readline hands JSON.parse half a record.
 */
export async function* jsonLines(file: string): AsyncGenerator<string> {
  let rest = "";
  for await (const chunk of createReadStream(file).pipe(createGunzip()).setEncoding("utf8")) {
    const parts = (rest + (chunk as string)).split("\n");
    rest = parts.pop()!;
    for (const line of parts) if (line) yield line;
  }
  if (rest) yield rest;
}
