// Deeper Dive Analysis utilities — pure functions only.
// All calculations are deterministic, in-memory, no network calls.
// Consumes the existing ProductAnalysis[] from fos-analyzer.ts.

import type { Product, ProductAnalysis } from "./fos-analyzer";
import { fmtAUD, fmtPct } from "./fos-analyzer";
import { getThresholds } from "@/config/analysisConfig";

// ─── Cleaned product (extends Product with derived fields) ────────────────
export type CleanedProduct = Product & {
  flagsString: string; // comma-joined flag labels (rebuilt from analysis)
  daysOfStockLeft: number | null;
  scoreBand: ProductAnalysis["scoreBand"];
  score: number;
};

export type CleanedDataset = {
  cleanedData: CleanedProduct[];
  negativeSOHLines: CleanedProduct[];
  integrityIssues: CleanedProduct[];
  serviceLines: CleanedProduct[];
  generatedAt: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────
export const safeDivide = (a: number, b: number): number => (b === 0 ? 0 : a / b);

const SERVICE_NAME_PATTERNS = [
  "SURCHARGE",
  "DELIVERY FEE",
  "DELIVERY - ",
  "WEBSTER - CHARGE",
  "VACCINATION SERVICE",
  "ACCOUNT FEE",
  "SCRIPT FEE",
];

function isServiceLine(p: Product): boolean {
  if (p.dept === "PHARMACIST SERVICE CHARGES") return true;
  if (p.dept === "Medication Weekly Packs" && p.cost === 0) return true;
  const upper = (p.stockName || "").toUpperCase();
  return SERVICE_NAME_PATTERNS.some((pat) => upper.includes(pat));
}

function flagLabelsForProduct(pa: ProductAnalysis): string[] {
  const labels = new Set<string>();
  for (const f of pa.flags) {
    switch (f.ruleId) {
      case "1.1":
        labels.add("BELOW WHOLESALE");
        break;
      case "1.2":
        labels.add("LOW MARGIN <20%");
        break;
      case "1.3":
        labels.add("COST CREEP");
        break;
      case "2.1":
        labels.add("DEAD STOCK");
        break;
      case "2.3":
        labels.add("GHOST STOCK");
        break;
      case "2.4":
        labels.add("STALE >365d");
        break;
      case "3.1":
      case "3.3":
        labels.add("STOCKOUT");
        break;
      case "3.2":
        labels.add("LOW STOCK");
        break;
      case "4.1":
        labels.add("OVER-BOUGHT");
        break;
      case "4.2":
        labels.add("UNDER-BOUGHT");
        break;
      case "5.1":
        labels.add("★ STAR");
        break;
      case "5.2":
        labels.add("◆ HIGH MARGIN");
        break;
      case "5.3":
        labels.add("⚡ FAST MOVER");
        break;
      case "6.1":
        labels.add("BELOW COST");
        break;
      case "6.2":
        labels.add("NO SELL PRICE");
        break;
      case "6.3":
        labels.add("NO COST DATA");
        break;
    }
  }
  return Array.from(labels);
}

function computeDaysOfStockLeft(p: Product, periodDays: number): number | null {
  if (p.qtySold <= 0 || periodDays <= 0 || p.soh <= 0) return null;
  const dailyRate = p.qtySold / periodDays;
  if (dailyRate <= 0) return null;
  return Math.round(p.soh / dailyRate);
}

// ─── 1. Clean dataset ─────────────────────────────────────────────────────
export function cleanDataset(
  analyses: ProductAnalysis[],
  periodDays: number,
): CleanedDataset {
  const serviceLines: CleanedProduct[] = [];
  const negativeSOHLines: CleanedProduct[] = [];
  const integrityIssues: CleanedProduct[] = [];
  const cleanedData: CleanedProduct[] = [];

  for (const pa of analyses) {
    const p = pa.product;

    // Rule 4: phantom lines
    if (
      p.cost === 0 &&
      p.sellPrice === 0 &&
      p.soh === 0 &&
      p.salesVal === 0 &&
      p.qtySold === 0
    ) {
      continue;
    }

    let labels = flagLabelsForProduct(pa);

    // Rule 2: NDSS zero-price false positives
    if (p.dept === "NDSS" && p.sellPrice < 2.0) {
      labels = labels.filter((l) => l !== "BELOW WHOLESALE");
    }

    const cleaned: CleanedProduct = {
      ...p,
      flagsString: labels.join(", "),
      daysOfStockLeft: computeDaysOfStockLeft(p, periodDays),
      scoreBand: pa.scoreBand,
      score: pa.score,
    };

    // Rule 1: service lines excluded from main analytics
    if (isServiceLine(p)) {
      serviceLines.push(cleaned);
      continue;
    }

    // Rule 3: negative SOH quarantine
    if (p.soh < 0) {
      negativeSOHLines.push(cleaned);
      integrityIssues.push(cleaned);
      // Per spec: "Keep in cleanedData for sales history reference only"
      cleanedData.push(cleaned);
      continue;
    }

    // Rule 5: integrity issues
    if (p.cost === 0 && p.soh > 0) integrityIssues.push(cleaned);
    else if ((p.sellPrice === 0 || p.sellPrice === null) && p.soh > 0)
      integrityIssues.push(cleaned);

    cleanedData.push(cleaned);
  }

  return {
    cleanedData,
    negativeSOHLines,
    integrityIssues,
    serviceLines,
    generatedAt: new Date(),
  };
}

// ─── 2. Profit Engine ─────────────────────────────────────────────────────
export type ProfitEngineRow = {
  rank: number;
  product: CleanedProduct;
};

export type ProfitEngineResult = {
  top20: ProfitEngineRow[];
  top20GpSum: number;
  totalGp: number;
  top20GpPct: number;
  starsAtRisk: CleanedProduct[];
};

export function buildProfitEngine(data: CleanedProduct[]): ProfitEngineResult {
  const T = getThresholds();
  // Exclude negative SOH from totals (per spec)
  const positive = data.filter((p) => p.soh >= 0);
  const totalGp = positive.reduce((s, p) => s + p.salesGP, 0);
  const sorted = [...positive].sort((a, b) => b.salesGP - a.salesGP);
  const top20Items = sorted.slice(0, 20);
  const top20: ProfitEngineRow[] = top20Items.map((p, i) => ({
    rank: i + 1,
    product: p,
  }));
  const top20GpSum = top20Items.reduce((s, p) => s + p.salesGP, 0);
  const top20GpPct = safeDivide(top20GpSum, totalGp) * 100;

  const starsAtRisk = positive.filter(
    (p) =>
      p.marginPct > T.STAR_MIN_MARGIN_PCT &&
      p.salesVal > 1000 &&
      p.daysOfStockLeft !== null &&
      p.daysOfStockLeft < T.STOCKOUT_MAX_DAYS_SINCE_SOLD,
  );

  return { top20, top20GpSum, totalGp, top20GpPct, starsAtRisk };
}

// ─── 3. Department P&L ────────────────────────────────────────────────────
export type DeptPnLRow = {
  dept: string;
  revenue: number;
  gp: number;
  avgMargin: number;
  skuCount: number;
  stockInvestment: number;
  gpRoi: number;
};

export function buildDeptPnL(data: CleanedProduct[]): DeptPnLRow[] {
  const byDept = new Map<string, CleanedProduct[]>();
  for (const p of data) {
    const key = p.dept || "(unassigned)";
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key)!.push(p);
  }
  const rows: DeptPnLRow[] = [];
  for (const [dept, items] of byDept) {
    const revenue = items.reduce((s, p) => s + p.salesVal, 0);
    const gp = items.reduce((s, p) => s + p.salesGP, 0);
    const marginItems = items.filter((p) => p.marginPct > 0);
    const avgMargin =
      marginItems.length > 0
        ? marginItems.reduce((s, p) => s + p.marginPct, 0) / marginItems.length
        : 0;
    const stockInvestment = items
      .filter((p) => p.soh >= 0)
      .reduce((s, p) => s + p.stockValue, 0);
    rows.push({
      dept,
      revenue,
      gp,
      avgMargin,
      skuCount: items.length,
      stockInvestment,
      gpRoi: safeDivide(gp, stockInvestment),
    });
  }
  rows.sort((a, b) => b.gp - a.gp);
  return rows;
}

