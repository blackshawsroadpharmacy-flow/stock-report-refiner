import * as XLSX from "xlsx-js-style";
import type { Product, ProductAnalysis } from "./fos-analyzer";
import { productKey, type CompetitorMap } from "@/hooks/useCompetitorPricing";
import { supabase } from "@/integrations/supabase/client";
import { forceTextColumns, normalizeBarcode } from "./barcode-utils";

const C = {
  navy: "10183F",
  white: "FFFFFF",
  greenLight: "D5F5E3",
  redLight: "FADBD8",
  amberLight: "FDEBD0",
  grey: "F2F3F4",
};

const hdr = {
  font: { name: "Arial", sz: 10, bold: true, color: { rgb: C.white } },
  fill: { patternType: "solid", fgColor: { rgb: C.navy } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};
const cell = (extra: any = {}) => ({
  font: { name: "Arial", sz: 10 },
  alignment: { vertical: "center", wrapText: false },
  ...extra,
});
const num2 = "#,##0.00";
const pct1 = "0.0%";
const money = '"$"#,##0.00';

const METHOD: Record<string, string> = {
  pde: "APN",
  name_exact: "Exact name",
  name_fuzzy: "Fuzzy name",
};

type VendorListing = {
  key: string;
  match_method: string;
  confidence: number;
  vendor: string | null;
  competitor_product_name: string | null;
  pde: string | null;
  variant: string | null;
  sell_price: number | null;
  rrp: number | null;
  product_type: string | null;
  source: string | null;
  similarity: number | null;
};

async function fetchVendorListings(
  products: ProductAnalysis[],
  matches: CompetitorMap,
  minConfidence: number,
  onProgress?: (done: number, total: number) => void,
): Promise<VendorListing[]> {
  const queries = products
    .map((pa, idx) => ({ idx, pa, key: productKey(pa.product, idx) }))
    .filter(({ key }) => {
      const m = matches[key];
      return m && m.confidence >= minConfidence;
    })
    .map(({ pa, key }) => ({
      key,
      apn: pa.product.apn || "",
      name: pa.product.stockName || "",
    }));

  const all: VendorListing[] = [];
  if (queries.length === 0) return all;

  const CHUNK = 200;
  const CONCURRENCY = 4;
  const slices: typeof queries[] = [];
  for (let i = 0; i < queries.length; i += CHUNK) slices.push(queries.slice(i, i + CHUNK));

  let nextIdx = 0;
  let done = 0;
  const total = queries.length;

  const runOne = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= slices.length) return;
      const slice = slices[idx];
      const { data, error } = await supabase.rpc("list_competitor_listings", {
        queries: slice as any,
        max_per_product: 50,
      });
      if (error) throw error;
      for (const row of (data as any[]) ?? []) all.push(row as VendorListing);
      done += slice.length;
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, runOne));
  return all;
}

