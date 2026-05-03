// Builds and downloads a styled multi-sheet Excel analysis workbook
// from cleaned FOS rows using xlsx-js-style.

import * as XLSX from "xlsx-js-style";
import { scoreProduct, bandForScore, BAND_COLORS } from "./scoringEngine";
import { rowToProduct, type Product } from "./fos-analyzer";
import { forceTextColumns } from "./barcode-utils";

// ---------- Colour palette ----------
const C = {
  navy: "10183F",
  crimson: "C0392B",
  white: "FFFFFF",
  warmWhite: "FFFDF8",
  green: "27AE60",
  greenLight: "D5F5E3",
  orange: "E67E22",
  orangeLight: "FDEBD0",
  red: "C0392B",
  redLight: "FADBD8",
  blue: "2471A3",
  blueLight: "D6EAF8",
  yellow: "F39C12",
  yellowLight: "FEF9E7",
  grey: "F2F3F4",
  greyAlt: "F9F9F9",
  darkGrey: "717D7E",
  black: "000000",
  gold: "FEF9E7",
};

// ---------- Style helpers ----------
const borderHair = {
  bottom: { style: "hair", color: { rgb: "CCCCCC" } },
  right: { style: "hair", color: { rgb: "CCCCCC" } },
};

const hdrStyle = (extra: any = {}) => ({
  font: { name: "Arial", sz: 10, bold: true, color: { rgb: C.white } },
  fill: { patternType: "solid", fgColor: { rgb: C.navy } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: {
    top: { style: "thin", color: { rgb: C.navy } },
    bottom: { style: "thin", color: { rgb: C.white } },
    left: { style: "thin", color: { rgb: C.navy } },
    right: { style: "thin", color: { rgb: C.navy } },
  },
  ...extra,
});

const sectionStyle = () => ({
  font: { name: "Arial", sz: 11, bold: true, color: { rgb: C.white } },
  fill: { patternType: "solid", fgColor: { rgb: C.crimson } },
  alignment: { horizontal: "left", vertical: "center" },
});

const titleStyle = () => ({
  font: { name: "Arial", sz: 14, bold: true, color: { rgb: C.white } },
  fill: { patternType: "solid", fgColor: { rgb: C.navy } },
  alignment: { horizontal: "center", vertical: "center" },
});

const subtitleStyle = () => ({
  font: { name: "Arial", sz: 10, italic: true, color: { rgb: C.black } },
  fill: { patternType: "solid", fgColor: { rgb: C.grey } },
  alignment: { horizontal: "center", vertical: "center" },
});

const cellStyle = (opts: {
  fill?: string;
  bold?: boolean;
  align?: "left" | "right" | "center";
  numFmt?: string;
  color?: string;
  wrap?: boolean;
} = {}) => {
  const { fill, bold = false, align = "left", numFmt, color = C.black, wrap } = opts;
  return {
    font: { name: "Arial", sz: 10, bold, color: { rgb: color } },
    fill: fill ? { patternType: "solid", fgColor: { rgb: fill } } : undefined,
    alignment: {
      horizontal: align,
      vertical: "center",
      wrapText: wrap ?? align === "left",
    },
    border: borderHair,
    numFmt: numFmt || undefined,
  };
};

// ---------- Derived per-product analysis ----------
type Derived = {
  p: Product;
  daysOfStockLeft: number | null;
  sellThroughRate: number | null;
  gpPerUnit: number | null;
  costVsAvgPct: number | null;
  isNeverSold: boolean;
  isStockout: boolean;
  isGhostStock: boolean;
  isStaleSold: boolean;
  isOverBought: boolean;
  isUnderBought: boolean;
  isBelowWholesale: boolean;
  isLowMargin: boolean;
  isCostCreep: boolean;
  isSellBelowCost: boolean;
  isZeroSellPrice: boolean;
  isZeroCost: boolean;
  isFastMover: boolean;
  isHighMargin: boolean;
  isStarPerformer: boolean;
  isLowStock: boolean;
  flags: string[];
  score: number;
  scoreLabel: import("./scoringEngine").ScoreBand;
  scoreFill: string;
  rowFill: string;
  recommendation: string;
};

function fmtAUDStr(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(n || 0);
}
function fmtPctStr(n: number): string {
  return `${(n || 0).toFixed(1)}%`;
}
function fmtDateStr(d: Date | null): string {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function deriveProduct(p: Product, periodDays: number): Derived {
  const isNeverSold = p.qtySold === 0 && p.soh > 0;
  const isStockout =
    p.soh === 0 && p.qtySold > 0 && (p.daysSinceSold === null || p.daysSinceSold < 60);
  const isGhostStock = (p.daysSincePurchased ?? 0) > 365 && p.soh > 0;
  const isStaleSold = (p.daysSinceSold ?? 0) > 365 && p.soh > 0;
  const isOverBought = p.qtyPurchased > p.qtySold * 2 && p.qtyPurchased > 4 && p.soh > 0;
  const isUnderBought = p.qtyPurchased < p.qtySold && p.soh === 0 && p.qtySold > 2;
  const isBelowWholesale = p.ws1Cost > 0 && p.sellPrice > 0 && p.sellPrice < p.ws1Cost;
  const isLowMargin = p.marginPct > 0 && p.marginPct < 20 && p.qtySold > 0;
  const isCostCreep = p.cost > 0 && p.avgCost > 0 && p.cost > p.avgCost * 1.05;
  const isSellBelowCost = p.sellPrice > 0 && p.cost > 0 && p.sellPrice < p.cost;
  const isZeroSellPrice = p.sellPrice === 0 && p.soh > 0;
  const isZeroCost = p.cost === 0 && p.qtySold > 0;
  const isFastMover = p.qtySold >= 15;
  const isHighMargin = p.marginPct > 50 && p.qtySold > 0;
  const isStarPerformer =
    p.salesGP > 100 &&
    p.marginPct > 35 &&
    p.qtySold > 5 &&
    (p.daysSinceSold ?? 999) < 45;
  const isLowStock = p.soh > 0 && p.soh <= 2 && p.qtySold >= 8;

  const daysOfStockLeft =
    p.qtySold > 0 && periodDays > 0 ? Math.round(p.soh / (p.qtySold / periodDays)) : null;
  const sellThroughRate = p.qtyPurchased > 0 ? (p.qtySold / p.qtyPurchased) * 100 : null;
  const gpPerUnit = p.qtySold > 0 ? p.salesGP / p.qtySold : null;
  const costVsAvgPct = p.avgCost > 0 ? ((p.cost - p.avgCost) / p.avgCost) * 100 : null;

  // Score: single source of truth
  const { score, band } = scoreProduct(p);
  const { scoreFill, rowFill } = BAND_COLORS[band];

  const flags: string[] = [];
  if (isBelowWholesale) flags.push("BELOW WHOLESALE");
  if (isSellBelowCost) flags.push("BELOW COST");
  if (isLowMargin) flags.push("LOW MARGIN <20%");
  if (isCostCreep) flags.push("COST CREEP");
  if (isNeverSold) flags.push("DEAD STOCK");
  if (isGhostStock) flags.push("GHOST STOCK");
  if (isStaleSold) flags.push("STALE >365d");
  if (isStockout) flags.push("STOCKOUT");
  if (isLowStock) flags.push("LOW STOCK");
  if (isOverBought) flags.push("OVER-BOUGHT");
  if (isUnderBought) flags.push("UNDER-BOUGHT");
  if (isZeroSellPrice) flags.push("NO SELL PRICE");
  if (isZeroCost) flags.push("NO COST DATA");
  if (isStarPerformer) flags.push("★ STAR");
  if (isHighMargin) flags.push("◆ HIGH MARGIN");
  if (isFastMover) flags.push("⚡ FAST MOVER");

  // Primary recommendation (highest priority first)
  let recommendation = "";
  if (isSellBelowCost) {
    recommendation = `URGENT: Fix sell price — currently selling at a loss (sell ${fmtAUDStr(p.sellPrice)} < cost ${fmtAUDStr(p.cost)})`;
  } else if (isBelowWholesale) {
    recommendation = `URGENT: Increase sell price — below WS1 cost (sell ${fmtAUDStr(p.sellPrice)} < WS1 ${fmtAUDStr(p.ws1Cost)}, losing ${fmtAUDStr(p.ws1Cost - p.sellPrice)}/unit)`;
  } else if (isLowMargin) {
    recommendation = `Review pricing — margin ${fmtPctStr(p.marginPct)} is below the 20% minimum threshold`;
  } else if (isStockout && p.qtySold > 5) {
    recommendation = `Reorder immediately — ${p.qtySold} sold this period, currently out of stock`;
  } else if (isStockout) {
    recommendation = `Check reorder — product sold recently but out of stock`;
  } else if (isLowStock) {
    recommendation = `Reorder soon — only ${p.soh} unit(s) left, sold ${p.qtySold} this period (~${daysOfStockLeft ?? "?"}d stock)`;
  } else if (isNeverSold && isGhostStock) {
    recommendation = `Consider discontinuing — no sales + last ordered ${p.daysSincePurchased}d ago`;
  } else if (isNeverSold) {
    recommendation = `Review range — zero sales this period with ${p.soh} units on shelf (${fmtAUDStr(p.soh * p.cost)} tied up)`;
  } else if (isStaleSold) {
    recommendation = `Check expiry — last sold ${p.daysSinceSold} days ago, ${p.soh} on hand`;
  } else if (isGhostStock) {
    recommendation = `Verify stock count — last purchased ${p.daysSincePurchased}d ago`;
  } else if (isCostCreep) {
    recommendation = `Review sell price — supplier cost up ${(costVsAvgPct ?? 0).toFixed(1)}% vs historical average`;
  } else if (isOverBought) {
    recommendation = `Reduce order qty — bought ${p.qtyPurchased} but sold only ${p.qtySold}`;
  } else if (isUnderBought) {
    recommendation = `Increase order qty — sold ${p.qtySold} but only ordered ${p.qtyPurchased}`;
  } else if (isStarPerformer) {
    recommendation = `Protect range — star performer, ensure consistent stock`;
  } else if (isHighMargin) {
    recommendation = `Prioritise placement — high-margin product (${fmtPctStr(p.marginPct)} GP)`;
  } else if (isFastMover) {
    recommendation = `Fast mover — review par level to avoid stockouts`;
  } else {
    recommendation = `No action required — product performing within normal parameters`;
  }

  return {
    p,
    daysOfStockLeft,
    sellThroughRate,
    gpPerUnit,
    costVsAvgPct,
    isNeverSold,
    isStockout,
    isGhostStock,
    isStaleSold,
    isOverBought,
    isUnderBought,
    isBelowWholesale,
    isLowMargin,
    isCostCreep,
    isSellBelowCost,
    isZeroSellPrice,
    isZeroCost,
    isFastMover,
    isHighMargin,
    isStarPerformer,
    isLowStock,
    flags,
    score,
    scoreLabel: band,
    scoreFill,
    rowFill,
    recommendation,
  };
}

// ---------- Sheet 1: Summary ----------
function buildSummarySheet(derived: Derived[], periodStart: Date | null, periodEnd: Date | null) {
  const ws: XLSX.WorkSheet = {} as any;
  const range = { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } };

  const setCell = (addr: string, value: any, style?: any, type: string = "s") => {
    (ws as any)[addr] = { v: value, t: type, s: style };
  };

  // Totals
  let stockValue = 0,
    salesVal = 0,
    salesGP = 0,
    qtySold = 0;
  for (const d of derived) {
    stockValue += d.p.soh * d.p.cost;
    salesVal += d.p.salesVal;
    salesGP += d.p.salesGP;
    qtySold += d.p.qtySold;
  }
  const blendedMargin = salesVal > 0 ? (salesGP / salesVal) * 100 : 0;

  // Title row
  setCell("A1", "BLACKSHAWS ROAD PHARMACY — FOS Stock Analysis Report", titleStyle());
  // Subtitle row
  const now = new Date();
  const generated = `${fmtDateStr(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const period = periodStart && periodEnd ? `${fmtDateStr(periodStart)} to ${fmtDateStr(periodEnd)}` : "n/a";
  setCell(
    "A2",
    `Generated: ${generated}  |  Period: ${period}  |  Products Analysed: ${derived.length}`,
    subtitleStyle(),
  );

  // Section: Portfolio Overview
  setCell("A4", "📊 PORTFOLIO OVERVIEW", sectionStyle());

  const kpis: [string, any, string][] = [
    ["Total Stock on Hand Value", stockValue, '"$"#,##0.00'],
    ["Total Revenue (Period)", salesVal, '"$"#,##0.00'],
    ["Total Gross Profit (Period)", salesGP, '"$"#,##0.00'],
    ["Blended GP Margin", blendedMargin / 100, "0.0%"],
    ["Total Units Sold", qtySold, "#,##0"],
    ["Total Products in Report", derived.length, "#,##0"],
  ];
  kpis.forEach(([label, value, fmt], i) => {
    const r = 6 + i;
    setCell(
      `A${r}`,
      label,
      cellStyle({ fill: C.grey, bold: true, color: C.navy, align: "left" }),
    );
    setCell(
      `E${r}`,
      value,
      cellStyle({ bold: true, align: "right", numFmt: fmt }),
      "n",
    );
  });

  // Flag count table — section
  setCell("A14", "🚦 FLAG SUMMARY", sectionStyle());
  setCell("A15", "Flag Category", hdrStyle());
  setCell("E15", "Products Affected", hdrStyle());
  setCell("G15", "Capital at Risk", hdrStyle());

  const flagCounts: { label: string; count: number; capital: number | null; fill: string }[] = [
    { label: "🔴 URGENT — Selling Below Wholesale", count: derived.filter((d) => d.isBelowWholesale).length, capital: null, fill: C.redLight },
    { label: "🔴 URGENT — Selling Below Cost", count: derived.filter((d) => d.isSellBelowCost).length, capital: null, fill: C.redLight },
    { label: "🔴 Low Margin (<20%)", count: derived.filter((d) => d.isLowMargin).length, capital: null, fill: C.redLight },
    {
      label: "🟠 Dead Stock (no sales, SOH > 0)",
      count: derived.filter((d) => d.isNeverSold).length,
      capital: derived.filter((d) => d.isNeverSold).reduce((s, d) => s + d.p.soh * d.p.cost, 0),
      fill: C.orangeLight,
    },
    {
      label: "🟠 Ghost Stock (no purchase > 365d)",
      count: derived.filter((d) => d.isGhostStock).length,
      capital: derived.filter((d) => d.isGhostStock).reduce((s, d) => s + d.p.soh * d.p.cost, 0),
      fill: C.orangeLight,
    },
    {
      label: "🟠 Stale Stock (last sold > 365d)",
      count: derived.filter((d) => d.isStaleSold).length,
      capital: derived.filter((d) => d.isStaleSold).reduce((s, d) => s + d.p.soh * d.p.cost, 0),
      fill: C.orangeLight,
    },
    {
      label: "🟡 Stockout (SOH=0, sold recently)",
      count: derived.filter((d) => d.isStockout).length,
      capital: derived.filter((d) => d.isStockout).reduce((s, d) => s + (d.gpPerUnit ?? 0) * 4, 0),
      fill: C.yellowLight,
    },
    { label: "🟡 Low Stock (≤2 units, fast mover)", count: derived.filter((d) => d.isLowStock).length, capital: null, fill: C.yellowLight },
    {
      label: "🟡 Over-bought",
      count: derived.filter((d) => d.isOverBought).length,
      capital: derived.filter((d) => d.isOverBought).reduce((s, d) => s + d.p.soh * d.p.cost, 0),
      fill: C.yellowLight,
    },
    { label: "🟡 Under-bought", count: derived.filter((d) => d.isUnderBought).length, capital: null, fill: C.yellowLight },
    { label: "🔵 Cost Creep (cost > avg+5%)", count: derived.filter((d) => d.isCostCreep).length, capital: null, fill: C.blueLight },
    { label: "🟢 Star Performers", count: derived.filter((d) => d.isStarPerformer).length, capital: null, fill: C.greenLight },
    { label: "🟢 High Margin Products (>50%)", count: derived.filter((d) => d.isHighMargin).length, capital: null, fill: C.greenLight },
    { label: "🟢 Fast Movers (≥15 units sold)", count: derived.filter((d) => d.isFastMover).length, capital: null, fill: C.greenLight },
    {
      label: "⚠️ Data Quality Issues",
      count: derived.filter((d) => d.isZeroSellPrice || d.isZeroCost).length,
      capital: null,
      fill: C.greyAlt,
    },
  ];

  flagCounts.forEach((f, i) => {
    const r = 16 + i;
    setCell(`A${r}`, f.label, cellStyle({ fill: f.fill, align: "left" }));
    setCell(`E${r}`, f.count, cellStyle({ fill: f.fill, align: "right", bold: true, numFmt: "#,##0" }), "n");
    if (f.capital !== null) {
      setCell(`G${r}`, f.capital, cellStyle({ fill: f.fill, align: "right", numFmt: '"$"#,##0' }), "n");
    } else {
      setCell(`G${r}`, "—", cellStyle({ fill: f.fill, align: "right" }));
    }
  });

  // Top 5 performers
  const topRowStart = 16 + flagCounts.length + 2;
  setCell(`A${topRowStart}`, "🏆 TOP 5 PERFORMERS BY GROSS PROFIT", sectionStyle());
  const topHdr = topRowStart + 1;
  ["Rank", "Product Name", "Dept", "Qty Sold", "Revenue", "GP $", "Margin %"].forEach((h, i) => {
    setCell(XLSX.utils.encode_cell({ r: topHdr - 1, c: i }), h, hdrStyle());
  });
  const top5 = [...derived].sort((a, b) => b.p.salesGP - a.p.salesGP).slice(0, 5);
  top5.forEach((d, i) => {
    const r = topHdr + i;
    const fill = i === 0 ? C.gold : C.warmWhite;
    setCell(`A${r + 1}`, i + 1, cellStyle({ fill, align: "center", bold: true, numFmt: "0" }), "n");
    setCell(`B${r + 1}`, d.p.stockName, cellStyle({ fill, align: "left" }));
    setCell(`C${r + 1}`, d.p.dept, cellStyle({ fill, align: "left" }));
    setCell(`D${r + 1}`, d.p.qtySold, cellStyle({ fill, align: "right", numFmt: "#,##0" }), "n");
    setCell(`E${r + 1}`, d.p.salesVal, cellStyle({ fill, align: "right", numFmt: '"$"#,##0.00' }), "n");
    setCell(`F${r + 1}`, d.p.salesGP, cellStyle({ fill, align: "right", numFmt: '"$"#,##0.00' }), "n");
    setCell(`G${r + 1}`, d.p.marginPct / 100, cellStyle({ fill, align: "right", numFmt: "0.0%" }), "n");
  });

  // Top 5 urgent
  const urgRowStart = topHdr + top5.length + 3;
  setCell(`A${urgRowStart}`, "🚨 TOP 5 URGENT ISSUES", sectionStyle());
  const urgHdr = urgRowStart + 1;
  ["Score", "Product Name", "Primary Flag", "Recommendation"].forEach((h, i) => {
    setCell(XLSX.utils.encode_cell({ r: urgHdr - 1, c: i }), h, hdrStyle());
  });
  const urgent5 = [...derived].sort((a, b) => a.score - b.score).slice(0, 5);
  urgent5.forEach((d, i) => {
    const r = urgHdr + i;
    const fill = C.redLight;
    setCell(`A${r + 1}`, d.score, cellStyle({ fill, align: "center", bold: true, numFmt: "0" }), "n");
    setCell(`B${r + 1}`, d.p.stockName, cellStyle({ fill, align: "left" }));
    setCell(`C${r + 1}`, d.flags[0] || "—", cellStyle({ fill, align: "left" }));
    setCell(`D${r + 1}`, d.recommendation.slice(0, 80), cellStyle({ fill, align: "left", wrap: true }));
  });

  // Merges for title rows
  const lastRow = urgHdr + urgent5.length;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, // title
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }, // subtitle
    { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } }, // portfolio overview hdr
    { s: { r: 13, c: 0 }, e: { r: 13, c: 7 } }, // flag summary hdr
    // KPI label/value merges
    ...Array.from({ length: 6 }, (_, i) => ({
      s: { r: 5 + i, c: 0 },
      e: { r: 5 + i, c: 3 },
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      s: { r: 5 + i, c: 4 },
      e: { r: 5 + i, c: 7 },
    })),
    // Flag-summary header merges
    { s: { r: 14, c: 0 }, e: { r: 14, c: 3 } },
    { s: { r: 14, c: 4 }, e: { r: 14, c: 5 } },
    { s: { r: 14, c: 6 }, e: { r: 14, c: 7 } },
    // Flag-summary row merges
    ...flagCounts.flatMap((_, i) => [
      { s: { r: 15 + i, c: 0 }, e: { r: 15 + i, c: 3 } },
      { s: { r: 15 + i, c: 4 }, e: { r: 15 + i, c: 5 } },
      { s: { r: 15 + i, c: 6 }, e: { r: 15 + i, c: 7 } },
    ]),
    // Top 5 section header
    { s: { r: topRowStart - 1, c: 0 }, e: { r: topRowStart - 1, c: 7 } },
    // Urgent section header
    { s: { r: urgRowStart - 1, c: 0 }, e: { r: urgRowStart - 1, c: 7 } },
    // Recommendation cell wider on urgent table
    ...urgent5.map((_, i) => ({
      s: { r: urgHdr + i, c: 3 },
      e: { r: urgHdr + i, c: 7 },
    })),
  ];

  ws["!cols"] = [
    { wch: 30 },
    { wch: 32 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
  ];
  ws["!rows"] = [{ hpt: 36 }, { hpt: 22 }];
  ws["!ref"] = `A1:H${Math.max(lastRow + 1, 50)}`;
  ws["!freeze"] = { xSplit: 0, ySplit: 1 } as any;
  ws["!views"] = [{ state: "frozen", ySplit: 1 }] as any;
  return ws;
}

// ---------- Sheet 2: Product Scorecard ----------
function buildScorecardSheet(derived: Derived[]) {
  const HDRS = [
    "Score", "Status", "Product Name", "APN", "Dept", "Category",
    "SOH", "Stock Value $", "Cost $", "Avg Cost $", "WS1 Cost $", "Sell Price $",
    "Margin %", "Qty Sold", "Revenue $", "GP $", "GP/Unit $",
    "Qty Purchased", "Sell-Through %", "Days Since Sold", "Days Since Purchased",
    "Days Stock Left", "Last Sold", "Last Purchased", "Flags", "Primary Recommendation",
  ];
  const widths = [9, 16, 42, 16, 20, 20, 8, 13, 10, 10, 10, 10, 10, 9, 12, 10, 10, 13, 14, 15, 18, 15, 14, 14, 35, 55];

  const sorted = [...derived].sort((a, b) => a.score - b.score);

  const aoa: any[][] = [HDRS];
  for (const d of sorted) {
    const p = d.p;
    aoa.push([
      d.score,
      d.scoreLabel,
      p.stockName,
      p.apn,
      p.dept,
      p.categories,
      p.soh,
      p.soh * p.cost,
      p.cost,
      p.avgCost,
      p.ws1Cost,
      p.sellPrice,
      p.marginPct / 100,
      p.qtySold,
      p.salesVal,
      p.salesGP,
      d.gpPerUnit,
      p.qtyPurchased,
      d.sellThroughRate !== null ? d.sellThroughRate / 100 : null,
      p.daysSinceSold,
      p.daysSincePurchased,
      d.daysOfStockLeft,
      fmtDateStr(p.lastSold),
      fmtDateStr(p.lastPurchased),
      d.flags.join(", "),
      d.recommendation,
    ]);
  }

  // Totals row (computed values, not formulas)
  const totals = sorted.reduce(
    (acc, d) => {
      acc.soh += d.p.soh;
      acc.stockValue += d.p.soh * d.p.cost;
      acc.qtySold += d.p.qtySold;
      acc.revenue += d.p.salesVal;
      acc.gp += d.p.salesGP;
      return acc;
    },
    { soh: 0, stockValue: 0, qtySold: 0, revenue: 0, gp: 0 },
  );
  const totalRow: any[] = new Array(HDRS.length).fill("");
  totalRow[0] = "TOTALS";
  totalRow[6] = totals.soh;
  totalRow[7] = totals.stockValue;
  totalRow[13] = totals.qtySold;
  totalRow[14] = totals.revenue;
  totalRow[15] = totals.gp;
  aoa.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = widths.map((w) => ({ wch: w }));

  // Header row style
  HDRS.forEach((_, c) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[ref]) ws[ref] = { v: HDRS[c], t: "s" };
    (ws[ref] as any).s = hdrStyle();
  });

  // Data rows
  const numFmtByCol: Record<number, string> = {
    0: "0",
    6: "#,##0",
    7: '"$"#,##0.00',
    8: '"$"#,##0.00',
    9: '"$"#,##0.00',
    10: '"$"#,##0.00',
    11: '"$"#,##0.00',
    12: "0.0%",
    13: "#,##0",
    14: '"$"#,##0.00',
    15: '"$"#,##0.00',
    16: '"$"#,##0.00',
    17: "#,##0",
    18: "0.0%",
    19: "0",
    20: "0",
    21: "0",
  };
  const rightCols = new Set([0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);

  sorted.forEach((d, idx) => {
    const r = idx + 1;
    const p = d.p;
    for (let c = 0; c < HDRS.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { v: "", t: "s" };
      let fill = d.rowFill;
      let bold = false;
      let color = C.black;
      let align: "left" | "right" | "center" = rightCols.has(c) ? "right" : "left";

      // Score & Status cells (cols 0 & 1) — coloured by band
      if (c === 0 || c === 1) {
        fill = d.scoreFill;
        bold = true;
        color = C.white;
        align = "center";
      }
      // Special highlights
      if (c === 12) {
        // Margin %
        if (d.isLowMargin) {
          fill = C.redLight;
          bold = true;
        } else if (p.marginPct > 50) {
          fill = C.greenLight;
          bold = true;
        }
      }
      if (c === 8 && d.isCostCreep) {
        fill = C.yellowLight;
      }
      if (c === 11 && d.isBelowWholesale) {
        fill = C.redLight;
        bold = true;
      }
      if (c === 19 && p.daysSinceSold !== null) {
        if (p.daysSinceSold > 365) fill = C.redLight;
        else if (p.daysSinceSold > 180) fill = C.orangeLight;
        else if (p.daysSinceSold > 60) fill = C.yellowLight;
      }
      if (c === 21 && d.daysOfStockLeft !== null && p.soh > 0) {
        if (d.daysOfStockLeft < 14) {
          fill = C.redLight;
          bold = true;
        } else if (d.daysOfStockLeft <= 30) {
          fill = C.orangeLight;
        }
      }
      if (c === 6 && p.soh === 0 && p.qtySold > 0) {
        fill = C.redLight;
        bold = true;
      }

      (ws[ref] as any).s = cellStyle({
        fill,
        bold,
        color,
        align,
        numFmt: numFmtByCol[c],
        wrap: c === 25 || c === 24,
      });
    }
  });

  // Totals row styling
  const tr = sorted.length + 1;
  for (let c = 0; c < HDRS.length; c++) {
    const ref = XLSX.utils.encode_cell({ r: tr, c });
    if (!ws[ref]) ws[ref] = { v: "", t: "s" };
    (ws[ref] as any).s = {
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: C.navy } },
      fill: { patternType: "solid", fgColor: { rgb: C.grey } },
      alignment: { horizontal: rightCols.has(c) ? "right" : "left", vertical: "center" },
      border: {
        top: { style: "double", color: { rgb: C.navy } },
        bottom: { style: "thin", color: { rgb: C.navy } },
      },
      numFmt: numFmtByCol[c] || undefined,
    };
  }

  // Row heights
  const rows: any[] = [{ hpt: 32 }];
  for (let i = 0; i < sorted.length; i++) rows.push({ hpt: 22 });
  rows.push({ hpt: 24 });
  ws["!rows"] = rows;

  ws["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(HDRS.length - 1)}1` };
  ws["!freeze"] = { xSplit: 0, ySplit: 1 } as any;
  ws["!views"] = [{ state: "frozen", ySplit: 1 }] as any;

  return ws;
}