// ─── 4. Capital Release ───────────────────────────────────────────────────
export type CapitalReleaseRow = {
  product: CleanedProduct;
  suggestedAction: string;
  priority: "high" | "medium" | "low";
};

export type CapitalReleaseResult = {
  rows: CapitalReleaseRow[];
  totalCapital: number;
  hasCovidStock: boolean;
};

export function buildCapitalRelease(data: CleanedProduct[]): CapitalReleaseResult {
  const T = getThresholds();
  const matches = data.filter(
    (p) =>
      p.soh > 0 &&
      ((p.daysSinceSold !== null && p.daysSinceSold > T.CAPITAL_RELEASE_MIN_DAYS_SINCE_SOLD) || p.salesVal === 0),
  );
  matches.sort((a, b) => b.stockValue - a.stockValue);

  const rows: CapitalReleaseRow[] = matches.map((p) => {
    let suggestedAction: string;
    if (p.salesVal === 0 || (p.daysSinceSold !== null && p.daysSinceSold > T.STALE_SOLD_DAYS)) {
      suggestedAction = "Return to supplier or donate";
    } else {
      suggestedAction = "Markdown 20% — move to clearance shelf";
    }
    let priority: CapitalReleaseRow["priority"] = "low";
    if (p.stockValue > T.CAPITAL_RELEASE_HIGH_PRIORITY_THRESHOLD) priority = "high";
    else if (p.stockValue >= T.CAPITAL_RELEASE_MEDIUM_PRIORITY_THRESHOLD) priority = "medium";
    return { product: p, suggestedAction, priority };
  });

  const totalCapital = matches.reduce((s, p) => s + p.stockValue, 0);
  const hasCovidStock = matches.some((p) => {
    const u = (p.stockName || "").toUpperCase();
    return u.includes("COVID") || u.includes("ANTIGEN") || u.includes("RAT");
  });

  return { rows, totalCapital, hasCovidStock };
}