export async function exportCompetitorPricingXlsx(
  products: ProductAnalysis[],
  matches: CompetitorMap,
  minConfidence: number,
  fileBaseName: string,
  onProgress?: (stage: string, done?: number, total?: number) => void,
) {
  const headers = [
    "Stock Name", "APN", "Department", "SOH",
    "Our Sell $", "Our Cost $", "Our Margin %",
    "Match Method", "Confidence %", "Competitor Hits", "Vendors",
    "Comp Min $", "Comp Avg $", "Comp Median $", "Comp Max $",
    "Comp Margin %", "Margin Gap pp",
    "Price Δ $", "Price Δ %", "Position",
    "Cheapest Vendor", "Cheapest Listing",
  ];

  const rows: any[][] = [headers];
  let matched = 0, above = 0, below = 0, atMkt = 0;
  let sumDelta = 0, sumGap = 0;
  // Troubleshooting counters
  let noApn = 0, noName = 0, noSellPrice = 0, noCost = 0;
  let unmatched = 0, lowConfidence = 0;
  let byPde = 0, byNameExact = 0, byNameFuzzy = 0;
  const lowConfExamples: string[] = [];
  const unmatchedExamples: string[] = [];

  for (let idx = 0; idx < products.length; idx++) {
    const pa = products[idx];
    const p: Product = pa.product;
    const key = productKey(p, idx);
    const m = matches[key];
    const our = p.sellPrice;
    const cost = p.ws1Cost > 0 ? p.ws1Cost : p.avgCost;
    const ourMargin = p.marginPct > 0 ? p.marginPct / 100 : (cost > 0 && our > 0 ? (our - cost) / our : 0);

    // Data-quality counters
    if (!p.apn || !p.apn.trim()) noApn++;
    if (!p.stockName || !p.stockName.trim()) noName++;
    if (!our || our <= 0) noSellPrice++;
    if (!cost || cost <= 0) noCost++;

    if (!m) {
      unmatched++;
      if (unmatchedExamples.length < 10 && p.stockName) unmatchedExamples.push(p.stockName);
    } else if (m.confidence < minConfidence) {
      lowConfidence++;
      if (lowConfExamples.length < 10 && p.stockName) {
        lowConfExamples.push(`${p.stockName} (${Math.round(m.confidence * 100)}%)`);
      }
    }

    if (!m || m.confidence < minConfidence) {
      rows.push([
        p.stockName, p.apn, (p as any).department ?? "", p.soh,
        our || "", cost || "", ourMargin || "",
        m ? METHOD[m.match_method] : "No match",
        m ? m.confidence : "",
        m?.match_count ?? "", m?.vendor_count ?? "",
        "", "", "", "", "", "", "", "", "",
        m?.example_vendor ?? "", m?.example_name ?? "",
      ]);
      continue;
    }

    matched++;
    if (m.match_method === "pde") byPde++;
    else if (m.match_method === "name_exact") byNameExact++;
    else if (m.match_method === "name_fuzzy") byNameFuzzy++;

    const compMargin = cost > 0 && m.avg_price > 0 ? (m.avg_price - cost) / m.avg_price : 0;
    const priceDelta = our - m.avg_price;
    const priceDeltaPct = m.avg_price > 0 ? priceDelta / m.avg_price : 0;
    const marginGapPp = (ourMargin - compMargin) * 100;
    sumDelta += priceDeltaPct;
    sumGap += marginGapPp;

    let pos: string;
    if (our <= m.min_price * 1.001) pos = "Cheapest";
    else if (our >= m.max_price * 0.999) pos = "Most expensive";
    else if (Math.abs(priceDeltaPct) <= 0.02) pos = "At market";
    else pos = priceDeltaPct < 0 ? "Below avg" : "Above avg";

    if (priceDeltaPct > 0.02) above++;
    else if (priceDeltaPct < -0.02) below++;
    else atMkt++;

    rows.push([
      p.stockName, p.apn, (p as any).department ?? "", p.soh,
      our, cost, ourMargin,
      METHOD[m.match_method], m.confidence,
      m.match_count, m.vendor_count,
      m.min_price, m.avg_price, m.median_price, m.max_price,
      compMargin, marginGapPp,
      priceDelta, priceDeltaPct, pos,
      m.example_vendor ?? "", m.example_name ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Style header
  for (let c = 0; c < headers.length; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[ref]) ws[ref].s = hdr;
  }

  // Number formats + row tinting
  const moneyCols = [4, 5, 11, 12, 13, 14, 17];
  const pctCols = [6, 8, 15, 18];
  const numCols = [3, 9, 10, 16];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const deltaPct = typeof row[18] === "number" ? row[18] : null;
    let tint: string | undefined;
    if (deltaPct !== null) {
      if (deltaPct > 0.02) tint = C.redLight;
      else if (deltaPct < -0.02) tint = C.greenLight;
    }
    for (let c = 0; c < headers.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) continue;
      const s: any = cell();
      if (moneyCols.includes(c)) s.numFmt = money;
      else if (pctCols.includes(c)) s.numFmt = pct1;
      else if (numCols.includes(c)) s.numFmt = "#,##0";
      else if (c === 16) s.numFmt = num2;
      if (tint && c <= 19) s.fill = { patternType: "solid", fgColor: { rgb: tint } };
      ws[ref].s = s;
    }
  }

  ws["!cols"] = [
    { wch: 38 }, { wch: 14 }, { wch: 14 }, { wch: 7 },
    { wch: 11 }, { wch: 11 }, { wch: 11 },
    { wch: 12 }, { wch: 11 }, { wch: 9 }, { wch: 8 },
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 },
    { wch: 12 }, { wch: 12 },
    { wch: 11 }, { wch: 10 }, { wch: 14 },
    { wch: 22 }, { wch: 38 },
  ];
  ws["!freeze"] = { xSplit: 1, ySplit: 1 };
  if (rows.length > 1) {
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: headers.length - 1 } }) };
  }

  // Summary sheet
  const totalProducts = products.length;
  const avgDelta = matched ? sumDelta / matched : 0;
  const avgGap = matched ? sumGap / matched : 0;
  const matchRate = totalProducts ? matched / totalProducts : 0;
  const unmatchedRate = totalProducts ? unmatched / totalProducts : 0;
  const lowConfRate = totalProducts ? lowConfidence / totalProducts : 0;
  const noApnRate = totalProducts ? noApn / totalProducts : 0;

  type Cell = { v: any; fmt?: string };
  const SECTION = "__SECTION__";
  const BLANK = "__BLANK__";

  const summary: any[][] = [
    ["Competitor Pricing — Summary"],
    [],
    ["Generated", new Date().toLocaleString()],
    ["Min confidence threshold", { v: minConfidence, fmt: pct1 } as Cell],
    [],
    [SECTION, "Match overview"],
    ["Total products in report", totalProducts],
    ["Matched (≥ threshold)", matched],
    ["Match rate", { v: matchRate, fmt: pct1 } as Cell],
    [],
    [SECTION, "Match method breakdown"],
    ["Matched by APN (barcode)", byPde],
    ["Matched by exact name", byNameExact],
    ["Matched by fuzzy name", byNameFuzzy],
    [],
    [SECTION, "Market position (matched only)"],
    ["Above market (>+2%)", above],
    ["At market (±2%)", atMkt],
    ["Below market (<-2%)", below],
    ["Avg price vs market", { v: avgDelta, fmt: pct1 } as Cell],
    ["Avg margin gap (pp)", { v: avgGap, fmt: num2 } as Cell],
    [],
    [SECTION, "🔧 Troubleshooting — why products aren't matched"],
    ["No competitor match found", unmatched],
    ["  as % of products", { v: unmatchedRate, fmt: pct1 } as Cell],
    [`Low-confidence matches (< ${Math.round(minConfidence * 100)}%)`, lowConfidence],
    ["  as % of products", { v: lowConfRate, fmt: pct1 } as Cell],
    [],
    [SECTION, "Source data quality"],
    ["Products with no APN/barcode", noApn],
    ["  as % of products", { v: noApnRate, fmt: pct1 } as Cell],
    ["Products with blank stock name", noName],
    ["Products with no sell price", noSellPrice],
    ["Products with no cost (WS1/Avg)", noCost],
    [],
    [SECTION, "How to improve match rates"],
    ["• Populate APN/barcode in Z Office — APN matches are 100% confidence."],
    ["• Standardise stock names (strength, pack size, brand spelling)."],
    ["• Lower the min-confidence threshold to surface more fuzzy matches."],
    ["• Note: source competitor file has scientific-notation corruption in barcodes,"],
    ["  so most matches fall back to fuzzy name similarity."],
    [],
    [SECTION, "Examples — unmatched products"],
    ...(unmatchedExamples.length ? unmatchedExamples.map((n) => [`  • ${n}`]) : [["  (none)"]]),
    [],
    [SECTION, "Examples — low-confidence matches"],
    ...(lowConfExamples.length ? lowConfExamples.map((n) => [`  • ${n}`]) : [["  (none)"]]),
    [],
    [SECTION, "Notes"],
    ["Competitor margin estimated using your wholesale cost (WS1, fallback Avg) as a proxy."],
    ["Match methods: APN = exact barcode, Exact name = normalized exact, Fuzzy = trigram similarity."],
  ];

  // Materialise the sheet, expanding {v,fmt} cells and SECTION rows
  const flatRows: any[][] = summary.map((r) =>
    r.map((c) => {
      if (c && typeof c === "object" && "v" in c) return c.v;
      if (c === SECTION) return null;
      return c;
    }),
  );
  const ws2 = XLSX.utils.aoa_to_sheet(flatRows);

  // Title
  if (ws2["A1"]) {
    ws2["A1"].s = {
      font: { bold: true, sz: 14, color: { rgb: C.white } },
      fill: { patternType: "solid", fgColor: { rgb: C.navy } },
    };
  }

  // Apply per-cell formatting and section styling
  for (let r = 0; r < summary.length; r++) {
    const row = summary[r];
    for (let c = 0; c < row.length; c++) {
      const raw = row[c];
      const ref = XLSX.utils.encode_cell({ r, c });
      if (raw === SECTION) {
        // Section header lives in column B (c=1); style col A+B as a banner
        const refA = XLSX.utils.encode_cell({ r, c: 0 });
        const refB = XLSX.utils.encode_cell({ r, c: 1 });
        const banner = {
          font: { bold: true, color: { rgb: C.white } },
          fill: { patternType: "solid", fgColor: { rgb: C.navy } },
        };
        if (ws2[refA]) ws2[refA].s = banner;
        if (ws2[refB]) ws2[refB].s = banner;
        continue;
      }
      if (raw && typeof raw === "object" && "fmt" in raw && ws2[ref]) {
        ws2[ref].z = raw.fmt;
      }
    }
  }

  ws2["!cols"] = [{ wch: 42 }, { wch: 38 }];

  // ===== Vendor Listings sheet =====
  onProgress?.("Fetching vendor listings…", 0, 0);
  const listings = await fetchVendorListings(products, matches, minConfidence, (d, t) =>
    onProgress?.("Fetching vendor listings…", d, t),
  );

  // Build a key -> stock name / APN / our price map for context
  const ctx = new Map<string, { stockName: string; apn: string; ourPrice: number; ourCost: number }>();
  products.forEach((pa, idx) => {
    const k = productKey(pa.product, idx);
    const cost = pa.product.ws1Cost > 0 ? pa.product.ws1Cost : pa.product.avgCost;
    ctx.set(k, {
      stockName: pa.product.stockName,
      apn: pa.product.apn,
      ourPrice: pa.product.sellPrice,
      ourCost: cost,
    });
  });

  const vHeaders = [
    "Our Stock Name", "Our APN", "Our Sell $",
    "Match Method", "Confidence %",
    "Competitor Vendor", "Competitor Product", "Competitor PDE", "Variant",
    "Competitor Sell $", "Competitor RRP $",
    "vs Our $", "vs Our %",
    "Product Type", "Source",
  ];

  // Sort: by our stock name, then competitor sell price ascending
  listings.sort((a, b) => {
    const an = ctx.get(a.key)?.stockName ?? "";
    const bn = ctx.get(b.key)?.stockName ?? "";
    if (an !== bn) return an.localeCompare(bn);
    const ap = a.sell_price ?? Number.POSITIVE_INFINITY;
    const bp = b.sell_price ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  const vRows: any[][] = [vHeaders];
  for (const l of listings) {
    const c = ctx.get(l.key);
    const our = c?.ourPrice ?? 0;
    const comp = l.sell_price ?? 0;
    const delta = comp > 0 && our > 0 ? our - comp : "";
    const deltaPct = comp > 0 && our > 0 ? (our - comp) / comp : "";
    vRows.push([
      c?.stockName ?? "",
      c?.apn ?? "",
      our || "",
      METHOD[l.match_method] ?? l.match_method,
      l.confidence ?? "",
      l.vendor ?? "",
      l.competitor_product_name ?? "",
      l.pde ?? "",
      l.variant ?? "",
      comp || "",
      l.rrp ?? "",
      delta,
      deltaPct,
      l.product_type ?? "",
      l.source ?? "",
    ]);
  }

  const ws3 = XLSX.utils.aoa_to_sheet(vRows);
  for (let cIdx = 0; cIdx < vHeaders.length; cIdx++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c: cIdx });
    if (ws3[ref]) ws3[ref].s = hdr;
  }
  const vMoneyCols = [2, 9, 10, 11];
  const vPctCols = [4, 12];
  for (let r = 1; r < vRows.length; r++) {
    const row = vRows[r];
    const dPct = typeof row[12] === "number" ? row[12] : null;
    let tint: string | undefined;
    if (dPct !== null) {
      if (dPct > 0.02) tint = C.redLight;
      else if (dPct < -0.02) tint = C.greenLight;
    }
    for (let cIdx = 0; cIdx < vHeaders.length; cIdx++) {
      const ref = XLSX.utils.encode_cell({ r, c: cIdx });
      if (!ws3[ref]) continue;
      const s: any = cell();
      if (vMoneyCols.includes(cIdx)) s.numFmt = money;
      else if (vPctCols.includes(cIdx)) s.numFmt = pct1;
      if (tint) s.fill = { patternType: "solid", fgColor: { rgb: tint } };
      ws3[ref].s = s;
    }
  }
  ws3["!cols"] = [
    { wch: 38 }, { wch: 14 }, { wch: 11 },
    { wch: 12 }, { wch: 11 },
    { wch: 22 }, { wch: 38 }, { wch: 16 }, { wch: 12 },
    { wch: 12 }, { wch: 11 },
    { wch: 11 }, { wch: 10 },
    { wch: 22 }, { wch: 16 },
  ];
  ws3["!freeze"] = { xSplit: 1, ySplit: 1 };
  if (vRows.length > 1) {
    ws3["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: vRows.length - 1, c: vHeaders.length - 1 } }) };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws2, "Summary");
  XLSX.utils.book_append_sheet(wb, ws, "Competitor Pricing");
  XLSX.utils.book_append_sheet(wb, ws3, "Vendor Listings");

  onProgress?.("Writing file…");
  const ts = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileBaseName}_competitor_pricing_${ts}.xlsx`);
}