// ---------- Sheet 3: Flags & Actions ----------
type FlagRow = {
  priority: 1 | 2 | 3 | 4;
  flag: string;
  category: string;
  d: Derived;
  metrics: [string, string, string, string, string, string]; // L1,V1,L2,V2,L3,V3
  action: string;
};

function priorityFor(flag: string): 1 | 2 | 3 | 4 {
  if (["BELOW COST", "BELOW WHOLESALE", "LOW MARGIN <20%", "NO SELL PRICE"].includes(flag)) return 1;
  if (["STOCKOUT", "DEAD STOCK", "GHOST STOCK", "STALE >365d", "COST CREEP"].includes(flag)) return 2;
  if (["LOW STOCK", "OVER-BOUGHT", "UNDER-BOUGHT", "NO COST DATA"].includes(flag)) return 3;
  return 4;
}

function categoryFor(flag: string): string {
  if (["BELOW COST", "BELOW WHOLESALE", "LOW MARGIN <20%", "COST CREEP", "NO SELL PRICE", "NO COST DATA"].includes(flag))
    return "Pricing Integrity";
  if (["DEAD STOCK", "GHOST STOCK", "STALE >365d"].includes(flag)) return "Inventory Risk";
  if (["STOCKOUT", "LOW STOCK"].includes(flag)) return "Stockout Risk";
  if (["OVER-BOUGHT", "UNDER-BOUGHT"].includes(flag)) return "Purchasing Efficiency";
  return "Performance";
}

