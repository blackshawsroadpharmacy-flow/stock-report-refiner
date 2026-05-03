import type { ProductAnalysis } from "./fos-analyzer";
import { productKey, type CompetitorMap } from "@/hooks/useCompetitorPricing";
import { csvBarcodeCell } from "./barcode-utils";

const METHOD: Record<string, string> = {
  pde: "APN",
  name_exact: "Exact name",
  name_fuzzy: "Fuzzy name",
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCompetitorPricingCsv(
  products: ProductAnalysis[],
  matches: CompetitorMap,
  minConfidence: number,
  fileBaseName: string,
) {
  const headers = [
    "Stock Name", "APN", "Department", "SOH",
    "Our Sell $", "Our Cost $", "Our Margin %",
    "Match Method", "Confidence %", "Competitor Hits", "Vendors",
    "Comp Min $", "Comp Avg $", "Comp Median $", "Comp Max $",
    "Comp Margin %", "Margin Gap pp",
    "Price Delta $", "Price Delta %", "Position",
    "Cheapest Vendor", "Cheapest Listing",
  ];

  const lines: string[] = [headers.map(csvEscape).join(",")];
  const r2 = (n: number) => Math.round(n * 100) / 100;

  for (let idx = 0; idx < products.length; idx++) {
    const pa = products[idx];
    const p = pa.product;
    const key = productKey(p, idx);
    const m = matches[key];
    const our = p.sellPrice;
    const cost = p.ws1Cost > 0 ? p.ws1Cost : p.avgCost;
    const ourMarginPct = p.marginPct > 0 ? p.marginPct : (cost > 0 && our > 0 ? ((our - cost) / our) * 100 : 0);

    if (!m || m.confidence < minConfidence) {
      const fields = [
        csvEscape(p.stockName),
        csvBarcodeCell(p.apn),
        csvEscape((p as any).department ?? ""),
        csvEscape(p.soh),
        csvEscape(our || ""),
        csvEscape(cost || ""),
        csvEscape(our > 0 ? r2(ourMarginPct) : ""),
        csvEscape(m ? METHOD[m.match_method] : "No match"),
        csvEscape(m ? Math.round(m.confidence * 100) : ""),
        csvEscape(m?.match_count ?? ""),
        csvEscape(m?.vendor_count ?? ""),
        "", "", "", "", "", "", "", "", "",
        csvEscape(m?.example_vendor ?? ""),
        csvEscape(m?.example_name ?? ""),
      ];
      lines.push(fields.join(","));
      continue;
    }

    const compMargin = cost > 0 && m.avg_price > 0 ? ((m.avg_price - cost) / m.avg_price) * 100 : 0;
    const priceDelta = our - m.avg_price;
    const priceDeltaPct = m.avg_price > 0 ? (priceDelta / m.avg_price) * 100 : 0;
    const marginGapPp = ourMarginPct - compMargin;

    let pos: string;
    if (our <= m.min_price * 1.001) pos = "Cheapest";
    else if (our >= m.max_price * 0.999) pos = "Most expensive";
    else if (Math.abs(priceDeltaPct) <= 2) pos = "At market";
    else pos = priceDeltaPct < 0 ? "Below avg" : "Above avg";

    lines.push([
      p.stockName, p.apn, (p as any).department ?? "", p.soh,
      r2(our), r2(cost), r2(ourMarginPct),
      METHOD[m.match_method], Math.round(m.confidence * 100),
      m.match_count, m.vendor_count,
      r2(m.min_price), r2(m.avg_price), r2(m.median_price), r2(m.max_price),
      r2(compMargin), r2(marginGapPp),
      r2(priceDelta), r2(priceDeltaPct), pos,
      m.example_vendor ?? "", m.example_name ?? "",
    ].map(csvEscape).join(","));
  }

  // BOM for Excel UTF-8 compatibility
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${fileBaseName}_competitor_pricing_${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
