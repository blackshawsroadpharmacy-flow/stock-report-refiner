// Rule-based analysis engine for cleaned FOS Stock Report rows.
// Pure functions — no DOM, no React. Safe to test in isolation.

import { getThresholds, Thresholds } from "../config/analysisConfig";
import { normalizeBarcode } from "./barcode-utils";

export type Product = {
  stockName: string;
  fullName: string;
  apn: string;
  pde: string;
  soh: number;
  stockValue: number;
  lastPurchased: Date | null;
  lastSold: Date | null;
  qtySold: number;
  salesVal: number;
  salesGP: number;
  qtyPurchased: number;
  marginPct: number;
  categories: string;
  dept: string;
  sohEndDate: number;
  cost: number;
  avgCost: number;
  ws1Cost: number;
  ws1CostEnd: number;
  sellPrice: number;
  sellPriceEnd: number;
  // Derived
  daysSincePurchased: number | null;
  daysSinceSold: number | null;
};

export type Severity = "critical" | "warning" | "info" | "positive";

export type Flag = {
  ruleId: string;
  category: number;
  categoryLabel: string;
  severity: Severity;
  title: string;
  message: string;
  metrics: { label: string; value: string }[];
  action: string;
};

export type ProductAnalysis = {
  product: Product;
  flags: Flag[];
  score: number;
  scoreBand: "Healthy" | "Monitor" | "Action Required" | "Urgent";
};

export type AnalysisResult = {
  products: ProductAnalysis[];
  generatedAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  periodDays: number;
  totals: {
    productCount: number;
    flagCount: number;
    stockValue: number;
    salesGP: number;
    salesVal: number;
    blendedMargin: number;
    zeroSalesCount: number;
    outOfStockCount: number;
    deadStockCapital: number;
    stockoutGpAtRisk: number;
  };
  byCategory: Record<number, ProductAnalysis[]>;
};

const CATEGORY_LABELS: Record<number, string> = {
  1: "Critical — Pricing Integrity",
  2: "Inventory Risk — Dead & Ghost Stock",
  3: "Stockout Risk — Lost Sales",
  4: "Purchasing Efficiency",
  5: "Top Performers",
  6: "Data Quality",
};

// ---------- helpers ----------
const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).replace(/[$,\s%]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
};

const str = (v: any): string => {
  if (v === null || v === undefined) return "";
  return String(v).trim();
};

const parseDate = (v: any): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  // dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [_, d, mo, y] = m;
    let yy = parseInt(y, 10);
    if (yy < 100) yy += 2000;
    const dt = new Date(yy, parseInt(mo, 10) - 1, parseInt(d, 10));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
};

const daysBetween = (from: Date | null, to: Date): number | null => {
  if (!from) return null;
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
};

export const fmtAUD = (n: number): string =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);

export const fmtPct = (n: number): string => `${(n || 0).toFixed(1)}%`;

export const fmtDate = (d: Date | null): string => {
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};

// ---------- row → Product ----------
export function rowToProduct(row: any[], today: Date): Product {
  const lastPurchased = parseDate(row[6]);
  const lastSold = parseDate(row[7]);
  return {
    stockName: str(row[0]),
    fullName: str(row[1]),
    apn: normalizeBarcode(row[2]),
    pde: normalizeBarcode(row[3]),
    soh: num(row[4]),
    stockValue: num(row[5]),
    lastPurchased,
    lastSold,
    qtySold: num(row[8]),
    salesVal: num(row[9]),
    salesGP: num(row[10]),
    qtyPurchased: num(row[11]),
    marginPct: num(row[12]),
    categories: str(row[13]),
    dept: str(row[14]),
    sohEndDate: num(row[15]),
    cost: num(row[16]),
    avgCost: num(row[17]),
    ws1Cost: num(row[18]),
    ws1CostEnd: num(row[19]),
    sellPrice: num(row[20]),
    sellPriceEnd: num(row[21]),
    daysSincePurchased: daysBetween(lastPurchased, today),
    daysSinceSold: daysBetween(lastSold, today),
  };
}