function metricsFor(flag: string, d: Derived): [string, string, string, string, string, string] {
  const p = d.p;
  switch (flag) {
    case "BELOW WHOLESALE":
      return ["Sell Price", fmtAUDStr(p.sellPrice), "WS1 Cost", fmtAUDStr(p.ws1Cost), "Loss/Unit", fmtAUDStr(p.ws1Cost - p.sellPrice)];
    case "BELOW COST":
      return ["Sell Price", fmtAUDStr(p.sellPrice), "Cost Price", fmtAUDStr(p.cost), "Loss/Unit", fmtAUDStr(p.cost - p.sellPrice)];
    case "LOW MARGIN <20%":
      return ["Current Margin", fmtPctStr(p.marginPct), "Sell Price", fmtAUDStr(p.sellPrice), "Cost", fmtAUDStr(p.cost)];
    case "DEAD STOCK":
      return ["SOH", String(p.soh), "Capital Tied", fmtAUDStr(p.soh * p.cost), "Last Sold", p.lastSold ? fmtDateStr(p.lastSold) : "Never"];
    case "GHOST STOCK":
      return ["Days Since Buy", String(p.daysSincePurchased ?? "—"), "SOH", String(p.soh), "Stock Value", fmtAUDStr(p.soh * p.cost)];
    case "STALE >365d":
      return ["Days Since Sale", String(p.daysSinceSold ?? "—"), "SOH", String(p.soh), "Stock Value", fmtAUDStr(p.soh * p.cost)];
    case "STOCKOUT":
      return ["Qty Sold", String(p.qtySold), "GP Lost Est.", fmtAUDStr((d.gpPerUnit ?? 0) * 4), "Last Sold", p.lastSold ? fmtDateStr(p.lastSold) : "—"];
    case "LOW STOCK":
      return ["SOH", String(p.soh), "Qty Sold/Period", String(p.qtySold), "Days Left Est.", String(d.daysOfStockLeft ?? "—")];
    case "COST CREEP":
      return ["Current Cost", fmtAUDStr(p.cost), "Avg Cost", fmtAUDStr(p.avgCost), "% Increase", fmtPctStr(d.costVsAvgPct ?? 0)];
    case "OVER-BOUGHT":
      return ["Qty Purchased", String(p.qtyPurchased), "Qty Sold", String(p.qtySold), "Excess Units", String(p.qtyPurchased - p.qtySold)];
    case "UNDER-BOUGHT":
      return ["Qty Sold", String(p.qtySold), "Qty Purchased", String(p.qtyPurchased), "Shortfall", String(p.qtySold - p.qtyPurchased)];
    case "NO SELL PRICE":
      return ["SOH", String(p.soh), "Cost", fmtAUDStr(p.cost), "Sell Price", fmtAUDStr(p.sellPrice)];
    case "NO COST DATA":
      return ["Qty Sold", String(p.qtySold), "Sales Val", fmtAUDStr(p.salesVal), "Cost", fmtAUDStr(p.cost)];
    case "★ STAR":
    case "◆ HIGH MARGIN":
    case "⚡ FAST MOVER":
      return ["GP $", fmtAUDStr(p.salesGP), "Margin %", fmtPctStr(p.marginPct), "Qty Sold", String(p.qtySold)];
  }
  return ["", "", "", "", "", ""];
}

