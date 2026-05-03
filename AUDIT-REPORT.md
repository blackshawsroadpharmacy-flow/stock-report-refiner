# Stock Report Refiner — Comprehensive Audit Report

**Repo:** `blackshawsroadpharmacy-flow/stock-report-refiner`  
**Date:** 2026-05-03  
**Scope:** Full codebase review — architecture, logic, security, performance, maintainability

---

## Executive Summary

The app is a React + Vite + TanStack Router SPA that ingests Z Office FOS (Forward Order System) Excel exports, cleans/normalizes them, runs rule-based stock analysis, and produces both an HTML report and a styled Excel workbook. It also features a “Deeper Dive” modal with 8 tabs (Profit Engine, Dept P&L, Capital Release, Action Card, Market Intel, Competitor Pricing, Compliance, Strategic Analyst) and optional competitor pricing lookup via Supabase.

**Overall assessment:** The core data pipeline is well-architected (pure functions, clear separation), but there are **critical security and data-integrity issues** that must be fixed before any production use. Several areas suffer from duplicated logic, hardcoded thresholds, and brittle string matching that will silently produce wrong results as the ruleset evolves.

---

## CRITICAL — Fix Before Any Production Use

### 1. Supabase credentials committed in `.env` (Security)
**File:** `.env`  
**Issue:** The `.env` file containing `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, and `VITE_SUPABASE_*` variables is committed to the repository. The publishable key is visible in git history even if removed now.  
**Impact:** Anyone with repo access can read from the competitor-pricing database. If an anon/service role key was ever in this file, the DB is fully exposed.  
**Fix:**
- Rotate the Supabase API key immediately.
- Add `.env` to `.gitignore`.
- Run `git filter-repo` or BFG to strip `.env` from git history.
- Use `VITE_` prefixed env vars at build time only; never commit them.
- Document in README how new devs set up their own `.env.local`.

---

### 2. Scoring logic is duplicated with hardcoded thresholds (Data Integrity)
**Files:** `src/lib/fos-analyzer.ts` (lines 552–570) and `src/lib/scoringEngine.ts`  
**Issue:** `fos-analyzer.ts` contains a private `scoreProduct()` function that uses **hardcoded** thresholds (e.g., `marginPct < 20`, `qtySold > 15`, `daysSinceSold > 180`). The exported “official” scoring engine in `scoringEngine.ts` pulls thresholds from `analysisConfig.ts`, but the analyzer never imports it — it uses its own copy.  
**Impact:** Changing thresholds in `analysisConfig.ts` will **not** affect the scorecard or the HTML report. The two will drift silently. Worse, `scoringEngine.ts` and the analyzer produce different scores for the same product.  
**Fix:**
- Delete the private `scoreProduct()` and `bandFor()` in `fos-analyzer.ts`.
- Import and call `scoreProduct` from `scoringEngine.ts` inside `analyze()`.
- Ensure `AnalysisResult` uses the shared `ScoreBand` type from `scoringEngine.ts`.

---

### 3. `AnalysisResult` totals use `p.stockValue` instead of `p.soh * p.cost` (Data Integrity)
**File:** `src/lib/fos-analyzer.ts` (lines 613–635)  
**Issue:** The `stockValue` field comes directly from the Z Office export (column F). The Excel export in `fos-excel-export.ts` recalculates capital as `p.soh * p.cost`. If Z Office’s `stockValue` differs from `soh * cost` (e.g., due to rounding, mixed costing methods, or data errors), the HTML report and Excel report will show different stock values.  
**Impact:** Inconsistent numbers between the on-screen KPIs and the downloaded Excel.  
**Fix:** Standardize on one formula. Prefer `soh * cost` because it is derived from more granular fields and is what the Excel export already uses. Update the analyzer totals to compute `stockValue` consistently.

---

### 4. Competitor pricing hook has no per-product timeout or retry (Reliability)
**File:** `src/hooks/useCompetitorPricing.ts` (lines 107–128)  
**Issue:** The Supabase RPC `match_competitor_prices` is called with 100-product chunks and 3-way concurrency. If one chunk hangs or the DB connection drops, the entire hook stays in `loading` state forever. There is no per-chunk timeout or retry.  
**Impact:** Large reports (2000+ products) can stall the UI indefinitely.  
**Fix:**
- Add a per-chunk timeout (e.g., 10s) using `AbortController` or `Promise.race`.
- Add automatic retry with exponential backoff for failed chunks (max 2 retries).
- Surface partial results: if 7 of 10 chunks succeed, show those matches with a warning rather than spinning forever.

---

## HIGH — Fix Soon

### 5. `flagLabelsForProduct()` is a brittle manual ruleId → label map
**File:** `src/lib/deeperDiveUtils.ts` (lines 45–101)  
**Issue:** The function hardcodes a switch statement mapping `ruleId` strings to flag labels. When a new rule is added to `fos-analyzer.ts` (e.g., rule 2.6 or 7.1), it will not appear in the Deeper Dive flags unless this switch is updated. There is no warning or lint rule to catch the omission.  
**Impact:** Deeper Dive tabs will silently miss flags, leading to incomplete action cards and capital-release calculations.  
**Fix:**
- Generate labels from the `Flag` object itself (add a `label` or `shortCode` field to the `Flag` type in `fos-analyzer.ts`).
- Alternatively, use a centralized `RULE_METADATA` record keyed by `ruleId` that both the analyzer and deeper-dive utils import.

---

### 6. `StockAnalysisReport.tsx` embeds 155 lines of CSS as a string constant
**File:** `src/components/StockAnalysisReport.tsx` (lines 15–155)  
**Issue:** The `REPORT_CSS` string is inline in the component. It duplicates Tailwind color tokens, defines its own palette, and is impossible to lint, auto-format, or tree-shake.  
**Impact:** Maintenance burden, no IDE support, risk of drift from Tailwind theme.  
**Fix:**
- Move the print/download styles into a static `.css` file in `public/`.
- Import it at build time so it gets hashed and cached.
- Or generate the downloaded HTML with a `<link>` to a hosted stylesheet instead of inlining 3KB of CSS.

---

### 7. `useTGARecallCheck` uses only first 10 characters of product names for matching
**File:** `src/utils/tga.functions.ts` (lines 94–97)  
**Issue:** The TGA recall checker slices each product name to 10 characters and does a substring match against recall titles/descriptions. “Paracetamol 500mg” and “Paracetamol 650mg” both become “paracetamo”, producing false positives. Generic names like “Vitamin C 1000” (10 chars = “vitamin c ”) will match every Vitamin C recall.  
**Impact:** High false-positive rate undermines trust in the Compliance tab.  
**Fix:**
- Use active ingredient / APN matching instead of name substring where possible.
- Increase the minimum needle length (e.g., 12–15 chars) or use word-boundary matching.
- Consider a curated mapping of product names → TGA-relevant keywords (e.g., brand names).

---

### 8. LocalStorage persistence stores entire xlsx file as base64
**File:** `src/components/FosCleaner.tsx` (lines 71–116, 135–145)  
**Issue:** The raw uploaded file is base64-encoded and stored in `localStorage` under `fos-cleaner:file-v1`. A 2MB xlsx becomes ~2.7MB of base64. Most browsers limit `localStorage` to 5–10 MB per origin.  
**Impact:** Large reports will silently fail to persist, or worse, crash with `QuotaExceededError`.  
**Fix:**
- Use `IndexedDB` (via `idb` or native) for binary file storage — it has much higher limits and supports Blobs directly.
- Store only the parsed `rows` JSON instead of the raw file bytes (compress with `pako` if needed).

---

## MEDIUM — Address When Convenient

### 9. Cosmetic analysis-step animation blocks the main thread for 1.4 seconds
**File:** `src/components/FosCleaner.tsx` (lines 187–204)  
**Issue:** `onRunAnalysis` uses a `for` loop with `await new Promise(r => setTimeout(r, 350))` purely to animate step text. The actual analysis is synchronous and takes milliseconds.  
**Impact:** Artificial delay on every analysis run. On slow devices the UI is unresponsive during this time because the loop is synchronous within the async function.  
**Fix:** Remove the artificial delay. If progress feedback is needed, run the synchronous `analyze()` in a `requestIdleCallback` or `setTimeout(..., 0)` and show a single spinner.

---

### 10. Scorecard table is unmemoized and re-renders on every confidence-threshold change
**File:** `src/components/StockAnalysisReport.tsx` (lines 236–353)  
**Issue:** The `Scorecard` component iterates over all products to build table rows. Changing the confidence threshold (a `<select>` in the scorecard header) triggers a re-render, recreating every row’s price-delta and margin-gap calculations. For a 2,000-product report this is noticeable.  **Fix:**
- Memoize the derived `sorted` array with `useMemo` (already done), but also memoize the per-row competitor-match lookup.
- Debounce the confidence threshold select (e.g., 150ms).

---

### 11. Deeper Dive modal re-computes expensive datasets while closed
**File:** `src/components/deeper-dive/DeeperDiveModal.tsx` (lines 36–37)  **Issue:** `cleanDataset` and `buildProfitEngine` are called via `useMemo` every time the parent `StockAnalysisReport` re-renders, regardless of whether the modal is open.  **Fix:** Gate the computation behind `open === true`, or move the modal into its own lazy-loaded component so the work only happens when the modal mounts.

---

### 12. ActionCardTab print styles are coupled to `#print-action-card` ID
**File:** `src/styles.css` (lines 88–104) and `src/components/deeper-dive/tabs/ActionCardTab.tsx`  **Issue:** The global `@media print` CSS targets `#print-action-card` specifically. If the ID changes or another tab wants print support, styles break.  **Fix:** Use a `.print-only` utility class and `@media print` scoped inside each tab component, or a shared `Printable` wrapper.