// ---------- rules ----------
function evaluate(p: Product, periodDays: number): Flag[] {
  const flags: Flag[] = [];
  const push = (f: Omit<Flag, "categoryLabel">) =>
    flags.push({ ...f, categoryLabel: CATEGORY_LABELS[f.category] });

  const T = getThresholds();

  // ===== Category 1 =====
  if (p.sellPrice > 0 && p.ws1Cost > 0 && p.sellPrice < p.ws1Cost) {
    const loss = p.ws1Cost - p.sellPrice;
    push({
      ruleId: "1.1",
      category: 1,
      severity: "critical",
      title: "Selling BELOW wholesale cost — losing money on every sale",
      message: "Sell price is lower than wholesale cost.",
      metrics: [
        { label: "Sell Price", value: fmtAUD(p.sellPrice) },
        { label: "WS1 Cost", value: fmtAUD(p.ws1Cost) },
        { label: "Loss / unit", value: fmtAUD(loss) },
      ],
      action: `Review sell price immediately. Increase to at least ${fmtAUD(p.ws1Cost * 1.35)} for a healthy margin.`,
    });
  }
  if (p.marginPct > 0 && p.marginPct < T.MIN_VIABLE_MARGIN_PCT && p.qtySold > 0) {
    push({
      ruleId: "1.2",
      category: 1,
      severity: "critical",
      title: "Margin below 20% — below viable pharmacy threshold",
      message: "GP% is unhealthy for an active product.",
      metrics: [
        { label: "Margin", value: fmtPct(p.marginPct) },
        { label: "Sell Price", value: fmtAUD(p.sellPrice) },
        { label: "Cost", value: fmtAUD(p.cost) },
      ],
      action: "Target minimum 30% margin for front-of-shop products. Consider price increase or supplier negotiation.",
    });
  }
  if (p.cost > 0 && p.avgCost > 0 && p.cost > p.avgCost * T.COST_CREEP_FACTOR) {
    const diff = p.cost - p.avgCost;
    const pct = (diff / p.avgCost) * 100;
    const effMargin = p.sellPrice > 0 ? ((p.sellPrice - p.cost) / p.sellPrice) * 100 : 0;
    push({
      ruleId: "1.3",
      category: 1,
      severity: "warning",
      title: "Supplier cost has risen above historical average",
      message: "Sell price may now be under-margin.",
      metrics: [
        { label: "Current Cost", value: fmtAUD(p.cost) },
        { label: "Avg Cost", value: fmtAUD(p.avgCost) },
        { label: "Change", value: `${fmtAUD(diff)} (${pct.toFixed(1)}%)` },
        { label: "Effective Margin", value: fmtPct(effMargin) },
      ],
      action: "Check if sell price has been updated to reflect the cost increase. Consider a price review.",
    });
  }
  if (p.ws1Cost > 0 && p.ws1CostEnd > p.ws1Cost * T.COST_CREEP_FACTOR) {
    const pct = ((p.ws1CostEnd - p.ws1Cost) / p.ws1Cost) * 100;
    push({
      ruleId: "1.4",
      category: 1,
      severity: "info",
      title: "Wholesale cost increased during the report period",
      message: "End-of-period wholesale higher than start.",
      metrics: [
        { label: "WS1 Start", value: fmtAUD(p.ws1Cost) },
        { label: "WS1 End", value: fmtAUD(p.ws1CostEnd) },
        { label: "Increase", value: `${pct.toFixed(1)}%` },
      ],
      action: "Verify sell price has been adjusted to maintain margin.",
    });
  }

  // ===== Category 2 =====
  if (p.qtySold === 0 && p.soh > 0 && p.salesVal === 0) {
    push({
      ruleId: "2.1",
      category: 2,
      severity: "warning",
      title: "Dead Stock — stock on hand but zero sales in period",
      message: "Capital tied up with no movement.",
      metrics: [
        { label: "SOH", value: String(p.soh) },
        { label: "Capital tied up", value: fmtAUD(p.soh * p.cost) },
      ],
      action: `Consider markdown, return to supplier, or move to clearance. Capital tied up: ${fmtAUD(p.soh * p.cost)}.`,
    });
  }
  if (p.qtySold > 0 && p.qtySold <= T.SLOW_MOVER_MAX_QTY && p.soh > 0) {
    const days = p.qtySold > 0 ? Math.round((p.soh / p.qtySold) * periodDays) : 0;
    push({
      ruleId: "2.2",
      category: 2,
      severity: "warning",
      title: `Slow Mover — only ${p.qtySold} unit(s) sold while ${p.soh} remain`,
      message: "Very low velocity vs on-hand.",
      metrics: [
        { label: "SOH", value: String(p.soh) },
        { label: "Qty Sold", value: String(p.qtySold) },
        { label: "Days since sold", value: p.daysSinceSold == null ? "—" : String(p.daysSinceSold) },
      ],
      action: `Review facing and placement. At current rate, ${p.soh} units ≈ ${days} days of stock remaining.`,
    });
  }
  if (p.daysSincePurchased !== null && p.daysSincePurchased > T.GHOST_STOCK_DAYS && p.soh > 0) {
    push({
      ruleId: "2.3",
      category: 2,
      severity: "warning",
      title: `Ghost Stock — no reorder in over ${p.daysSincePurchased} days`,
      message: `${p.soh} units still on shelf.`,
      metrics: [
        { label: "Last Purchased", value: fmtDate(p.lastPurchased) },
        { label: "SOH", value: String(p.soh) },
        { label: "Stock Value", value: fmtAUD(p.stockValue) },
      ],
      action: "Verify physical stock count. Product may be discontinued or superseded.",
    });
  }
  if (p.daysSinceSold !== null && p.daysSinceSold > T.STALE_SOLD_DAYS && p.soh > 0) {
    push({
      ruleId: "2.4",
      category: 2,
      severity: "warning",
      title: `Stale Stock — last customer sale was ${p.daysSinceSold} days ago`,
      message: "Long-dormant SKU.",
      metrics: [
        { label: "Last Sold", value: fmtDate(p.lastSold) },
        { label: "SOH", value: String(p.soh) },
      ],
      action: "Check expiry dates immediately. Consider write-off or clearance.",
    });
  }
  if (
    p.qtySold === 0 &&
    p.qtyPurchased === 0 &&
    p.lastSold === null &&
    p.lastPurchased === null
  ) {
    push({
      ruleId: "2.5",
      category: 2,
      severity: "warning",
      title: "Zero Activity — no movement at all in this period",
      message: "Possibly de-ranged or inactive.",
      metrics: [
        { label: "SOH", value: String(p.soh) },
        { label: "Stock Value", value: fmtAUD(p.stockValue) },
      ],
      action: "Investigate whether product is still ranged. May need to be deactivated in system.",
    });
  }

  // ===== Category 3 =====
  if (
    p.soh === 0 &&
    p.qtySold > 0 &&
    (p.daysSinceSold === null || p.daysSinceSold < T.STOCKOUT_MAX_DAYS_SINCE_SOLD)
  ) {
    const gpPerUnit = p.qtySold > 0 ? p.salesGP / p.qtySold : 0;
    const monthlyLost = (p.salesGP / Math.max(periodDays, 1)) * 30;
    push({
      ruleId: "3.1",
      category: 3,
      severity: "critical",
      title: `STOCKOUT — sold ${p.qtySold} units this period but currently OUT OF STOCK`,
      message: "Active SKU is unavailable.",
      metrics: [
        { label: "Qty Sold", value: String(p.qtySold) },
        { label: "Sales Val", value: fmtAUD(p.salesVal) },
        { label: "Sales GP", value: fmtAUD(p.salesGP) },
        { label: "Last Sold", value: fmtDate(p.lastSold) },
      ],
      action: `Reorder immediately. Lost GP ≈ ${fmtAUD(gpPerUnit)} per unit. Approx ${fmtAUD(monthlyLost)}/month in lost margin.`,
    });
  }
  if (p.soh > 0 && p.soh <= T.LOW_STOCK_MAX_SOH && p.qtySold >= T.LOW_STOCK_MIN_QTY_SOLD) {
    const days = p.qtySold > 0 ? Math.round((p.soh / p.qtySold) * periodDays) : 0;
    push({
      ruleId: "3.2",
      category: 3,
      severity: "warning",
      title: `Low Stock on a Fast Mover — only ${p.soh} unit(s) left`,
      message: `${p.qtySold} units sold in period.`,
      metrics: [
        { label: "SOH", value: String(p.soh) },
        { label: "Qty Sold", value: String(p.qtySold) },
        { label: "Days of stock left", value: String(days) },
      ],
      action: `Reorder urgently. Approx ${days} days of stock remaining at current sell rate.`,
    });
  }
  if (p.soh === 0 && p.daysSinceSold !== null && p.daysSinceSold < T.STOCKOUT_MAX_DAYS_SINCE_SOLD) {
    push({
      ruleId: "3.3",
      category: 3,
      severity: "warning",
      title: `Recent stockout — sold out within the last ${p.daysSinceSold} days`,
      message: "Recently active, now empty.",
      metrics: [
        { label: "Last Sold", value: fmtDate(p.lastSold) },
        { label: "Qty Sold", value: String(p.qtySold) },
      ],
      action: "Confirm whether reorder has been placed.",
    });
  }

  // ===== Category 4 =====
  if (p.qtyPurchased > p.qtySold * T.OVER_BOUGHT_FACTOR && p.qtyPurchased > T.OVER_BOUGHT_MIN_QTY && p.soh > 0) {
    const excess = p.qtyPurchased - p.qtySold;
    const tied = p.soh * p.cost;
    push({
      ruleId: "4.1",
      category: 4,
      severity: "warning",
      title: `Over-bought — purchased ${p.qtyPurchased} units but only sold ${p.qtySold}`,
      message: "Buying outpaces sales.",
      metrics: [
        { label: "Qty Purchased", value: String(p.qtyPurchased) },
        { label: "Qty Sold", value: String(p.qtySold) },
        { label: "SOH", value: String(p.soh) },
        { label: "Excess units", value: String(excess) },
        { label: "Capital tied up", value: fmtAUD(tied) },
      ],
      action: `Review order quantities. Consider reducing to match actual demand. ${fmtAUD(tied)} tied up in excess stock.`,
    });
  }
  if (p.qtyPurchased < p.qtySold && p.soh === 0 && p.qtySold > T.UNDER_BOUGHT_MIN_QTY_SOLD) {
    const shortfall = p.qtySold - p.qtyPurchased;
    const suggested = Math.ceil(shortfall * 1.2);
    push({
      ruleId: "4.2",
      category: 4,
      severity: "warning",
      title: `Under-ordered — sold ${p.qtySold} units but only bought ${p.qtyPurchased}`,
      message: "Ran out before next order.",
      metrics: [
        { label: "Qty Purchased", value: String(p.qtyPurchased) },
        { label: "Qty Sold", value: String(p.qtySold) },
        { label: "Shortfall", value: String(shortfall) },
      ],
      action: `Increase standing order by at least ${suggested} units per period.`,
    });
  }
  if (
    p.lastPurchased !== null &&
    p.lastSold !== null &&
    p.daysSincePurchased !== null &&
    p.daysSinceSold !== null &&
    p.daysSincePurchased > p.daysSinceSold + T.REACTIVE_ORDER_GAP_DAYS
  ) {
    push({
      ruleId: "4.3",
      category: 4,
      severity: "info",
      title: "Purchased well after last sale — possible reactive ordering",
      message: "Long gap between last purchase and last sale.",
      metrics: [
        { label: "Last Purchased", value: fmtDate(p.lastPurchased) },
        { label: "Last Sold", value: fmtDate(p.lastSold) },
        { label: "Gap (days)", value: String(p.daysSincePurchased - p.daysSinceSold) },
      ],
      action: "Consider setting a minimum reorder point to avoid stockouts before next purchase.",
    });
  }

  // ===== Category 5 =====
  if (
    p.salesGP > T.STAR_MIN_GP &&
    p.marginPct > T.STAR_MIN_MARGIN_PCT &&
    p.qtySold > T.STAR_MIN_QTY_SOLD &&
    p.daysSinceSold !== null &&
    p.daysSinceSold < T.STAR_MAX_DAYS_SINCE_SOLD
  ) {
    push({
      ruleId: "5.1",
      category: 5,
      severity: "positive",
      title: "Star Performer — strong GP and regular sales",
      message: "Hitting on all metrics.",
      metrics: [
        { label: "Sales GP", value: fmtAUD(p.salesGP) },
        { label: "Margin", value: fmtPct(p.marginPct) },
        { label: "Qty Sold", value: String(p.qtySold) },
        { label: "Sales Val", value: fmtAUD(p.salesVal) },
      ],
      action: "Protect range position. Ensure consistent stock. Consider expanding to related products.",
    });
  }
  if (p.marginPct > T.HIGH_MARGIN_MIN_PCT && p.qtySold > 0) {
    push({
      ruleId: "5.2",
      category: 5,
      severity: "positive",
      title: `High Margin Product — ${p.marginPct.toFixed(1)}% GP`,
      message: "Excellent margin contributor.",
      metrics: [
        { label: "Margin", value: fmtPct(p.marginPct) },
        { label: "Sales GP", value: fmtAUD(p.salesGP) },
        { label: "Sell Price", value: fmtAUD(p.sellPrice) },
        { label: "Cost", value: fmtAUD(p.cost) },
      ],
      action: "Prioritise placement and staff recommendation. High-value contributor.",
    });
  }
  if (p.qtySold >= T.FAST_MOVER_MIN_QTY) {
    push({
      ruleId: "5.3",
      category: 5,
      severity: "positive",
      title: `Fast Mover — ${p.qtySold} units sold this period`,
      message: "Top velocity.",
      metrics: [
        { label: "Qty Sold", value: String(p.qtySold) },
        { label: "Sales Val", value: fmtAUD(p.salesVal) },
        { label: "Sales GP", value: fmtAUD(p.salesGP) },
        { label: "SOH", value: String(p.soh) },
      ],
      action: "Never let this go out of stock. Consider increasing par level.",
    });
  }

  // ===== Category 6 =====
  if (p.sellPrice > 0 && p.cost > 0 && p.sellPrice < p.cost) {
    push({
      ruleId: "6.1",
      category: 6,
      severity: "critical",
      title: `DATA ERROR — sell price ${fmtAUD(p.sellPrice)} is BELOW cost ${fmtAUD(p.cost)}`,
      message: "Sell price below cost.",
      metrics: [
        { label: "Sell Price", value: fmtAUD(p.sellPrice) },
        { label: "Cost", value: fmtAUD(p.cost) },
      ],
      action: "Check pricing in Z Office. This product is being given away at a loss.",
    });
  }
  if (p.sellPrice === 0 && p.soh > 0) {
    push({
      ruleId: "6.2",
      category: 6,
      severity: "warning",
      title: "No sell price set — product cannot be sold through Shopify",
      message: "Sell price is zero with stock on hand.",
      metrics: [{ label: "SOH", value: String(p.soh) }],
      action: "Set a sell price in Z Office or Shopify admin.",
    });
  }
  if (p.cost === 0 && p.qtySold > 0) {
    push({
      ruleId: "6.3",
      category: 6,
      severity: "warning",
      title: "Zero cost recorded but product has sold — margin data unreliable",
      message: "Cost missing.",
      metrics: [
        { label: "Qty Sold", value: String(p.qtySold) },
        { label: "Sales Val", value: fmtAUD(p.salesVal) },
      ],
      action: "Update cost price in Z Office to get accurate GP reporting.",
    });
  }
  if (p.dept === "" && p.categories === "" && p.qtySold > 3) {
    push({
      ruleId: "6.4",
      category: 6,
      severity: "info",
      title: "No department or category assigned",
      message: "Limits reporting accuracy.",
      metrics: [{ label: "Qty Sold", value: String(p.qtySold) }],
      action: "Assign a department in Z Office to enable category-level analysis.",
    });
  }

  return flags;
}