function actionFor(flag: string, d: Derived): string {
  const p = d.p;
  switch (flag) {
    case "BELOW WHOLESALE":
      return `Increase sell price to at least ${fmtAUDStr(p.ws1Cost * 1.35)} (currently ${fmtAUDStr(p.sellPrice)} vs WS1 ${fmtAUDStr(p.ws1Cost)}).`;
    case "BELOW COST":
      return `Fix pricing in Z Office immediately — currently selling at a loss of ${fmtAUDStr(p.cost - p.sellPrice)}/unit.`;
    case "LOW MARGIN <20%":
      return `Review pricing or supplier — current ${fmtPctStr(p.marginPct)} is below the 20% pharmacy threshold.`;
    case "DEAD STOCK":
      return `Markdown, return to supplier, or move to clearance. ${fmtAUDStr(p.soh * p.cost)} of capital tied up.`;
    case "GHOST STOCK":
      return `Verify physical count — last purchased ${p.daysSincePurchased}d ago. May be discontinued.`;
    case "STALE >365d":
      return `Check expiry dates immediately. Consider write-off — ${p.daysSinceSold}d since last sale.`;
    case "STOCKOUT":
      return `Reorder immediately — ${p.qtySold} units sold this period at ${fmtAUDStr(d.gpPerUnit ?? 0)}/unit GP.`;
    case "LOW STOCK":
      return `Reorder soon — only ${p.soh} unit(s) left, ~${d.daysOfStockLeft ?? "?"}d of stock at current rate.`;
    case "COST CREEP":
      return `Cost up ${fmtPctStr(d.costVsAvgPct ?? 0)} vs avg. Verify sell price still maintains target margin.`;
    case "OVER-BOUGHT":
      return `Reduce standing order — bought ${p.qtyPurchased} but only sold ${p.qtySold}. Excess: ${p.qtyPurchased - p.qtySold} units.`;
    case "UNDER-BOUGHT":
      return `Increase standing order by ~${Math.ceil((p.qtySold - p.qtyPurchased) * 1.2)} units to avoid stockout.`;
    case "NO SELL PRICE":
      return `Set a sell price in Z Office or Shopify admin — product cannot be sold without one.`;
    case "NO COST DATA":
      return `Update cost price in Z Office — margin reporting is unreliable without it.`;
    case "★ STAR":
      return `Protect range position. Ensure consistent stock and consider expanding to related products.`;
    case "◆ HIGH MARGIN":
      return `Prioritise placement and staff recommendation — high-value contributor.`;
    case "⚡ FAST MOVER":
      return `Review par level — never let this product go out of stock.`;
  }
  return "Review.";
}