---

### 13. `forceTextColumns` is called on every sheet build with brittle column indexing
**File:** `src/lib/fos-excel-export.ts` (line 667), `src/lib/deeper-dive-excel-export.ts` (lines 87–93)  **Issue:** `forceTextColumns(ws, [3], ...)` hardcodes column index 3 for APN. If a new column is inserted before APN, the wrong column gets forced to text.  **Fix:** Look up the column index dynamically by header name (e.g., find the column whose header is "APN" or "PDE/APN").

---

### 14. `buildActionCard` uses `flagsString.includes(...)` instead of structured flags
**File:** `src/lib/deeperDiveUtils.ts` (lines 328–437)  **Issue:** Action-card bucketing, price-fix detection, and investigate logic all do substring searches on `flagsString`. If a flag label contains another flag label as a substring (e.g., “LOW STOCK” vs “NO STOCK DATA”), false matches occur.  **Fix:** Pass the actual `Flag[]` array (or a `Set<string>` of canonical flag codes) from the analyzer into the deeper-dive utils instead of a comma-joined string.

---

## IMPROVEMENTS — Quality of Life

### 15. No unit tests for the scoring or analysis engines
**Files:** `src/lib/fos-analyzer.ts`, `src/lib/scoringEngine.ts`, `src/lib/deeperDiveUtils.ts`  **Issue:** These are pure functions — ideal for unit testing — yet there are zero test files.  **Fix:** Add a `vitest` (or `bun test`) suite with fixture rows and expected scores/flags. Test edge cases: zero sales, negative SOH, missing dates, scientific-notation barcodes.

