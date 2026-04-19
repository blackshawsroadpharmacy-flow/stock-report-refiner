import * as XLSX from "xlsx-js-style";

export const HEADERS = [
  "Stock Name",
  "Full Name",
  "APN",
  "PDE",
  "SOH",
  "Stock Value",
  "Last Purchased",
  "Last Sold",
  "Qty Sold",
  "Sales Val",
  "Sales GP$",
  "Qty Purchased",
  "Margin % (end date)",
  "Categories",
  "Dept",
  "Stock on Hand (end date)",
  "Cost",
  "Avg Cost",
  "WS1 Cost",
  "WS1 Cost (end date)",
  "Sell Price",
  "Sell Price (end date)",
];

const COLUMN_WIDTHS = [
  45, 45, 16, 12, 8, 12, 18, 18, 10, 12, 12, 14, 18, 22, 22, 20, 10, 10, 10, 18, 12, 20,
];

// 0-indexed columns that should be right-aligned (numeric)
const NUMERIC_COLS = new Set([4, 5, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 21]);

export type ProcessResult = {
  ok: true;
  rows: any[][];
  rowCount: number;
  workbook: XLSX.WorkBook;
  filename: string;
};

export type ProcessError = {
  ok: false;
  error: string;
};

export async function processFosFile(file: File): Promise<ProcessResult | ProcessError> {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { ok: false, error: "Workbook has no sheets." };
    const ws = wb.Sheets[sheetName];
    const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      dateNF: "dd/mm/yyyy",
      blankrows: true,
      defval: null,
    });

    if (rawRows.length < 7) {
      return { ok: false, error: "File is too short to be a valid FOS export." };
    }

    // Strip first 3 rows (pharmacy/address/date) and last 3 rows (totals/blank/footer)
    const dataRows = rawRows.slice(3, rawRows.length - 3);

    if (dataRows.length === 0) {
      return { ok: false, error: "No stock data rows found after stripping headers/footers." };
    }

    // Validate: first data row should look right
    const firstRow = dataRows[0] || [];
    const nonEmpty = firstRow.filter((c) => c !== null && c !== undefined && c !== "").length;
    if (nonEmpty < 8) {
      return {
        ok: false,
        error: "File doesn't look like a valid FOS export — too few populated columns.",
      };
    }
    const apnCell = firstRow[2];
    const apnStr = apnCell == null ? "" : String(apnCell);
    if (!/\d/.test(apnStr)) {
      return {
        ok: false,
        error: "Column C (APN) doesn't contain digits — is this a Z Office FOS export?",
      };
    }

    // Normalize each row to 22 columns
    const normalized = dataRows.map((row) => {
      const r = Array.isArray(row) ? [...row] : [];
      while (r.length < HEADERS.length) r.push(null);
      return r.slice(0, HEADERS.length);
    });

    const outputData = [HEADERS, ...normalized];
    const newWs = XLSX.utils.aoa_to_sheet(outputData);

    // Column widths
    newWs["!cols"] = COLUMN_WIDTHS.map((w) => ({ wch: w }));

    // Freeze header row
    newWs["!freeze"] = { xSplit: 0, ySplit: 1 } as any;
    newWs["!views"] = [{ state: "frozen", ySplit: 1 }] as any;

    // AutoFilter
    const lastCol = XLSX.utils.encode_col(HEADERS.length - 1);
    const lastRow = normalized.length + 1;
    newWs["!autofilter"] = { ref: `A1:${lastCol}${lastRow}` };

    // Style header row
    const headerStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" }, name: "Inter", sz: 11 },
      fill: { patternType: "solid", fgColor: { rgb: "10183F" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top: { style: "thin", color: { rgb: "10183F" } },
        bottom: { style: "thin", color: { rgb: "10183F" } },
        left: { style: "thin", color: { rgb: "10183F" } },
        right: { style: "thin", color: { rgb: "10183F" } },
      },
    };
    HEADERS.forEach((h, c) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (!newWs[ref]) newWs[ref] = { v: h, t: "s" };
      (newWs[ref] as any).s = headerStyle;
    });

    // Style data rows — alternating shading + alignment
    for (let r = 1; r <= normalized.length; r++) {
      const isEven = r % 2 === 0;
      const fillColor = isEven ? "F5F5F5" : "FFFFFF";
      for (let c = 0; c < HEADERS.length; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!newWs[ref]) newWs[ref] = { v: "", t: "s" };
        const align = NUMERIC_COLS.has(c) ? "right" : "left";
        (newWs[ref] as any).s = {
          font: { name: "Arial", sz: 10 },
          alignment: { horizontal: align, vertical: "center" },
          fill: { patternType: "solid", fgColor: { rgb: fillColor } },
        };
      }
    }

    // Header row height
    newWs["!rows"] = [{ hpt: 28 }];

    const outWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outWb, newWs, "Stock Report");

    const today = new Date().toISOString().slice(0, 10);
    const filename = `FOS_Cleaned_${today}.xlsx`;

    return {
      ok: true,
      rows: normalized,
      rowCount: normalized.length,
      workbook: outWb,
      filename,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: `Could not read file — ${e?.message || "unknown error"}`,
    };
  }
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename, { bookType: "xlsx", cellStyles: true });
}