function buildFlagsSheet(derived: Derived[]) {
  const flagRows: FlagRow[] = [];
  for (const d of derived) {
    for (const f of d.flags) {
      flagRows.push({
        priority: priorityFor(f),
        flag: f,
        category: categoryFor(f),
        d,
        metrics: metricsFor(f, d),
        action: actionFor(f, d),
      });
    }
  }
  flagRows.sort((a, b) => a.priority - b.priority || a.d.p.stockName.localeCompare(b.d.p.stockName));

  const HDRS = [
    "Priority", "Flag", "Category", "Product Name", "APN", "Dept",
    "Metric 1", "Value 1", "Metric 2", "Value 2", "Metric 3", "Value 3",
    "Action Required", "Done?",
  ];
  const widths = [10, 22, 22, 42, 16, 20, 18, 14, 18, 14, 18, 14, 60, 10];

  const ws: XLSX.WorkSheet = {} as any;
  const setCell = (addr: string, v: any, s: any, t = "s") => {
    (ws as any)[addr] = { v, t, s };
  };

  // Top notice rows
  setCell("A1", "📋 FLAGS & ACTIONS — Work through Priority 1 items first. Tick Done? when actioned.", {
    font: { name: "Arial", sz: 11, bold: true, color: { rgb: C.white } },
    fill: { patternType: "solid", fgColor: { rgb: C.navy } },
    alignment: { horizontal: "left", vertical: "center" },
  });
  setCell("A2", "Priority: 🔴 1=Critical  🟠 2=High  🟡 3=Medium  🟢 4=Info/Positive", {
    font: { name: "Arial", sz: 10, italic: true, color: { rgb: C.black } },
    fill: { patternType: "solid", fgColor: { rgb: C.warmWhite } },
    alignment: { horizontal: "left", vertical: "center" },
  });

  // Header row at row 4 (index 3)
  HDRS.forEach((h, c) => {
    const ref = XLSX.utils.encode_cell({ r: 3, c });
    setCell(ref, h, hdrStyle());
  });

  // Data rows from row 5 (index 4)
  flagRows.forEach((fr, i) => {
    const r = 4 + i;
    const fillByPri: Record<number, string> = {
      1: C.redLight,
      2: C.orangeLight,
      3: C.yellowLight,
      4: C.greenLight,
    };
    const fill = fillByPri[fr.priority];
    const cells = [
      fr.priority,
      fr.flag,
      fr.category,
      fr.d.p.stockName,
      fr.d.p.apn,
      fr.d.p.dept,
      fr.metrics[0],
      fr.metrics[1],
      fr.metrics[2],
      fr.metrics[3],
      fr.metrics[4],
      fr.metrics[5],
      fr.action,
      "",
    ];
    cells.forEach((v, c) => {
      const ref = XLSX.utils.encode_cell({ r, c });
      const isPriority = c === 0;
      const isAction = c === 12;
      const isDone = c === 13;
      setCell(
        ref,
        v,
        cellStyle({
          fill: isDone ? C.yellowLight : fill,
          bold: isPriority,
          align: isPriority ? "center" : "left",
          numFmt: isPriority ? "0" : undefined,
          wrap: isAction,
        }),
        typeof v === "number" ? "n" : "s",
      );
    });
  });

  ws["!cols"] = widths.map((w) => ({ wch: w }));
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: HDRS.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: HDRS.length - 1 } },
  ];
  ws["!rows"] = [
    { hpt: 30 },
    { hpt: 22 },
    { hpt: 10 },
    { hpt: 32 },
    ...flagRows.map(() => ({ hpt: 26 })),
  ];
  const lastRow = 4 + flagRows.length;
  ws["!ref"] = `A1:${XLSX.utils.encode_col(HDRS.length - 1)}${Math.max(lastRow, 5)}`;
  ws["!autofilter"] = { ref: `A4:${XLSX.utils.encode_col(HDRS.length - 1)}4` };
  ws["!freeze"] = { xSplit: 0, ySplit: 4 } as any;
  ws["!views"] = [{ state: "frozen", ySplit: 4 }] as any;
  return ws;
}

