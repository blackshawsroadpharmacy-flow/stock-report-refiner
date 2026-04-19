import { useMemo, useRef } from "react";
import {
  type AnalysisResult,
  type Flag,
  type ProductAnalysis,
  fmtAUD,
  fmtPct,
  fmtDate,
} from "@/lib/fos-analyzer";

// All styles live in this string so the downloaded HTML is fully self-contained.
export const REPORT_CSS = `
:root {
  --navy:#10183f; --crimson:#c0392b; --warm-white:#fffdfa; --card-white:#ffffff;
  --green:#27ae60; --orange:#e67e22; --red:#e74c3c; --blue:#2980b9; --yellow:#f39c12;
  --grey-50:#f7f7f8; --grey-100:#eceef2; --grey-200:#dde0e7; --grey-500:#6b7280; --grey-800:#1f2937;
}
.fos-report * { box-sizing: border-box; }
.fos-report {
  font-family: Inter, system-ui, -apple-system, sans-serif;
  color: var(--grey-800); background: var(--warm-white); font-size: 14px; line-height: 1.5;
}
.fos-report .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
.fos-report h1 { font-size: 28px; color: var(--navy); font-weight: 700; margin: 0 0 8px; }
.fos-report h2 {
  font-size: 20px; color: var(--navy); font-weight: 700; margin: 32px 0 16px;
  padding: 8px 0 8px 14px; border-left: 4px solid var(--crimson);
}
.fos-report h3 { font-size: 16px; font-weight: 700; margin: 0 0 6px; color: var(--navy); }
.fos-report .meta { color: var(--grey-500); font-size: 13px; }
.fos-report .meta strong { color: var(--grey-800); }
.fos-report .header-card {
  background: var(--card-white); border-radius: 12px; padding: 24px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 24px;
}
.fos-report .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.fos-report .btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--navy); color: #fff; border: 0; padding: 10px 16px;
  border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;
}
.fos-report .btn:hover { opacity: 0.9; }
.fos-report .btn.ghost { background: transparent; color: var(--navy); border: 1px solid var(--grey-200); }
.fos-report .kpi-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 8px;
}
.fos-report .kpi {
  background: var(--card-white); border-radius: 8px; padding: 16px 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.fos-report .kpi .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--grey-500); font-weight: 600; }
.fos-report .kpi .value { font-size: 24px; font-weight: 700; color: var(--navy); margin-top: 4px; }
.fos-report .section-summary { color: var(--grey-500); font-size: 13px; margin: -8px 0 16px; }
.fos-report .empty {
  background: #ecfdf5; color: #065f46; padding: 12px 16px; border-radius: 8px;
  font-weight: 600; border: 1px solid #a7f3d0;
}
.fos-report .flag-card {
  background: var(--card-white); border-radius: 8px; padding: 16px 20px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.06); margin-bottom: 12px;
  border-left: 4px solid var(--grey-200);
}
.fos-report .flag-card.critical { border-left-color: var(--red); }
.fos-report .flag-card.warning  { border-left-color: var(--orange); }
.fos-report .flag-card.info     { border-left-color: var(--blue); }
.fos-report .flag-card.positive { border-left-color: var(--green); }
.fos-report .flag-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.fos-report .flag-head .product { font-weight: 700; color: var(--navy); font-size: 15px; }
.fos-report .flag-head .pde { color: var(--grey-500); font-size: 12px; }
.fos-report .badge {
  display: inline-block; border-radius: 4px; font-size: 11px; font-weight: 700;
  padding: 2px 8px; text-transform: uppercase; letter-spacing: 0.03em; color: #fff;
}
.fos-report .badge.critical { background: var(--red); }
.fos-report .badge.warning  { background: var(--orange); }
.fos-report .badge.info     { background: var(--blue); }
.fos-report .badge.positive { background: var(--green); }
.fos-report .flag-title { font-weight: 600; margin: 4px 0 8px; color: var(--grey-800); }
.fos-report .metrics {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px 16px; margin: 8px 0;
}
.fos-report .metric .k { font-size: 11px; color: var(--grey-500); text-transform: uppercase; letter-spacing: 0.03em; }
.fos-report .metric .v { font-weight: 600; color: var(--navy); font-size: 13px; }
.fos-report .action {
  background: var(--grey-50); border-radius: 6px; padding: 10px 14px;
  margin-top: 10px; border-left: 3px solid var(--navy); font-size: 13px;
}
.fos-report .action strong { color: var(--navy); }
.fos-report .subtotal {
  background: #fff7ed; color: #9a3412; padding: 10px 14px; border-radius: 6px;
  font-weight: 600; margin-bottom: 12px; font-size: 13px; border: 1px solid #fed7aa;
}
.fos-report table.scorecard {
  width: 100%; border-collapse: collapse; background: var(--card-white);
  border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  font-size: 12px;
}
.fos-report table.scorecard thead th {
  background: var(--navy); color: #fff; text-align: left; padding: 10px 12px;
  font-weight: 600; font-size: 12px; white-space: nowrap;
}
.fos-report table.scorecard td { padding: 8px 12px; border-bottom: 1px solid var(--grey-100); }
.fos-report table.scorecard tbody tr:nth-child(even) { background: var(--grey-50); }
.fos-report table.scorecard td.num { text-align: right; font-variant-numeric: tabular-nums; }
.fos-report .score-pill {
  display: inline-block; padding: 2px 10px; border-radius: 999px;
  font-weight: 700; font-size: 11px; color: #fff; text-transform: uppercase; letter-spacing: 0.03em;
}
.fos-report .score-pill.healthy  { background: var(--green); }
.fos-report .score-pill.monitor  { background: var(--yellow); }
.fos-report .score-pill.action   { background: var(--orange); }
.fos-report .score-pill.urgent   { background: var(--red); }
.fos-report .footer-note { text-align: center; color: var(--grey-500); font-size: 12px; margin-top: 32px; }

@media (max-width: 700px) {
  .fos-report .kpi-grid { grid-template-columns: 1fr 1fr; }
}
@media print {
  body { background: #fff !important; }
  .fos-report { background: #fff; font-size: 11px; }
  .fos-report .container { padding: 0; max-width: none; }
  .fos-report .toolbar, .fos-report .no-print { display: none !important; }
  .fos-report h2 { page-break-before: always; }
  .fos-report h2:first-of-type { page-break-before: auto; }
  .fos-report .kpi, .fos-report .flag-card, .fos-report table.scorecard, .fos-report .header-card {
    box-shadow: none !important; border: 1px solid var(--grey-200);
  }
  .fos-report .flag-card { page-break-inside: avoid; }
  .fos-report tr { page-break-inside: avoid; }
}
`;