// ─── 5. Action Card ───────────────────────────────────────────────────────
export type ActionRow = {
  bucket: "PRICE FIX" | "REORDER NOW" | "CLEAR STOCK" | "STOCKTAKE" | "INVESTIGATE";
  priorityColor: "red" | "orange" | "yellow";
  product: CleanedProduct;
  why: string;
  doThis: string;
};

const round05 = (n: number): number => Math.round(n * 20) / 20;

export function buildActionCard(
  cleanedData: CleanedProduct[],
  negativeSOHLines: CleanedProduct[],
  profitEngine: ProfitEngineResult,
): ActionRow[] {
  const T = getThresholds();
  const out: ActionRow[] = [];
  const top20Set = new Set(profitEngine.top20.map((r) => r.product.pde || r.product.stockName));

  // Bucket A — PRICE FIX
  const priceFixCandidates = cleanedData
    .filter(
      (p) =>
        p.flagsString.includes("BELOW WHOLESALE") &&
        p.soh > 0 &&
        p.dept !== "NDSS" &&
        p.dept !== "PHARMACIST SERVICE CHARGES",
    )
    .map((p) => ({ p, loss: Math.max(0, p.ws1Cost - p.sellPrice) }))
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 5);
  for (const { p, loss } of priceFixCandidates) {
    out.push({
      bucket: "PRICE FIX",
      priorityColor: "red",
      product: p,
      why: `Selling ${fmtAUD(loss)} below WS1 cost (sell ${fmtAUD(p.sellPrice)} vs WS1 ${fmtAUD(p.ws1Cost)})`,
      doThis: `Update sell price to ${fmtAUD(round05(p.ws1Cost * T.ACTION_CARD_PRICE_FIX_SELL_PRICE_FACTOR))} in Z Office`,
    });
  }

  // Bucket B — REORDER NOW
  const reorderCandidates = cleanedData
    .filter(
      (p) =>
        (top20Set.has(p.pde || p.stockName) || (p.marginPct > T.STAR_MIN_MARGIN_PCT && p.salesVal > 1000)) &&
        p.daysOfStockLeft !== null &&
        p.daysOfStockLeft < T.ACTION_CARD_REORDER_MIN_STOCKOUT_DAYS,
    )
    .sort((a, b) => b.salesGP - a.salesGP)
    .slice(0, 5);
  for (const p of reorderCandidates) {
    const dailyRate = p.qtySold > 0 ? p.qtySold / 365 : 0;
    const orderQty = Math.max(1, Math.ceil(T.ACTION_CARD_REORDER_DAILY_SALES_MULTIPLIER * dailyRate));
    out.push({
      bucket: "REORDER NOW",
      priorityColor: "red",
      product: p,
      why: `${p.daysOfStockLeft}d stock left · GP ${fmtAUD(p.salesGP)} · margin ${fmtPct(p.marginPct)}`,
      doThis: `Order ${orderQty} units from usual supplier`,
    });
  }

  // Bucket C — CLEAR STOCK
  const clearCandidates = cleanedData
    .filter(
      (p) =>
        p.stockValue > T.ACTION_CARD_CLEAR_STOCK_MIN_VALUE &&
        ((p.daysSinceSold !== null && p.daysSinceSold > T.STALE_SOLD_DAYS) || p.salesVal === 0) &&
        p.soh > 0,
    )
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, 5);
  for (const p of clearCandidates) {
    out.push({
      bucket: "CLEAR STOCK",
      priorityColor: "orange",
      product: p,
      why: `${fmtAUD(p.stockValue)} tied up · ${p.daysSinceSold === null ? "never sold" : `${p.daysSinceSold}d since sale`}`,
      doThis: `Move to clearance shelf — mark down to ${fmtAUD(round05(p.cost * T.ACTION_CARD_CLEAR_STOCK_MARKDOWN_FACTOR))}`,
    });
  }

  // Bucket D — STOCKTAKE (negative SOH)
  const stocktakeCandidates = [...negativeSOHLines]
    .sort((a, b) => Math.abs(b.soh * b.cost) - Math.abs(a.soh * a.cost))
    .slice(0, 5);
  for (const p of stocktakeCandidates) {
    out.push({
      bucket: "STOCKTAKE",
      priorityColor: "yellow",
      product: p,
      why: `Negative SOH: ${p.soh} units · implied error ${fmtAUD(Math.abs(p.soh * p.cost))}`,
      doThis: "Count physical stock — enter correct SOH in Z Office",
    });
  }

  // Bucket E — INVESTIGATE
  const investigateCandidates = cleanedData
    .filter(
      (p) =>
        p.soh > 0 &&
        (p.flagsString.includes("NO SELL PRICE") ||
          p.flagsString.includes("NO COST DATA") ||
          p.flagsString.includes("COST CREEP")),
    )
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, 5);
  for (const p of investigateCandidates) {
    let doThis = "Check pricing & cost in Z Office";
    let why = "";
    if (p.flagsString.includes("NO SELL PRICE")) {
      doThis = "Set sell price in Z Office and Shopify admin";
      why = "No sell price set";
    } else if (p.flagsString.includes("NO COST DATA")) {
      doThis = "Enter supplier cost in Z Office product file";
      why = "No cost recorded";
    } else if (p.flagsString.includes("COST CREEP")) {
      doThis = "Check latest invoice — cost has increased since last order";
      why = `Cost ${fmtAUD(p.cost)} > avg ${fmtAUD(p.avgCost)}`;
    }
    out.push({
      bucket: "INVESTIGATE",
      priorityColor: "yellow",
      product: p,
      why,
      doThis,
    });
  }

  return out;
}

