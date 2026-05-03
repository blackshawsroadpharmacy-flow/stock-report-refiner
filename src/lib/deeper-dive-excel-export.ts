import * as XLSX from "xlsx-js-style";
import type { AnalysisResult } from "./fos-analyzer";
import { fmtAUD, fmtPct } from "./fos-analyzer";
import {
  cleanDataset,
  buildProfitEngine,
  buildDeptPnL,
  buildCapitalRelease,
  buildActionCard,
  buildIntegrityReport,
  buildSeasonalIntel,
  buildDemographicCoverage,
  buildStrategicAnalystReport,
  type CleanedProduct,
} from "./deeperDiveUtils";
import { forceTextColumns, normalizeBarcode } from "./barcode-utils";

const C = {
  navy: "10183F",
  white: "FFFFFF",
  grey: "F2F3F4",
  greenLight: "D5F5E3",
  redLight: "FADBD8",
  amberLight: "FDEBD0",
};

const hdrStyle = {
  font: { name: "Arial", sz: 10, bold: true, color: { rgb: C.white } },
  fill: { patternType: "solid", fgColor: { rgb: C.navy } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
};

const titleStyle = {
  font: { name: "Arial", sz: 14, bold: true, color: { rgb: C.navy } },
  alignment: { vertical: "center" },
};

const subtitleStyle = {
  font: { name: "Arial", sz: 10, italic: true, color: { rgb: "666666" } },
};

const bodyStyle = {
  font: { name: "Arial", sz: 10 },
  alignment: { vertical: "center", wrapText: false },
};

const wrapStyle = {
  font: { name: "Arial", sz: 10 },
  alignment: { vertical: "top", wrapText: true },
};

const money = '"$"#,##0.00';
const pct1 = "0.0%";
const int0 = "#,##0";

type Col = {
  header: string;
  width: number;
  fmt?: string;
  get: (row: any) => any;
  style?: any;
};

function buildSheet(title: string, subtitle: string, columns: Col[], rows: any[]) {
  const aoa: any[][] = [];
  aoa.push([{ v: title, s: titleStyle }]);
  if (subtitle) aoa.push([{ v: subtitle, s: subtitleStyle }]);
  aoa.push([]);
  aoa.push(columns.map((c) => ({ v: c.header, s: hdrStyle })));
  for (const r of rows) {
    aoa.push(
      columns.map((c) => {
        const v = c.get(r);
        const cellStyle = c.style ?? bodyStyle;
        const cell: any = { v, s: cellStyle };
        if (c.fmt && typeof v === "number") cell.z = c.fmt;
        return cell;
      }),
    );
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: c.width }));
  // Freeze under header (row index 4 in 0-based)
  ws["!freeze"] = { xSplit: 0, ySplit: 4 };
  // Force any column whose header contains "APN", "PDE", "Barcode" or "SKU"
  // to be stored as text so Excel cannot mangle it into scientific notation.
  const textCols: number[] = [];
  columns.forEach((c, i) => {
    if (/\b(apn|pde|barcode|sku)\b/i.test(c.header)) textCols.push(i);
  });
  if (textCols.length && rows.length) {
    forceTextColumns(ws, textCols, 4, 4 + rows.length - 1);
  }
  return ws;
}

function productCols(): Col[] {
  return [
    { header: "Product", width: 42, get: (p: CleanedProduct) => p.stockName },
    { header: "Dept", width: 20, get: (p: CleanedProduct) => p.dept },
    { header: "PDE/APN", width: 18, get: (p: CleanedProduct) => normalizeBarcode(p.pde || p.apn || "") },
    { header: "SOH", width: 8, fmt: int0, get: (p: CleanedProduct) => p.soh },
    { header: "Stock Value", width: 14, fmt: money, get: (p: CleanedProduct) => p.stockValue },
    { header: "Cost", width: 10, fmt: money, get: (p: CleanedProduct) => p.cost },
    { header: "WS1 Cost", width: 10, fmt: money, get: (p: CleanedProduct) => p.ws1Cost },
    { header: "Sell", width: 10, fmt: money, get: (p: CleanedProduct) => p.sellPrice },
    { header: "Margin %", width: 10, fmt: "0.0", get: (p: CleanedProduct) => p.marginPct },
    { header: "Qty Sold", width: 10, fmt: int0, get: (p: CleanedProduct) => p.qtySold },
    { header: "Sales $", width: 12, fmt: money, get: (p: CleanedProduct) => p.salesVal },
    { header: "GP $", width: 12, fmt: money, get: (p: CleanedProduct) => p.salesGP },
    { header: "Days Since Sold", width: 12, fmt: int0, get: (p: CleanedProduct) => p.daysSinceSold ?? "" },
    { header: "Days of Stock Left", width: 14, fmt: int0, get: (p: CleanedProduct) => p.daysOfStockLeft ?? "" },
    { header: "Score", width: 8, fmt: int0, get: (p: CleanedProduct) => p.score },
    { header: "Band", width: 14, get: (p: CleanedProduct) => p.scoreBand },
    { header: "Flags", width: 40, style: wrapStyle, get: (p: CleanedProduct) => p.flagsString },
  ];
}

