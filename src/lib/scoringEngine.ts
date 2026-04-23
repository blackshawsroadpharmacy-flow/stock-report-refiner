// Shared scoring engine — single source of truth for UI and Excel export.
// All thresholds pulled from analysisConfig.ts so users can tune behaviour.

import { getThresholds } from "@/config/analysisConfig";
import type { Product } from "@/lib/fos-analyzer";

export type ScoreBand = "Healthy" | "Monitor" | "Action Required" | "Urgent";

export interface ScoreResult {
  score: number;
  band: ScoreBand;
  applied: string[]; // human-readable reasons
}

/**
 * Compute a single score / band for a product.
 * Returns the same result regardless of whether called from the React UI
 * or the Excel export pipeline.
 */
export function scoreProduct(p: Product): ScoreResult {
  const T = getThresholds();
  let score = 100;
  const applied: string[] = [];

  const belowWholesale =
    p.sellPrice > 0 && p.ws1Cost > 0 && p.sellPrice < p.ws1Cost;
  const lowMargin = p.marginPct > 0 && p.marginPct < 20 && p.qtySold > 0;
  const stockout =
    p.soh === 0 &&
    p.daysSinceSold !== null &&
    p.daysSinceSold < 60 &&
    p.qtySold > 0;
  const deadStock = p.qtySold === 0 && p.soh > 0;
  const stale180 = p.daysSinceSold !== null && p.daysSinceSold > 180;
  const costCreep = p.cost > 0 && p.avgCost > 0 && p.cost > p.avgCost * 1.05;
  const ghostStock =
    p.daysSincePurchased !== null &&
    p.daysSincePurchased > 365 &&
    p.soh > 0;
  const overBought =
    p.qtyPurchased > p.qtySold * 2 &&
    p.qtyPurchased > 4 &&
    p.soh > 0;
  const highMargin = p.marginPct > 45 && p.qtySold > 0;
  const fastMover = p.qtySold >= 15;
  const highGP = p.salesGP > 200;

  if (belowWholesale) {
    score -= 30;
    applied.push("selling below wholesale");
  }
  if (lowMargin) {
    score -= 20;
    applied.push("low margin");
  }
  if (stockout) {
    score -= 15;
    applied.push("stockout");
  }
  if (deadStock) {
    score -= 15;
    applied.push("dead stock");
  }
  if (stale180) {
    score -= 10;
    applied.push("stale >180d");
  }
  if (costCreep) {
    score -= 10;
    applied.push("cost creep");
  }
  if (ghostStock) {
    score -= 10;
    applied.push("ghost stock");
  }
  if (overBought) {
    score -= 5;
    applied.push("over-bought");
  }

  if (highMargin) {
    score += 10;
    applied.push("high margin bonus");
  }
  if (fastMover) {
    score += 10;
    applied.push("fast mover bonus");
  }
  if (highGP) {
    score += 5;
    applied.push("high GP bonus");
  }

  score = Math.max(0, Math.min(100, score));

  let band: ScoreBand;
  if (score >= 80) band = "Healthy";
  else if (score >= 60) band = "Monitor";
  else if (score >= 40) band = "Action Required";
  else band = "Urgent";

  return { score, band, applied };
}

/** Band from score number (used when you only have the score). */
export function bandForScore(score: number): ScoreBand {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Monitor";
  if (score >= 40) return "Action Required";
  return "Urgent";
}

/** Colour for band (UI + Excel). */
export const BAND_COLORS: Record<ScoreBand, { label: string; scoreFill: string; rowFill: string }> = {
  Healthy: { label: "HEALTHY", scoreFill: "27AE60", rowFill: "D5F5E3" },
  Monitor: { label: "MONITOR", scoreFill: "F39C12", rowFill: "FEF9E7" },
  "Action Required": { label: "ACTION", scoreFill: "E67E22", rowFill: "FDEBD0" },
  Urgent: { label: "URGENT", scoreFill: "C0392B", rowFill: "FADBD8" },
};