// ─── 6. Integrity Report ──────────────────────────────────────────────────
export type IntegrityReport = {
  reliabilityScore: number;
  totalLines: number;
  issueCount: number;
  negativeSOH: CleanedProduct[];
  noCostData: CleanedProduct[];
  noSellPrice: CleanedProduct[];
};

export function buildIntegrityReport(ds: CleanedDataset): IntegrityReport {
  const totalLines = ds.cleanedData.length;
  const negativeSOH = ds.negativeSOHLines;
  const noCostData = ds.cleanedData.filter((p) => p.cost === 0 && p.soh > 0);
  const noSellPrice = ds.cleanedData.filter(
    (p) => (p.sellPrice === 0 || p.sellPrice === null) && p.soh > 0,
  );
  const issueCount = ds.integrityIssues.length;
  const reliabilityScore =
    totalLines > 0 ? ((totalLines - issueCount) / totalLines) * 100 : 0;
  return {
    reliabilityScore,
    totalLines,
    issueCount,
    negativeSOH: [...negativeSOH].sort(
      (a, b) => Math.abs(b.soh * b.cost) - Math.abs(a.soh * a.cost),
    ),
    noCostData: [...noCostData].sort((a, b) => b.stockValue - a.stockValue),
    noSellPrice: [...noSellPrice].sort((a, b) => b.stockValue - a.stockValue),
  };
}

// ─── 7. Seasonal Intelligence ─────────────────────────────────────────────
export const SEASONAL_CALENDAR: Record<string, string[]> = {
  "January-February": [
    "Sunscreen & UV protection",
    "Insect repellent",
    "Travel health & vaccines",
    "Hydration & electrolytes",
  ],
  "March-April": [
    "Hayfever & allergy",
    "Vitamin C & immune support",
    "Cold & flu prevention",
    "Ear & sinus",
  ],
  "May-June": [
    "Flu vaccines (stock NOW)",
    "Cold & flu OTC",
    "Sinus decongestants",
    "Vitamin D",
    "Cough preparations",
  ],
  "July-August": [
    "Flu season peak",
    "Pain relief",
    "Hot water bottles & heat packs",
    "Digestive health",
  ],
  "September-October": [
    "Hayfever peak",
    "Spring allergy",
    "Sunscreen build-up begins",
    "Skin care",
  ],
  "November-December": [
    "Sunscreen & UV",
    "Insect repellent",
    "Travel health",
    "Gifting & cosmetics",
    "Hydration",
  ],
};