// ---------- Sheet 4: Data Legend ----------
function buildLegendSheet() {
  const ws: XLSX.WorkSheet = {} as any;
  const setCell = (addr: string, v: any, s: any) => {
    (ws as any)[addr] = { v, t: "s", s };
  };

  // Section 1: Column definitions
  setCell("A1", "COLUMN DEFINITIONS — Product Scorecard", titleStyle());
  ["Column", "Field Name", "Description", "Source"].forEach((h, c) => {
    setCell(XLSX.utils.encode_cell({ r: 1, c }), h, hdrStyle());
  });
  const colDefs: [string, string, string, string][] = [
    ["A", "Score", "Health score 0–100 (higher is better)", "Calculated"],
    ["B", "Status", "Banded label of the score", "Calculated"],
    ["C", "Product Name", "Stock item description", "Z Office Col A"],
    ["D", "APN", "Barcode", "Z Office Col C"],
    ["E", "Dept", "Department tag", "Z Office Col O"],
    ["F", "Category", "Category tag", "Z Office Col N"],
    ["G", "SOH", "Stock on hand right now", "Z Office Col E"],
    ["H", "Stock Value $", "SOH × Cost — capital tied up", "Calculated"],
    ["I", "Cost $", "Most recent cost price", "Z Office Col Q"],
    ["J", "Avg Cost $", "Historical average cost", "Z Office Col R"],
    ["K", "WS1 Cost $", "Wholesale tier 1 cost", "Z Office Col S"],
    ["L", "Sell Price $", "Current sell price", "Z Office Col U"],
    ["M", "Margin %", "End-of-period gross margin %", "Z Office Col M"],
    ["N", "Qty Sold", "Units sold in the period", "Z Office Col I"],
    ["O", "Revenue $", "Sales value in the period", "Z Office Col J"],
    ["P", "GP $", "Gross profit dollars in period", "Z Office Col K"],
    ["Q", "GP/Unit $", "Sales GP / Qty Sold", "Calculated"],
    ["R", "Qty Purchased", "Units ordered from supplier", "Z Office Col L"],
    ["S", "Sell-Through %", "Qty Sold / Qty Purchased × 100", "Calculated"],
    ["T", "Days Since Sold", "Today − Last Sold", "Calculated"],
    ["U", "Days Since Purchased", "Today − Last Purchased", "Calculated"],
    ["V", "Days Stock Left", "Projected days at current sell rate", "Calculated"],
    ["W", "Last Sold", "Last customer sale date", "Z Office Col H"],
    ["X", "Last Purchased", "Last supplier order date", "Z Office Col G"],
    ["Y", "Flags", "All applicable flags, comma-separated", "Calculated"],
    ["Z", "Primary Recommendation", "Most important action for this product", "Calculated"],
  ];
  colDefs.forEach((row, i) => {
    const r = 2 + i;
    const fill = i % 2 === 0 ? C.warmWhite : C.white;
    row.forEach((v, c) => {
      setCell(XLSX.utils.encode_cell({ r, c }), v, cellStyle({ fill, align: "left" }));
    });
  });

  // Section 2: Flag definitions
  let cursor = 2 + colDefs.length + 2;
  setCell(XLSX.utils.encode_cell({ r: cursor - 1, c: 0 }), "FLAG DEFINITIONS", sectionStyle());
  ["Flag", "Priority", "Trigger Condition", "Recommended Action"].forEach((h, c) => {
    setCell(XLSX.utils.encode_cell({ r: cursor, c }), h, hdrStyle());
  });
  cursor += 1;
  const flagDefs: [string, string, string, string, string][] = [
    ["BELOW WHOLESALE", "1", "sellPrice < ws1Cost", "Increase sell price urgently", C.redLight],
    ["BELOW COST", "1", "sellPrice < cost", "Fix pricing — selling at a loss", C.redLight],
    ["LOW MARGIN <20%", "1", "marginPct < 20 and qtySold > 0", "Review pricing/supplier", C.redLight],
    ["NO SELL PRICE", "1", "sellPrice = 0 and soh > 0", "Set a sell price", C.redLight],
    ["STOCKOUT", "2", "soh = 0 and sold recently", "Reorder immediately", C.orangeLight],
    ["DEAD STOCK", "2", "qtySold = 0 and soh > 0", "Markdown / return / clearance", C.orangeLight],
    ["GHOST STOCK", "2", "no purchase > 365d, soh > 0", "Verify count, may be discontinued", C.orangeLight],
    ["STALE >365d", "2", "lastSold > 365d ago, soh > 0", "Check expiry, consider write-off", C.orangeLight],
    ["COST CREEP", "2", "cost > avgCost × 1.05", "Review sell price vs new cost", C.orangeLight],
    ["LOW STOCK", "3", "soh ≤ 2 and qtySold ≥ 8", "Reorder soon", C.yellowLight],
    ["OVER-BOUGHT", "3", "qtyPurchased > 2× qtySold", "Reduce order quantity", C.yellowLight],
    ["UNDER-BOUGHT", "3", "qtyPurchased < qtySold, soh = 0", "Increase order quantity", C.yellowLight],
    ["NO COST DATA", "3", "cost = 0 and qtySold > 0", "Update cost price in Z Office", C.yellowLight],
    ["★ STAR", "4", "GP > $100, margin > 35%, sold > 5", "Protect range position", C.greenLight],
    ["◆ HIGH MARGIN", "4", "marginPct > 50% and qtySold > 0", "Prioritise placement", C.greenLight],
    ["⚡ FAST MOVER", "4", "qtySold ≥ 15", "Maintain par level", C.greenLight],
  ];
  flagDefs.forEach((row, i) => {
    const r = cursor + i;
    const fill = row[4];
    [row[0], row[1], row[2], row[3]].forEach((v, c) => {
      setCell(
        XLSX.utils.encode_cell({ r, c }),
        v,
        cellStyle({ fill, align: c === 1 ? "center" : "left", bold: c === 0 }),
      );
    });
  });

  // Section 3: Score calculation
  cursor = cursor + flagDefs.length + 2;
  setCell(XLSX.utils.encode_cell({ r: cursor - 1, c: 0 }), "HEALTH SCORE CALCULATION", sectionStyle());
  ["Condition", "Score Adjustment"].forEach((h, c) => {
    setCell(XLSX.utils.encode_cell({ r: cursor, c }), h, hdrStyle());
  });
  cursor += 1;
  const scoreRows: [string, string][] = [
    ["Base score", "100"],
    ["Selling below wholesale", "−30"],
    ["Margin below 20%", "−20"],
    ["Currently in stockout", "−15"],
    ["No sales (dead stock)", "−15"],
    ["Not sold in 180+ days", "−10"],
    ["Cost creep (>5% above avg)", "−10"],
    ["Ghost stock (no order 365d+)", "−10"],
    ["Over-bought", "−5"],
    ["Margin above 45%", "+10"],
    ["Fast mover (15+ units)", "+10"],
    ["GP > $200 in period", "+5"],
  ];
  scoreRows.forEach((row, i) => {
    const r = cursor + i;
    const fill = i % 2 === 0 ? C.warmWhite : C.white;
    setCell(XLSX.utils.encode_cell({ r, c: 0 }), row[0], cellStyle({ fill, align: "left" }));
    setCell(
      XLSX.utils.encode_cell({ r, c: 1 }),
      row[1],
      cellStyle({ fill, align: "center", bold: true }),
    );
  });

  // Section 4: Score bands
  cursor = cursor + scoreRows.length + 2;
  setCell(XLSX.utils.encode_cell({ r: cursor - 1, c: 0 }), "SCORE BANDS", sectionStyle());
  ["Score", "Label", "Meaning"].forEach((h, c) => {
    setCell(XLSX.utils.encode_cell({ r: cursor, c }), h, hdrStyle());
  });
  cursor += 1;
  const bandRows: [string, string, string, string][] = [
    ["80–100", "Healthy", "No action needed", C.greenLight],
    ["60–79", "Monitor", "Keep an eye on", C.yellowLight],
    ["40–59", "Action Required", "Needs attention soon", C.orangeLight],
    ["0–39", "URGENT", "Act immediately", C.redLight],
  ];
  bandRows.forEach((row, i) => {
    const r = cursor + i;
    const fill = row[3];
    [row[0], row[1], row[2]].forEach((v, c) => {
      setCell(
        XLSX.utils.encode_cell({ r, c }),
        v,
        cellStyle({ fill, align: c === 0 ? "center" : "left", bold: c <= 1 }),
      );
    });
  });

  // Layout
  ws["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 50 }, { wch: 40 }];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 2 + colDefs.length + 1, c: 0 }, e: { r: 2 + colDefs.length + 1, c: 3 } },
  ];
  ws["!rows"] = [{ hpt: 28 }];
  const lastRow = cursor + bandRows.length;
  ws["!ref"] = `A1:D${lastRow}`;
  ws["!freeze"] = { xSplit: 0, ySplit: 1 } as any;
  ws["!views"] = [{ state: "frozen", ySplit: 1 }] as any;
  return ws;
}

