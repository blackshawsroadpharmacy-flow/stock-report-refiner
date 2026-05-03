import * as XLSX from "xlsx-js-style";

// Centralised barcode / APN / PDE handling.
//
// Goals:
// 1. Always store barcodes as TEXT strings — never numbers, never scientific
//    notation ("9.89E+12"), never floats with trailing ".0".
// 2. When writing xlsx with xlsx-js-style, force the cell to text type ("s")
//    and apply the "@" number format so Excel displays it as text.
// 3. When writing CSV, wrap barcode values in ="..." so Excel will not
//    auto-convert long digit strings into scientific notation on open.

/**
 * Normalise any cell value (string, number, scientific notation, float) into a
 * clean barcode string. Returns "" for null/undefined/empty.
 *
 *  9.89E+12         -> "9890000000000"
 *  9890108145945    -> "9890108145945"
 *  "9890108145945.0"-> "9890108145945"
 *  " 93123456 "     -> "93123456"
 *  "ABC-123"        -> "ABC-123"  (non-numeric codes pass through trimmed)
 */
export function normalizeBarcode(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Numbers (including scientific notation from xlsx) — render as a plain
  // integer string when possible.
  if (typeof v === "number") {
    if (!isFinite(v)) return "";
    if (Number.isInteger(v)) return v.toFixed(0);
    // Excel sometimes truncates barcodes when stored as floats — best effort.
    return v.toFixed(0);
  }
  let s = String(v).trim();
  if (!s) return "";
  // Scientific notation that arrived as a string ("9.89E+12").
  if (/^-?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (isFinite(n)) s = n.toFixed(0);
  }
  // "9890108145945.0" -> drop trailing zeros + dot for pure-digit decimals.
  if (/^\d+\.\d+$/.test(s)) {
    const [intPart, frac] = s.split(".");
    if (/^0+$/.test(frac)) s = intPart;
  }
  return s;
}

/**
 * Build an xlsx-js-style cell object that forces a value to be stored as text
 * (so 13-digit barcodes do not get re-interpreted by Excel).
 */
export function textCell(value: unknown, extraStyle: any = {}): any {
  const v = normalizeBarcode(value);
  return {
    v,
    t: "s",
    z: "@",
    s: { ...extraStyle, numFmt: "@" },
  };
}

/**
 * Wrap a CSV value so Excel imports it as text, never scientific notation.
 * Returns the value already CSV-escaped.
 */
export function csvBarcodeCell(v: unknown): string {
  const s = normalizeBarcode(v);
  if (!s) return "";
  // ="value" forces Excel to treat the cell as a text formula result.
  return `"=""${s.replace(/"/g, '""""')}"""`;
}

/**
 * After XLSX.utils.aoa_to_sheet(...) has built a sheet, force the listed
 * column indices (0-based) to be stored as text from `startRow` downwards.
 */
export function forceTextColumns(
  ws: any,
  columnIndices: number[],
  startRow = 1,
  endRow?: number,
) {
  // Lazy import to avoid circular deps; xlsx-js-style is already a dep.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require("xlsx-js-style");
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const last = endRow ?? range.e.r;
  for (const c of columnIndices) {
    for (let r = startRow; r <= last; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      const normalised = normalizeBarcode(cell.v);
      cell.v = normalised;
      cell.t = "s";
      cell.z = "@";
      cell.s = { ...(cell.s || {}), numFmt: "@" };
      delete cell.w; // drop any cached formatted text
    }
  }
}