// Keyword maps: each seasonal category → keywords matched against dept/category/name
const SEASONAL_KEYWORDS: Record<string, string[]> = {
  "Sunscreen & UV protection": ["SUNSCREEN", "SPF", "SUN BLOCK", "UV"],
  "Sunscreen & UV": ["SUNSCREEN", "SPF", "SUN BLOCK", "UV"],
  "Sunscreen build-up begins": ["SUNSCREEN", "SPF", "UV"],
  "Insect repellent": ["INSECT", "REPELLENT", "MOSQUITO", "AEROGARD", "BUSHMAN"],
  "Travel health & vaccines": ["TRAVEL", "ANTI-MALARIA", "MOTION SICKNESS"],
  "Travel health": ["TRAVEL", "MOTION SICKNESS"],
  "Hydration & electrolytes": ["HYDRA", "ELECTROLYTE", "HYDRALYTE", "GASTROLYTE"],
  Hydration: ["HYDRA", "ELECTROLYTE"],
  "Hayfever & allergy": ["HAYFEVER", "ALLERGY", "ANTIHISTAMINE", "CLARATYNE", "TELFAST", "ZYRTEC"],
  "Hayfever peak": ["HAYFEVER", "ALLERGY", "ANTIHISTAMINE"],
  "Spring allergy": ["ALLERGY", "HAYFEVER"],
  "Vitamin C & immune support": ["VITAMIN C", "IMMUNE", "ECHINACEA", "ZINC"],
  "Cold & flu prevention": ["COLD", "FLU", "IMMUNE", "VITAMIN C"],
  "Ear & sinus": ["EAR", "SINUS"],
  "Flu vaccines (stock NOW)": ["FLU VAC", "INFLUENZA"],
  "Cold & flu OTC": ["COLD", "FLU", "DECONGESTANT", "PARACETAMOL", "IBUPROFEN"],
  "Sinus decongestants": ["SINUS", "DECONGESTANT", "SUDAFED"],
  "Vitamin D": ["VITAMIN D"],
  "Cough preparations": ["COUGH", "EXPECTORANT", "BENADRYL", "DURO-TUSS"],
  "Flu season peak": ["FLU", "COLD", "PARACETAMOL", "COUGH"],
  "Pain relief": ["PAIN", "PARACETAMOL", "IBUPROFEN", "PANADOL", "NUROFEN"],
  "Hot water bottles & heat packs": ["HEAT PACK", "HOT WATER", "WHEAT BAG"],
  "Digestive health": ["DIGEST", "PROBIOTIC", "LAXATIVE", "CONSTIPATION"],
  "Skin care": ["MOISTURISER", "SKIN", "CREAM", "DERMAL"],
  "Gifting & cosmetics": ["GIFT", "COSMETIC", "FRAGRANCE", "PERFUME"],
};

export type SeasonalCategoryStatus = {
  category: string;
  matchedSkus: number;
  status: "WELL STOCKED" | "LOW STOCK" | "CHECK RANGE";
};

export type SeasonalIntel = {
  currentSeason: string;
  categories: SeasonalCategoryStatus[];
};

function currentSeasonKey(d: Date): string {
  const m = d.getMonth() + 1;
  if (m === 1 || m === 2) return "January-February";
  if (m === 3 || m === 4) return "March-April";
  if (m === 5 || m === 6) return "May-June";
  if (m === 7 || m === 8) return "July-August";
  if (m === 9 || m === 10) return "September-October";
  return "November-December";
}

function matchesKeywords(p: CleanedProduct, keywords: string[]): boolean {
  const blob = `${p.stockName} ${p.dept} ${p.categories}`.toUpperCase();
  return keywords.some((k) => blob.includes(k));
}

export function buildSeasonalIntel(
  data: CleanedProduct[],
  today: Date = new Date(),
): SeasonalIntel {
  const T = getThresholds();
  const season = currentSeasonKey(today);
  const cats = SEASONAL_CALENDAR[season];
  const categories: SeasonalCategoryStatus[] = cats.map((cat) => {
    const keywords = SEASONAL_KEYWORDS[cat] || [];
    const matched = data.filter((p) => p.soh > 0 && matchesKeywords(p, keywords));
    let status: SeasonalCategoryStatus["status"] = "WELL STOCKED";
    if (matched.length === 0) status = "CHECK RANGE";
    else {
      const anyLow = matched.some(
        (p) => p.daysOfStockLeft !== null && p.daysOfStockLeft < T.ACTION_CARD_REORDER_MIN_STOCKOUT_DAYS,
      );
      const allHigh = matched.every(
        (p) => p.daysOfStockLeft === null || p.daysOfStockLeft > 60,
      );
      if (anyLow) status = "LOW STOCK";
      else if (!allHigh) status = "WELL STOCKED";
    }
    return { category: cat, matchedSkus: matched.length, status };
  });
  return { currentSeason: season, categories };
}