const SECTIONS: { num: number; title: string; emoji: string; subtitle?: (r: AnalysisResult) => string }[] = [
  { num: 1, title: "Critical Issues — Pricing Integrity", emoji: "🔴" },
  {
    num: 2,
    title: "Dead & Ghost Stock",
    emoji: "🟠",
    subtitle: (r) => `Total capital tied up in dead/slow stock: ${fmtAUD(r.totals.deadStockCapital)}`,
  },
  {
    num: 3,
    title: "Stockout Risks & Lost Sales",
    emoji: "🚨",
    subtitle: (r) =>
      `Estimated GP at risk from current stockouts: ${fmtAUD(r.totals.stockoutGpAtRisk)} / month`,
  },
  { num: 4, title: "Purchasing Efficiency", emoji: "📦" },
  { num: 5, title: "Top Performers", emoji: "⭐" },
  { num: 6, title: "Data Quality Issues", emoji: "⚠️" },
];

function bandClass(b: ProductAnalysis["scoreBand"]): string {
  switch (b) {
    case "Healthy": return "healthy";
    case "Monitor": return "monitor";
    case "Action Required": return "action";
    case "Urgent": return "urgent";
  }
}

function FlagCard({ pa, flag }: { pa: ProductAnalysis; flag: Flag }) {
  return (
    <div className={`flag-card ${flag.severity}`}>
      <div className="flag-head">
        <span className="product">{pa.product.stockName || "(no name)"}</span>
        {pa.product.pde && <span className="pde">PDE {pa.product.pde}</span>}
        <span className={`badge ${flag.severity}`}>Rule {flag.ruleId}</span>
      </div>
      <div className="flag-title">{flag.title}</div>
      <div className="metrics">
        {flag.metrics.map((m, i) => (
          <div className="metric" key={i}>
            <div className="k">{m.label}</div>
            <div className="v">{m.value}</div>
          </div>
        ))}
      </div>
      <div className="action">
        <strong>Action: </strong>
        {flag.action}
      </div>
    </div>
  );
}

function Section({ result, num, title, emoji, subtitle }: {
  result: AnalysisResult;
  num: number; title: string; emoji: string;
  subtitle?: (r: AnalysisResult) => string;
}) {
  const items = result.byCategory[num] || [];
  const flagList: { pa: ProductAnalysis; flag: Flag }[] = [];
  for (const pa of items) {
    for (const f of pa.flags) if (f.category === num) flagList.push({ pa, flag: f });
  }
  if (num === 5) flagList.sort((a, b) => b.pa.product.salesGP - a.pa.product.salesGP);

  return (
    <section>
      <h2>{emoji} Section {num}: {title}</h2>
      {subtitle && flagList.length > 0 && <div className="subtotal">{subtitle(result)}</div>}
      {flagList.length === 0 ? (
        <div className="empty">✅ No issues found in this category</div>
      ) : (
        flagList.map((x, i) => <FlagCard key={i} pa={x.pa} flag={x.flag} />)
      )}
    </section>
  );
}