function scoreProduct(p: Product, T: ReturnType<typeof getThresholds>): number {
  let score = 100;
  if (p.sellPrice > 0 && p.ws1Cost > 0 && p.sellPrice < p.ws1Cost) score -= T.SCORE_BELOW_WHOLESALE;
  if (p.marginPct > 0 && p.marginPct < T.MIN_VIABLE_MARGIN_PCT) score -= T.SCORE_LOW_MARGIN;
  if (
    p.soh === 0 &&
    p.daysSinceSold !== null &&
    p.daysSinceSold < T.STOCKOUT_MAX_DAYS_SINCE_SOLD &&
    p.qtySold > 0
  )
    score -= T.SCORE_STOCKOUT;
  if (p.qtySold === 0 && p.soh > 0) score -= T.SCORE_DEAD_STOCK;
  if (p.daysSinceSold !== null && p.daysSinceSold > T.STALE_PENALTY_DAYS) score -= T.SCORE_STALE_180;
  if (p.cost > 0 && p.avgCost > 0 && p.cost > p.avgCost * T.COST_CREEP_FACTOR) score -= T.SCORE_COST_CREEP;
  if (p.marginPct > T.HEALTHY_MARGIN_PCT) score += T.SCORE_HIGH_MARGIN_BONUS;
  if (p.qtySold >= T.FAST_MOVER_MIN_QTY) score += T.SCORE_FAST_MOVER_BONUS;
  if (p.salesGP > T.STAR_MIN_GP) score += T.SCORE_HIGH_GP_BONUS;
  return Math.max(0, Math.min(100, score));
}