---

### 16. No validation that the uploaded file is actually a Z Office FOS export
**File:** `src/lib/fos-processor.ts` (lines 67–94)  **Issue:** The validation only checks `.xlsx` extension, file length, and whether column C contains digits. A generic product list from another system could pass.  **Fix:** Add stricter header detection — look for the exact Z Office header row pattern (e.g., “Stock Name”, “Full Name”, “APN” in the first data row).

---

### 17. `fmtAUD` formats `NaN` and `Infinity` as “$NaN” or “$Infinity”
**File:** `src/lib/fos-analyzer.ts` (lines 123–129)  **Issue:** `fmtAUD(n || 0)` only catches `null/undefined/falsy`. If `n` is `NaN` or `Infinity`, it passes through to `Intl.NumberFormat` which produces ugly output.  **Fix:** Explicitly guard: `if (!isFinite(n)) return "—";`.

---

### 18. Competitor pricing results are not cached across sessions
**File:** `src/hooks/useCompetitorPricing.ts`  **Issue:** For a 2,000-product report, the Supabase RPC is called every time the report is opened. Competitor prices change infrequently (daily at most).  **Fix:** Cache `matches` in `IndexedDB` or `localStorage` keyed by a hash of the product list + date. Invalidate after 24h.

---

### 19. The app name and branding are hardcoded everywhere
**Files:** `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/components/FosCleaner.tsx`, `src/lib/fos-excel-export.ts`, etc.  **Issue:** “Blackshaws Road Pharmacy”, “FOS Stock Report Cleaner”, and “Z Office” appear in dozens of strings.  **Fix:** Centralize in `src/config/branding.ts` or environment variables so the tool can be reused for other pharmacies.