// ---------- Public entrypoint ----------
export type ExcelExportSummary = {
  productCount: number;
  flagCount: number;
  filename: string;
};

export function buildAndDownloadAnalysisWorkbook(rows: any[][]): ExcelExportSummary {
  const today = new Date();

  // Build products & period
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  const products: Product[] = rows.map((r) => {
    const p = rowToProduct(r, today);
    for (const d of [p.lastPurchased, p.lastSold]) {
      if (!d) continue;
      if (!periodStart || d < periodStart) periodStart = d;
      if (!periodEnd || d > periodEnd) periodEnd = d;
    }
    return p;
  });
  const periodDays =
    periodStart && periodEnd
      ? Math.max(
          1,
          Math.round(
            ((periodEnd as Date).getTime() - (periodStart as Date).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 30;

  const derived = products.map((p) => deriveProduct(p, periodDays));

  const wb = XLSX.utils.book_new();
  const summary = buildSummarySheet(derived, periodStart, periodEnd);
  const scorecard = buildScorecardSheet(derived);
  const flags = buildFlagsSheet(derived);
  const legend = buildLegendSheet();

  XLSX.utils.book_append_sheet(wb, summary, "Summary");
  XLSX.utils.book_append_sheet(wb, scorecard, "Product Scorecard");
  XLSX.utils.book_append_sheet(wb, flags, "Flags & Actions");
  XLSX.utils.book_append_sheet(wb, legend, "Data Legend");

  // Tab colours
  const tabColors = ["10183F", "2471A3", "C0392B", "717D7E"];
  if (!wb.Workbook) wb.Workbook = { Sheets: [] };
  if (!wb.Workbook.Sheets) wb.Workbook.Sheets = [];
  for (let i = 0; i < tabColors.length; i++) {
    (wb.Workbook.Sheets as any)[i] = { ...((wb.Workbook.Sheets as any)[i] || {}), tabColor: { rgb: tabColors[i] } };
  }

  const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const filename = `FOS_Analysis_${yyyymmdd}.xlsx`;
  XLSX.writeFile(wb, filename, { bookType: "xlsx", cellStyles: true });

  const flagCount = derived.reduce((s, d) => s + d.flags.length, 0);
  return { productCount: derived.length, flagCount, filename };
}