function Scorecard({ result }: { result: AnalysisResult }) {
  const sorted = useMemo(
    () => [...result.products].sort((a, b) => a.score - b.score),
    [result],
  );
  return (
    <section>
      <h2>📋 Section 7: Full Product Scorecard</h2>
      <div className="section-summary">
        Sorted worst-first. {sorted.length} products analysed.
      </div>
      <table className="scorecard">
        <thead>
          <tr>
            <th>Product</th>
            <th>SOH</th>
            <th>Sell $</th>
            <th>Margin %</th>
            <th>GP $</th>
            <th>Qty Sold</th>
            <th>Days Since Sale</th>
            <th>Score</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((pa, i) => (
            <tr key={i}>
              <td>{pa.product.stockName || "(no name)"}</td>
              <td className="num">{pa.product.soh}</td>
              <td className="num">{fmtAUD(pa.product.sellPrice)}</td>
              <td className="num">{fmtPct(pa.product.marginPct)}</td>
              <td className="num">{fmtAUD(pa.product.salesGP)}</td>
              <td className="num">{pa.product.qtySold}</td>
              <td className="num">{pa.product.daysSinceSold ?? "—"}</td>
              <td className="num">{pa.score}</td>
              <td>
                <span className={`score-pill ${bandClass(pa.scoreBand)}`}>
                  {pa.scoreBand}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function StockAnalysisReport({
  result,
  onReset,
}: {
  result: AnalysisResult;
  onReset?: () => void;
}) {
  const reportRef = useRef<HTMLDivElement>(null);

  const onPrint = () => window.print();

  const onDownloadHtml = () => {
    if (!reportRef.current) return;
    const inner = reportRef.current.innerHTML;
    const date = result.generatedAt.toISOString().slice(0, 10);
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>FOS Stock Analysis Report — ${date}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="fos-report">${inner}</div>
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FOS_Stock_Analysis_${date}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const t = result.totals;

  return (
    <div className="fos-report">
      <style>{REPORT_CSS}</style>
      <div className="container" ref={reportRef}>
        <div className="header-card">
          <h1>FOS Stock Analysis Report</h1>
          <div className="meta">
            <div><strong>Blackshaws Road Pharmacy</strong></div>
            <div>
              Generated {result.generatedAt.toLocaleString("en-AU")} ·
              {" "}Period {fmtDate(result.periodStart)} → {fmtDate(result.periodEnd)} ({result.periodDays} days)
            </div>
            <div>
              <strong>{t.productCount}</strong> products analysed ·
              {" "}<strong>{t.flagCount}</strong> flags raised
            </div>
          </div>
          <div className="toolbar no-print">
            <button className="btn" onClick={onPrint}>🖨️ Print Report</button>
            <button className="btn" onClick={onDownloadHtml}>📥 Save as HTML</button>
            {onReset && (
              <button className="btn ghost" onClick={onReset}>🔄 Analyse New File</button>
            )}
          </div>
        </div>

        <h2>📊 Executive Summary</h2>
        <div className="kpi-grid">
          <div className="kpi"><div className="label">Total Stock Value</div><div className="value">{fmtAUD(t.stockValue)}</div></div>
          <div className="kpi"><div className="label">Total GP Earned</div><div className="value">{fmtAUD(t.salesGP)}</div></div>
          <div className="kpi"><div className="label">Total Revenue</div><div className="value">{fmtAUD(t.salesVal)}</div></div>
          <div className="kpi"><div className="label">Blended Margin</div><div className="value">{fmtPct(t.blendedMargin)}</div></div>
          <div className="kpi"><div className="label">Products w/ Zero Sales</div><div className="value">{t.zeroSalesCount}</div></div>
          <div className="kpi"><div className="label">Currently Out of Stock</div><div className="value">{t.outOfStockCount}</div></div>
        </div>

        {SECTIONS.map((s) => (
          <Section
            key={s.num}
            result={result}
            num={s.num}
            title={s.title}
            emoji={s.emoji}
            subtitle={s.subtitle}
          />
        ))}

        <Scorecard result={result} />

        <div className="footer-note">
          Generated by FOS Stock Report Cleaner — all analysis performed in your browser.
        </div>
      </div>
    </div>
  );
}