// ─── 8. Demographic Coverage ──────────────────────────────────────────────
export const DEMOGRAPHIC_CATEGORIES = [
  {
    name: "Cardiovascular disease",
    keywords: ["HEART", "BLOOD PRESSURE", "CHOLESTEROL", "CARDIAC", "STATIN", "ASPIRIN LOW"],
  },
  {
    name: "Type 2 diabetes",
    keywords: ["DIABETES", "NDSS", "GLUCOSE", "METFORMIN", "INSULIN", "BLOOD SUGAR"],
  },
  {
    name: "Respiratory (asthma/COPD)",
    keywords: ["ASTHMA", "COPD", "INHALER", "VENTOLIN", "SERETIDE", "SYMBICORT", "RESPIRATORY"],
  },
  {
    name: "Mental health",
    keywords: ["ANTIDEPRESSANT", "ANXIETY", "SLEEP", "VALERIAN", "MAGNESIUM", "MENTAL"],
  },
  {
    name: "Musculoskeletal",
    keywords: ["JOINT", "GLUCOSAMINE", "ARTHRITIS", "MUSCLE", "BACK PAIN", "VOLTAREN"],
  },
  {
    name: "Incontinence (65+ cohort)",
    keywords: ["INCONTINENCE", "TENA", "DEPEND", "BLADDER", "PAD"],
  },
];

export type DemographicCoverageRow = {
  name: string;
  skuCount: number;
  topLineDaysLeft: number | null;
  status: "COVERED" | "THIN RANGE" | "STOCKOUT RISK";
};

export function buildDemographicCoverage(
  data: CleanedProduct[],
): DemographicCoverageRow[] {
  return DEMOGRAPHIC_CATEGORIES.map((cat) => {
    const matched = data.filter((p) => matchesKeywords(p, cat.keywords));
    const stockoutCount = matched.filter((p) => p.soh === 0 && p.qtySold > 0).length;
    const stockoutRate = safeDivide(stockoutCount, matched.length);
    const topLine = matched
      .filter((p) => p.salesVal > 0)
      .sort((a, b) => b.salesVal - a.salesVal)[0];
    let status: DemographicCoverageRow["status"] = "COVERED";
    if (matched.length < 5) status = "THIN RANGE";
    if (stockoutRate > 0.1) status = "STOCKOUT RISK";
    return {
      name: cat.name,
      skuCount: matched.length,
      topLineDaysLeft: topLine?.daysOfStockLeft ?? null,
      status,
    };
  });
}

// ─── 9. Strategic Analyst Report (deterministic) ──────────────────────────
export type StrategicSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type StrategicReport = {
  generatedAt: Date;
  sections: StrategicSection[];
};

function percentile(values: number[], v: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let count = 0;
  for (const x of sorted) if (x <= v) count++;
  return count / sorted.length;
}