---

### 20. `useStrategicAnalyst` runs synchronously but defers with `setTimeout(..., 50)`
**File:** `src/hooks/useStrategicAnalyst.ts` (lines 15–29)  **Issue:** The 50ms `setTimeout` is a micro-optimization to let the modal paint. It adds unnecessary complexity.  **Fix:** Use `requestIdleCallback` or a Web Worker for large reports if the calculation is truly heavy. For typical reports (<3,000 products), the synchronous calculation is instant — remove the timeout.

---

## Positive Observations

1. **Pure-function architecture** — `fos-analyzer.ts`, `scoringEngine.ts`, and `deeperDiveUtils.ts` have no React or DOM dependencies. Easy to test and reuse.
2. **Barcode normalization** — `barcode-utils.ts` is thorough: handles scientific notation, floats, CSV escaping, and Excel text-forcing.
3. **Comprehensive Excel export** — Four sheets (Summary, Scorecard, Flags & Actions, Legend) with professional styling, frozen panes, autofilter, and tab colors.
4. **Competitor pricing concurrency** — Chunked queries with concurrent workers show understanding of Supabase RPC limits.
5. **TGA recall server-side** — `createServerFn` keeps the RSS fetch off the client, avoiding CORS and exposing no third-party endpoints to the browser.
6. **Configurable thresholds** — `analysisConfig.ts` is a good start (though underutilized due to the duplicate scoring bug).

---

## Recommended Priority Order for Fixes

1. **Rotate Supabase key + scrub `.env` from git history** (Critical — security)
2. **Merge duplicated scoring logic** so `analysisConfig.ts` is the single source of truth (Critical — data integrity)
3. **Fix stock-value calculation consistency** between HTML report and Excel export (Critical — data integrity)
4. **Add per-chunk timeout + partial-result fallback** to competitor pricing hook (High — reliability)
5. **Replace `flagLabelsForProduct` switch with canonical flag metadata** (High — maintainability)
6. **Move print CSS out of component string** (High — maintainability)
7. **Improve TGA matching accuracy** (High — user trust)
8. **Switch localStorage file persistence to IndexedDB** (High — robustness)
9. **Add unit tests for scoring engine** (Medium — prevents regressions)
10. **Remove artificial 1.4s analysis delay** (Medium — UX)

---

*Report generated by Hermes Agent*
