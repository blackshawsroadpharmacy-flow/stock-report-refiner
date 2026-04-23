// Centralised analysis thresholds — tune without touching rule code.
// All values are overridable at runtime via localStorage (see overrideFromStorage).

export const DEFAULT_THRESHOLDS = {
  // Pricing integrity
  MIN_VIABLE_MARGIN_PCT: 20,         // below this = low margin warning
  HEALTHY_MARGIN_PCT: 45,            // above this = score bonus
  STAR_MIN_MARGIN_PCT: 35,           // star performer minimum margin
  STAR_MIN_GP: 100,                  // star performer minimum GP $
  STAR_MIN_QTY_SOLD: 5,              // star performer minimum qty sold
  STAR_MAX_DAYS_SINCE_SOLD: 45,      // star performer recency

  // Cost creep
  COST_CREEP_FACTOR: 1.05,           // current cost > avgCost * factor

  // Inventory / dead stock
  GHOST_STOCK_DAYS: 365,             // no purchase in this many days
  STALE_SOLD_DAYS: 365,              // no sale in this many days
  STALE_PENALTY_DAYS: 180,           // days since sold > this = score penalty
  SLOW_MOVER_MAX_QTY: 1,             // qtySold <= this + SOH > 0 = slow mover
  DEAD_STOCK_SALES_VAL: 0,           // dead stock sales val threshold

  // Stockouts
  STOCKOUT_MAX_DAYS_SINCE_SOLD: 60,  // stockout check window
  LOW_STOCK_MAX_SOH: 2,              // SOH <= this on fast mover = low stock
  LOW_STOCK_MIN_QTY_SOLD: 8,         // fast mover threshold for low-stock check

  // Purchasing
  OVER_BOUGHT_FACTOR: 2,             // purchased > sold * factor
  OVER_BOUGHT_MIN_QTY: 4,            // minimum qty purchased to trigger
  UNDER_BOUGHT_MIN_QTY_SOLD: 2,      // minimum qty sold to trigger under-bought
  REACTIVE_ORDER_GAP_DAYS: 90,       // purchase > sale + gap days

  // Fast mover / high margin
  FAST_MOVER_MIN_QTY: 15,            // qtySold >= this = fast mover
  HIGH_MARGIN_MIN_PCT: 50,           // marginPct >= this = high margin

  // Scoring weights
  SCORE_BELOW_WHOLESALE: 30,
  SCORE_LOW_MARGIN: 20,
  SCORE_STOCKOUT: 15,
  SCORE_DEAD_STOCK: 15,
  SCORE_STALE_180: 10,
  SCORE_COST_CREEP: 10,
  SCORE_GHOST_STOCK: 10,
  SCORE_OVER_BOUGHT: 5,
  SCORE_HIGH_MARGIN_BONUS: 10,
  SCORE_FAST_MOVER_BONUS: 10,
  SCORE_HIGH_GP_BONUS: 5,

  // Capital release
  CAPITAL_RELEASE_MIN_DAYS_SINCE_SOLD: 180, // for initial filter
  CAPITAL_RELEASE_HIGH_PRIORITY_THRESHOLD: 200, // stock value > this = high priority
  CAPITAL_RELEASE_MEDIUM_PRIORITY_THRESHOLD: 100, // stock value >= this = medium priority

  // Action Card
  ACTION_CARD_PRICE_FIX_SELL_PRICE_FACTOR: 1.35, // sell price to update = ws1Cost * factor
  ACTION_CARD_REORDER_MIN_STOCKOUT_DAYS: 30, // days of stock left < this = reorder now
  ACTION_CARD_REORDER_DAILY_SALES_MULTIPLIER: 30, // order this many days of average sales
  ACTION_CARD_CLEAR_STOCK_MIN_VALUE: 100, // stock value > this = clear stock candidate
  ACTION_CARD_CLEAR_STOCK_MARKDOWN_FACTOR: 1.1, // markdown to cost * factor

  // Score bands
  BAND_HEALTHY_MIN: 80,
  BAND_MONITOR_MIN: 60,
  BAND_ACTION_MIN: 40,
};

export type Thresholds = typeof DEFAULT_THRESHOLDS;

let _thresholds: Thresholds = { ...DEFAULT_THRESHOLDS };

/** Reset to defaults. */
export function resetThresholds(): void {
  _thresholds = { ...DEFAULT_THRESHOLDS };
}

/** Get current thresholds (mutable ref — modify and call persistThresholds). */
export function getThresholds(): Thresholds {
  return _thresholds;
}

/** Replace thresholds wholesale. */
export function setThresholds(t: Thresholds): void {
  _thresholds = { ...t };
}

/** Persist current thresholds to localStorage. */
export function persistThresholds(): void {
  try {
    localStorage.setItem("fos-analysis-thresholds", JSON.stringify(_thresholds));
  } catch {
    // ignore
  }
}

/** Load thresholds from localStorage (falls back to defaults). */
export function loadThresholds(): void {
  try {
    const raw = localStorage.getItem("fos-analysis-thresholds");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Thresholds>;
      _thresholds = { ...DEFAULT_THRESHOLDS, ...parsed };
    }
  } catch {
    _thresholds = { ...DEFAULT_THRESHOLDS };
  }
}