export function buildStrategicAnalystReport(
  ds: CleanedDataset,
  periodDays: number,
): StrategicReport {
  const data = ds.cleanedData;
  const seasonal = buildSeasonalIntel(data);
  const demo = buildDemographicCoverage(data);
  const deptPnL = buildDeptPnL(data);
  const profit = buildProfitEngine(data);
  const capital = buildCapitalRelease(data);
  const integrity = buildIntegrityReport(ds);

  const sections: StrategicSection[] = [];

  // Section 1 — Seasonal Range Gaps
  {
    const gaps = seasonal.categories.filter(
      (c) => c.status === "CHECK RANGE" || c.status === "LOW STOCK",
    );
    const wellStocked = seasonal.categories.filter((c) => c.status === "WELL STOCKED");
    const paragraphs: string[] = [
      `We are currently in the ${seasonal.currentSeason} season window. Of ${seasonal.categories.length} priority seasonal categories for this period, ${wellStocked.length} are well stocked and ${gaps.length} need attention.`,
    ];
    const bullets = gaps.map(
      (g) =>
        `${g.category}: ${g.status === "CHECK RANGE" ? "no matching SKUs found — likely a range gap" : `only ${g.matchedSkus} SKU(s) in stock with critical days-of-stock pressure`}.`,
    );
    if (bullets.length === 0) bullets.push("No critical seasonal gaps detected — the range is aligned with the current season.");
    sections.push({ heading: "1. Seasonal Range Gaps", paragraphs, bullets });
  }

  // Section 2 — Department Mix Commentary
  {
    const top5 = deptPnL.slice(0, 5);
    const totalGp = deptPnL.reduce((s, d) => s + d.gp, 0);
    const top5Share = safeDivide(
      top5.reduce((s, d) => s + d.gp, 0),
      totalGp,
    ) * 100;
    const lowMarginHighInv = deptPnL.filter(
      (d) => d.avgMargin < 20 && d.stockInvestment > 1000,
    );
    const highRoi = deptPnL.filter((d) => d.gpRoi > 3.0 && d.stockInvestment > 200);

    const paragraphs: string[] = [
      `Top 5 departments by GP$ contribute ${top5Share.toFixed(1)}% of total gross profit (${fmtAUD(totalGp)}). Lead department: ${top5[0]?.dept || "n/a"} at ${fmtAUD(top5[0]?.gp || 0)} GP from ${top5[0]?.skuCount || 0} SKUs.`,
    ];
    if (top5Share > 65) {
      paragraphs.push(
        `Concentration risk: more than two-thirds of GP comes from 5 departments. Any disruption in supplier relationships for these categories will hit the bottom line hard.`,
      );
    }
    const bullets: string[] = [];
    for (const d of highRoi.slice(0, 3)) {
      bullets.push(
        `${d.dept} — GP ROI ${d.gpRoi.toFixed(2)}x on ${fmtAUD(d.stockInvestment)} stock. Worth more shelf space.`,
      );
    }
    for (const d of lowMarginHighInv.slice(0, 3)) {
      bullets.push(
        `${d.dept} — only ${fmtPct(d.avgMargin)} avg margin tying up ${fmtAUD(d.stockInvestment)}. Review pricing or rationalise SKUs.`,
      );
    }
    if (bullets.length === 0)
      bullets.push("Department mix is balanced — no extreme high-ROI or low-margin outliers.");
    sections.push({ heading: "2. Department Mix Commentary", paragraphs, bullets });
  }

  // Section 3 — Top 3 Range Expansion
  {
    const positive = data.filter((p) => p.soh >= 0);
    const revenues = deptPnL.map((d) => d.revenue);
    const margins = deptPnL.map((d) => d.avgMargin);
    const skuDepths = deptPnL.map((d) => d.skuCount);

    const scored = deptPnL.map((d) => {
      const revPct = percentile(revenues, d.revenue);
      const marginPct = percentile(margins, d.avgMargin);
      const lowDepthPct = 1 - percentile(skuDepths, d.skuCount); // less is better
      // demographic relevance: does any demographic category overlap with dept?
      const demoMatch = demo.find((dc) =>
        dc.name.toUpperCase().split(" ").some((w) => d.dept.toUpperCase().includes(w)),
      );
      const demoPct = demoMatch ? 1 : 0.3;
      const expansionScore =
        revPct * 0.35 + marginPct * 0.25 + lowDepthPct * 0.2 + demoPct * 0.2;
      return { dept: d, expansionScore };
    });
    scored.sort((a, b) => b.expansionScore - a.expansionScore);
    const top3 = scored.slice(0, 3);

    const bullets = top3.map(({ dept }) => {
      return `${dept.dept} — ${fmtAUD(dept.revenue)} revenue at ${fmtPct(dept.avgMargin)} avg margin from only ${dept.skuCount} SKUs. Worth widening the range with 3–5 complementary lines from your usual supplier.`;
    });
    sections.push({
      heading: "3. Top 3 Range Expansion Opportunities",
      paragraphs: [
        "Ranked by a weighted blend of revenue velocity, margin strength, range depth, and local demographic fit.",
      ],
      bullets,
    });
    // suppress unused warning
    void positive;
  }

  // Section 4 — Top 3 Rationalisation Targets
  {
    const slow = data.filter(
      (p) =>
        p.soh > 0 &&
        p.dept !== "PHARMACIST SERVICE CHARGES" &&
        p.dept !== "NDSS" &&
        ((p.daysSinceSold !== null && p.daysSinceSold > 180) || p.salesVal === 0),
    );
    const days = slow.map((p) => p.daysSinceSold ?? 9999);
    const stockVals = slow.map((p) => p.stockValue);
    const scored = slow.map((p) => {
      const dPct = percentile(days, p.daysSinceSold ?? 9999);
      const sPct = percentile(stockVals, p.stockValue);
      const zeroRev = p.salesVal === 0 ? 1 : 0;
      const score = dPct * 0.4 + sPct * 0.35 + zeroRev * 0.25;
      return { p, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3);
    const bullets = top3.map(
      ({ p }) =>
        `${p.stockName || "(unnamed)"} — ${p.dept || "no dept"}, ${fmtAUD(p.stockValue)} tied up, ${p.daysSinceSold === null ? "never sold" : `${p.daysSinceSold}d since last sale`}. Suggested: return to supplier or clearance markdown.`,
    );
    if (bullets.length === 0)
      bullets.push("No significant rationalisation targets — the range is moving well.");
    sections.push({
      heading: "4. Top 3 Rationalisation Targets",
      paragraphs: [
        `Total slow-stock capital tied up: ${fmtAUD(capital.totalCapital)} across ${capital.rows.length} lines.`,
      ],
      bullets,
    });
  }

  // Section 5 — Pricing & Margin Flags
  {
    const belowWS = data.filter((p) => p.flagsString.includes("BELOW WHOLESALE")).length;
    const noPrice = data.filter((p) => p.flagsString.includes("NO SELL PRICE")).length;
    const noCost = data.filter((p) => p.flagsString.includes("NO COST DATA")).length;
    const costCreep = data.filter((p) => p.flagsString.includes("COST CREEP")).length;
    const highRevLowMargin = data.filter(
      (p) => p.salesVal > 1000 && p.marginPct > 0 && p.marginPct < 20,
    );

    const bullets = [
      `${belowWS} line(s) currently selling BELOW wholesale — direct margin loss.`,
      `${noPrice} line(s) with stock but no sell price — invisible to Shopify.`,
      `${noCost} line(s) with sales but no cost data — margin reporting unreliable.`,
      `${costCreep} line(s) with cost creep above historical average — pricing review needed.`,
      `${profit.starsAtRisk.length} top-GP star line(s) at stockout risk within 60 days.`,
      `${highRevLowMargin.length} high-revenue line(s) running at sub-20% margin.`,
    ];
    sections.push({
      heading: "5. Pricing & Margin Flags",
      paragraphs: [
        "Snapshot of pricing-integrity indicators across the portfolio.",
      ],
      bullets,
    });
  }

  // Section 6 — One Priority Action
  {
    let action = "";
    let why = "";
    let benefit = "";

    if (profit.starsAtRisk.length > 0) {
      action = `Reorder the ${profit.starsAtRisk.length} high-margin star line(s) currently within 60 days of stockout.`;
      why = "These lines combine strong margin with active demand — letting them run out costs the most per day.";
      benefit = `Protects an estimated ${fmtAUD(profit.starsAtRisk.reduce((s, p) => s + p.salesGP, 0))} of in-period GP.`;
    } else if (capital.totalCapital > 5000) {
      action = `Run a clearance push on the top slow-moving lines to release ${fmtAUD(capital.totalCapital)} of trapped capital.`;
      why = "Stock that has not moved in 6+ months is taking shelf space and tying up cash that could buy faster movers.";
      benefit = "Releases working capital and improves stock turn ratios.";
    } else if (integrity.reliabilityScore < 95) {
      action = `Clean up the ${integrity.issueCount} integrity issue(s) in Z Office — primarily ${integrity.negativeSOH.length} negative SOH lines and ${integrity.noCostData.length} missing cost lines.`;
      why = "Below-95% data reliability means valuations, reorder triggers, and margin reports are systematically off.";
      benefit = "Restores confidence in every other metric in the report.";
    } else {
      const belowWS = data.filter((p) => p.flagsString.includes("BELOW WHOLESALE"));
      if (belowWS.length > 0) {
        action = `Correct sell prices on the ${belowWS.length} line(s) currently selling below wholesale.`;
        why = "Each sale at a sub-wholesale price is a direct loss — the more units move, the worse it gets.";
        benefit = "Immediate margin recovery on every future sale of these SKUs.";
      } else {
        const top = sections[2].bullets?.[0] || "";
        action = `Pursue the strongest range expansion opportunity identified above (${top.split(" — ")[0]}).`;
        why = "No defensive issues are urgent — the marginal dollar is best spent on growth.";
        benefit = "Adds incremental GP from a department where you already win.";
      }
    }

    sections.push({
      heading: "6. One Priority Action for This Week",
      paragraphs: [
        `**Do this:** ${action}`,
        `**Why it matters:** ${why}`,
        `**Expected benefit:** ${benefit}`,
      ],
    });
  }

  return { generatedAt: new Date(), sections };
}