function bandFor(score: number, T: ReturnType<typeof getThresholds>): ProductAnalysis["scoreBand"] {
  if (score >= T.BAND_HEALTHY_MIN) return "Healthy";
  if (score >= T.BAND_MONITOR_MIN) return "Monitor";
  if (score >= T.BAND_ACTION_MIN) return "Action Required";
  return "Urgent";
}

export function analyze(rows: any[][]): AnalysisResult {
  const today = new Date();

  // First pass: build products and find period boundaries
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

  const T = getThresholds();

  const analyses: ProductAnalysis[] = products.map((p) => {
    const flags = evaluate(p, periodDays);
    const score = scoreProduct(p, T);
    return { product: p, flags, score, scoreBand: bandFor(score, T) };
  });

  // Totals
  let stockValue = 0;
  let salesGP = 0;
  let salesVal = 0;
  let zeroSalesCount = 0;
  let outOfStockCount = 0;
  let deadStockCapital = 0;
  let stockoutGpAtRisk = 0;
  let flagCount = 0;

  for (const a of analyses) {
    const p = a.product;
    stockValue += p.stockValue;
    salesGP += p.salesGP;
    salesVal += p.salesVal;
    if (p.qtySold === 0) zeroSalesCount++;
    if (p.soh === 0) outOfStockCount++;
    if (p.qtySold === 0 && p.soh > 0) deadStockCapital += p.soh * p.cost;
    if (p.soh === 0 && p.qtySold > 0) {
      const monthlyGp = (p.salesGP / Math.max(periodDays, 1)) * 30;
      stockoutGpAtRisk += monthlyGp;
    }
    flagCount += a.flags.length;
  }

  const blendedMargin = salesVal > 0 ? (salesGP / salesVal) * 100 : 0;

  // By category
  const byCategory: Record<number, ProductAnalysis[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const a of analyses) {
    const cats = Array.from(new Set(a.flags.map((f) => f.category)));
    for (const c of cats) byCategory[c].push(a);
  }
  // Sort top performers desc by salesGP
  byCategory[5].sort((a, b) => b.product.salesGP - a.product.salesGP);

  return {
    products: analyses,
    generatedAt: today,
    periodStart,
    periodEnd,
    periodDays,
    totals: {
      productCount: analyses.length,
      flagCount,
      stockValue,
      salesGP,
      salesVal,
      blendedMargin,
      zeroSalesCount,
      outOfStockCount,
      deadStockCapital,
      stockoutGpAtRisk,
    },
    byCategory,
  };
}