export async function exportDeeperDiveXlsx(result: AnalysisResult, filenamePrefix = "deeper_dive") {
  const ds = cleanDataset(result.products, result.periodDays);
  const profit = buildProfitEngine(ds.cleanedData);
  const deptPnL = buildDeptPnL(ds.cleanedData);
  const capital = buildCapitalRelease(ds.cleanedData);
  const action = buildActionCard(ds.cleanedData, ds.negativeSOHLines, profit);
  const integrity = buildIntegrityReport(ds);
  const seasonal = buildSeasonalIntel(ds.cleanedData);
  const demo = buildDemographicCoverage(ds.cleanedData);
  const analyst = buildStrategicAnalystReport(ds, result.periodDays);

  const wb = XLSX.utils.book_new();

  // ── Summary ────────────────────────────────────────────────────────────
  {
    const aoa: any[][] = [];
    aoa.push([{ v: "🔍 Deeper Dive Analysis — Summary", s: titleStyle }]);
    aoa.push([{ v: `Generated ${new Date().toLocaleString()}`, s: subtitleStyle }]);
    aoa.push([]);
    const kv: [string, any, string?][] = [
      ["Period start", result.periodStart?.toLocaleDateString() ?? "—"],
      ["Period end", result.periodEnd?.toLocaleDateString() ?? "—"],
      ["Period days", result.periodDays],
      ["Products analysed", result.totals.productCount],
      ["Flags raised", result.totals.flagCount],
      ["Stock value", result.totals.stockValue, money],
      ["Sales (period)", result.totals.salesVal, money],
      ["GP (period)", result.totals.salesGP, money],
      ["Blended margin", result.totals.blendedMargin / 100, pct1],
      ["Zero-sales lines", result.totals.zeroSalesCount],
      ["Out-of-stock lines", result.totals.outOfStockCount],
      ["Dead-stock capital", result.totals.deadStockCapital, money],
      ["Stockout GP at risk", result.totals.stockoutGpAtRisk, money],
      ["—", ""],
      ["Top 20 GP $", profit.top20GpSum, money],
      ["Top 20 share of GP", profit.top20GpPct / 100, pct1],
      ["Stars at risk", profit.starsAtRisk.length],
      ["—", ""],
      ["Data reliability", integrity.reliabilityScore / 100, pct1],
      ["Integrity issues", integrity.issueCount],
      ["Negative SOH lines", ds.negativeSOHLines.length],
      ["Service lines (excluded)", ds.serviceLines.length],
      ["—", ""],
      ["Capital tied in slow stock", capital.totalCapital, money],
      ["Capital release lines", capital.rows.length],
    ];
    for (const [k, v, fmt] of kv) {
      const cell: any = { v, s: bodyStyle };
      if (fmt && typeof v === "number") cell.z = fmt;
      aoa.push([{ v: k, s: { ...bodyStyle, font: { ...bodyStyle.font, bold: true } } }, cell]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 32 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
  }

  // ── Profit Engine — Top 20 ─────────────────────────────────────────────
  {
    const cols: Col[] = [
      { header: "Rank", width: 6, fmt: int0, get: (r) => r.rank },
      ...productCols(),
    ];
    const rows = profit.top20.map((r) => ({ rank: r.rank, ...r.product }));
    const ws = buildSheet(
      "💰 Profit Engine — Top 20 by GP",
      `${profit.top20GpPct.toFixed(1)}% of total GP (${fmtAUD(profit.top20GpSum)} of ${fmtAUD(profit.totalGp)})`,
      cols,
      rows,
    );
    XLSX.utils.book_append_sheet(wb, ws, "Profit Engine");
  }

  // ── Stars at Risk ──────────────────────────────────────────────────────
  {
    const ws = buildSheet(
      "⭐ Stars at Risk — High margin, low stock",
      `${profit.starsAtRisk.length} line(s) flagged`,
      productCols(),
      profit.starsAtRisk,
    );
    XLSX.utils.book_append_sheet(wb, ws, "Stars at Risk");
  }

  // ── Department P&L ─────────────────────────────────────────────────────
  {
    const cols: Col[] = [
      { header: "Department", width: 30, get: (r) => r.dept },
      { header: "Revenue", width: 14, fmt: money, get: (r) => r.revenue },
      { header: "GP $", width: 14, fmt: money, get: (r) => r.gp },
      { header: "Avg Margin %", width: 12, fmt: "0.0", get: (r) => r.avgMargin },
      { header: "SKU Count", width: 10, fmt: int0, get: (r) => r.skuCount },
      { header: "Stock Investment", width: 16, fmt: money, get: (r) => r.stockInvestment },
      { header: "GP ROI (×)", width: 12, fmt: "0.00", get: (r) => r.gpRoi },
    ];
    const ws = buildSheet("🏢 Department P&L", `${deptPnL.length} departments`, cols, deptPnL);
    XLSX.utils.book_append_sheet(wb, ws, "Dept P&L");
  }

  // ── Capital Release ────────────────────────────────────────────────────
  {
    const cols: Col[] = [
      { header: "Priority", width: 10, get: (r) => r.priority.toUpperCase() },
      { header: "Suggested Action", width: 36, style: wrapStyle, get: (r) => r.suggestedAction },
      ...productCols().map((c) => ({ ...c, get: (r: any) => c.get(r.product) })),
    ];
    const ws = buildSheet(
      "🧊 Capital Release",
      `${capital.rows.length} lines · ${fmtAUD(capital.totalCapital)} tied up`,
      cols,
      capital.rows,
    );
    XLSX.utils.book_append_sheet(wb, ws, "Capital Release");
  }

  // ── Action Card ────────────────────────────────────────────────────────
  {
    const cols: Col[] = [
      { header: "Bucket", width: 16, get: (r) => r.bucket },
      { header: "Priority", width: 10, get: (r) => r.priorityColor.toUpperCase() },
      { header: "Product", width: 36, get: (r) => r.product.stockName },
      { header: "Dept", width: 20, get: (r) => r.product.dept },
      { header: "Why", width: 50, style: wrapStyle, get: (r) => r.why },
      { header: "Do This", width: 50, style: wrapStyle, get: (r) => r.doThis },
      { header: "SOH", width: 8, fmt: int0, get: (r) => r.product.soh },
      { header: "Stock Value", width: 14, fmt: money, get: (r) => r.product.stockValue },
      { header: "GP $", width: 12, fmt: money, get: (r) => r.product.salesGP },
    ];
    const ws = buildSheet("📋 Action Card", `${action.length} prioritised actions`, cols, action);
    XLSX.utils.book_append_sheet(wb, ws, "Action Card");
  }

  // ── Seasonal Intel ─────────────────────────────────────────────────────
  {
    const cols: Col[] = [
      { header: "Category", width: 36, get: (r) => r.category },
      { header: "Matched SKUs", width: 14, fmt: int0, get: (r) => r.matchedSkus },
      { header: "Status", width: 16, get: (r) => r.status },
    ];
    const ws = buildSheet(
      "🌐 Seasonal Intel",
      `Current season: ${seasonal.currentSeason}`,
      cols,
      seasonal.categories,
    );
    XLSX.utils.book_append_sheet(wb, ws, "Seasonal");
  }

  // ── Demographic Coverage ───────────────────────────────────────────────
  {
    const cols: Col[] = [
      { header: "Category", width: 32, get: (r) => r.name },
      { header: "SKU Count", width: 12, fmt: int0, get: (r) => r.skuCount },
      { header: "Top Line Days Left", width: 18, fmt: int0, get: (r) => r.topLineDaysLeft ?? "" },
      { header: "Status", width: 18, get: (r) => r.status },
    ];
    const ws = buildSheet("👥 Demographic Coverage", "", cols, demo);
    XLSX.utils.book_append_sheet(wb, ws, "Demographics");
  }

  // ── Integrity ──────────────────────────────────────────────────────────
  {
    const aoa: any[][] = [];
    aoa.push([{ v: "🛡️ Integrity Report", s: titleStyle }]);
    aoa.push([{ v: `Reliability ${integrity.reliabilityScore.toFixed(1)}% · ${integrity.issueCount} issues across ${integrity.totalLines} lines`, s: subtitleStyle }]);
    aoa.push([]);
    aoa.push([{ v: `Negative SOH (${integrity.negativeSOH.length})`, s: { ...bodyStyle, font: { ...bodyStyle.font, bold: true } } }]);
    const cols = productCols();
    aoa.push(cols.map((c) => ({ v: c.header, s: hdrStyle })));
    for (const p of integrity.negativeSOH) {
      aoa.push(cols.map((c) => {
        const v = c.get(p);
        const cell: any = { v, s: c.style ?? bodyStyle };
        if (c.fmt && typeof v === "number") cell.z = c.fmt;
        return cell;
      }));
    }
    aoa.push([]);
    aoa.push([{ v: `No Cost Data (${integrity.noCostData.length})`, s: { ...bodyStyle, font: { ...bodyStyle.font, bold: true } } }]);
    aoa.push(cols.map((c) => ({ v: c.header, s: hdrStyle })));
    for (const p of integrity.noCostData) {
      aoa.push(cols.map((c) => {
        const v = c.get(p);
        const cell: any = { v, s: c.style ?? bodyStyle };
        if (c.fmt && typeof v === "number") cell.z = c.fmt;
        return cell;
      }));
    }
    aoa.push([]);
    aoa.push([{ v: `No Sell Price (${integrity.noSellPrice.length})`, s: { ...bodyStyle, font: { ...bodyStyle.font, bold: true } } }]);
    aoa.push(cols.map((c) => ({ v: c.header, s: hdrStyle })));
    for (const p of integrity.noSellPrice) {
      aoa.push(cols.map((c) => {
        const v = c.get(p);
        const cell: any = { v, s: c.style ?? bodyStyle };
        if (c.fmt && typeof v === "number") cell.z = c.fmt;
        return cell;
      }));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((c) => ({ wch: c.width }));
    XLSX.utils.book_append_sheet(wb, ws, "Integrity");
  }

  // ── Strategic Analyst Report ───────────────────────────────────────────
  {
    const aoa: any[][] = [];
    aoa.push([{ v: "✨ Strategic Analyst Report", s: titleStyle }]);
    aoa.push([{ v: `Generated ${analyst.generatedAt.toLocaleString()}`, s: subtitleStyle }]);
    aoa.push([]);
    for (const sec of analyst.sections) {
      aoa.push([{ v: sec.heading, s: { ...titleStyle, font: { ...titleStyle.font, sz: 12 } } }]);
      for (const p of sec.paragraphs) {
        aoa.push([{ v: p, s: wrapStyle }]);
      }
      if (sec.bullets) {
        for (const b of sec.bullets) {
          aoa.push([{ v: `• ${b}`, s: wrapStyle }]);
        }
      }
      aoa.push([]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 140 }];
    XLSX.utils.book_append_sheet(wb, ws, "Strategic Analyst");
  }

  // ── Cleaned Products (full) ────────────────────────────────────────────
  {
    const ws = buildSheet(
      "📦 All Cleaned Products",
      `${ds.cleanedData.length} lines (service lines excluded)`,
      productCols(),
      ds.cleanedData,
    );
    XLSX.utils.book_append_sheet(wb, ws, "All Products");
  }

  // ── Negative SOH ───────────────────────────────────────────────────────
  if (ds.negativeSOHLines.length > 0) {
    const ws = buildSheet(
      "⚠️ Negative SOH Lines",
      `${ds.negativeSOHLines.length} lines requiring stocktake`,
      productCols(),
      ds.negativeSOHLines,
    );
    XLSX.utils.book_append_sheet(wb, ws, "Negative SOH");
  }

  // ── Service Lines ──────────────────────────────────────────────────────
  if (ds.serviceLines.length > 0) {
    const ws = buildSheet(
      "🧾 Service Lines (excluded from analytics)",
      `${ds.serviceLines.length} lines`,
      productCols(),
      ds.serviceLines,
    );
    XLSX.utils.book_append_sheet(wb, ws, "Service Lines");
  }

  // suppress lint for fmtPct (kept for parity with other exports)
  void fmtPct;

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${filenamePrefix}_${stamp}.xlsx`;
  XLSX.writeFile(wb, filename);
}
