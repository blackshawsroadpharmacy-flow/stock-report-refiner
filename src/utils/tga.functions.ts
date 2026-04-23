// TanStack server function: fetch TGA Alerts & Recalls RSS and match against
// supplied product names. Runs on the server (Worker runtime) so the browser
// never hits a CORS wall.

import { createServerFn } from "@tanstack/react-start";

export type TGAMatch = {
  productName: string;
  recallTitle: string;
  recallLink: string;
  pubDate: string;
};

export type TGAResult =
  | {
      ok: true;
      recallsFound: boolean;
      matches: TGAMatch[];
      totalRecallsChecked: number;
      checkedAt: string;
    }
  | {
      ok: false;
      error: string;
      checkedAt: string;
    };

const TGA_RSS_URL = "https://www.tga.gov.au/rss/alerts-and-recalls.xml";

// Very small RSS/XML extractor — avoids pulling a dependency. Cloudflare Workers
// have no DOMParser, so we parse with regex against the well-known feed shape.
function parseRssItems(xml: string): { title: string; description: string; link: string; pubDate: string }[] {
  const items: { title: string; description: string; link: string; pubDate: string }[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) ?? [];
  for (const block of itemBlocks) {
    const pick = (tag: string): string => {
      // CDATA-aware
      const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tag}>`, "i");
      const m = block.match(re);
      return m ? m[1].trim() : "";
    };
    items.push({
      title: pick("title"),
      description: pick("description"),
      link: pick("link"),
      pubDate: pick("pubDate"),
    });
  }
  return items;
}

export const checkTGARecalls = createServerFn({ method: "POST" })
  .inputValidator((input: { productNames: string[] }) => {
    if (!input || !Array.isArray(input.productNames)) {
      return { productNames: [] as string[] };
    }
    // cap to first 2000 to keep payload sane; trim and dedupe
    const cleaned = Array.from(
      new Set(
        input.productNames
          .filter((n) => typeof n === "string")
          .map((n) => n.trim())
          .filter((n) => n.length >= 4),
      ),
    ).slice(0, 2000);
    return { productNames: cleaned };
  })
  .handler(async ({ data }): Promise<TGAResult> => {
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(TGA_RSS_URL, {
        signal: controller.signal,
        headers: {
          "User-Agent": "FOS-Stock-Analyser/1.0 (+pharmacy-recall-check)",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          ok: false,
          error: `TGA_FETCH_FAILED: HTTP ${res.status}`,
          checkedAt,
        };
      }

      const xml = await res.text();
      const items = parseRssItems(xml);

      // Build lowercase needles from the first 10 chars of each product name.
      const needles = data.productNames
        .map((n) => n.slice(0, 10).toLowerCase())
        .filter((n) => n.length >= 4);

      const matches: TGAMatch[] = [];
      for (const item of items) {
        const haystack = `${item.title} ${item.description}`.toLowerCase();
        for (let i = 0; i < needles.length; i++) {
          const needle = needles[i];
          if (haystack.includes(needle)) {
            matches.push({
              productName: data.productNames[i],
              recallTitle: item.title,
              recallLink: item.link,
              pubDate: item.pubDate,
            });
          }
        }
      }

      return {
        ok: true,
        recallsFound: matches.length > 0,
        matches,
        totalRecallsChecked: items.length,
        checkedAt,
      };
    } catch (err) {
      clearTimeout(timeout);
      const msg =
        err instanceof Error
          ? err.name === "AbortError"
            ? "TGA_TIMEOUT"
            : err.message
          : "TGA_FETCH_FAILED";
      return {
        ok: false,
        error: msg,
        checkedAt,
      };
    }
  });
