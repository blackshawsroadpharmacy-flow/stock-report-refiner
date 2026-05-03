import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Download } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { ProductAnalysis } from "@/lib/fos-analyzer";
import { fmtAUD, fmtPct } from "@/lib/fos-analyzer";
import {
  productKey,
  useCompetitorPricing,
  type CompetitorMatch,
} from "@/hooks/useCompetitorPricing";
import {
  CONFIDENCE_OPTIONS,
  useConfidenceThreshold,
} from "@/hooks/useConfidenceThreshold";
import { exportCompetitorPricingXlsx } from "@/lib/competitor-excel-export";

type Row = {
  key: string;
  pa: ProductAnalysis;
  match: CompetitorMatch;
  ourPrice: number;
  ourCost: number;
  priceDeltaPct: number; // (ours - avg) / avg
  ourMarginPct: number;
  competitorAvgMarginPct: number; // (avg - ourCost)/avg
  marginGapPct: number; // ours - competitor
  position: "Cheapest" | "Below avg" | "At market" | "Above avg" | "Most expensive";
};

function position(our: number, min: number, avg: number, max: number): Row["position"] {
  if (our <= min * 1.001) return "Cheapest";
  if (our >= max * 0.999) return "Most expensive";
  const diff = (our - avg) / avg;
  if (Math.abs(diff) <= 0.02) return "At market";
  return diff < 0 ? "Below avg" : "Above avg";
}

function positionClass(p: Row["position"]) {
  switch (p) {
    case "Cheapest": return "bg-green-600";
    case "Below avg": return "bg-emerald-500";
    case "At market": return "bg-slate-500";
    case "Above avg": return "bg-amber-500";
    case "Most expensive": return "bg-red-600";
  }
}

const METHOD_LABEL: Record<CompetitorMatch["match_method"], string> = {
  pde: "APN",
  name_exact: "Exact name",
  name_fuzzy: "Fuzzy name",
};

function methodClass(m: CompetitorMatch["match_method"]) {
  switch (m) {
    case "pde": return "bg-green-600";
    case "name_exact": return "bg-emerald-500";
    case "name_fuzzy": return "bg-amber-500";
  }
}

function confidenceClass(c: number) {
  if (c >= 0.95) return "text-green-700";
  if (c >= 0.75) return "text-emerald-600";
  if (c >= 0.6) return "text-amber-600";
  return "text-red-600";
}

export function CompetitorPricingTab({ products }: { products: ProductAnalysis[] }) {
  const productList = useMemo(() => products.map((p) => p.product), [products]);
  const comp = useCompetitorPricing(productList);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "above" | "below" | "match">("all");
  const [minConfidence, setMinConfidence] = useConfidenceThreshold();

  const rows = useMemo<Row[]>(() => {
    if (comp.status !== "success" && comp.status !== "loading") return [];
    const out: Row[] = [];
    products.forEach((pa, idx) => {
      const key = productKey(pa.product, idx);
      const match = comp.matches[key];
      if (!match) return;
      if (match.confidence < minConfidence) return;
      const our = pa.product.sellPrice;
      const cost = pa.product.ws1Cost > 0 ? pa.product.ws1Cost : pa.product.avgCost;
      if (our <= 0) return;
      const ourMargin = pa.product.marginPct || (cost > 0 ? ((our - cost) / our) * 100 : 0);
      const compMargin = cost > 0 && match.avg_price > 0
        ? ((match.avg_price - cost) / match.avg_price) * 100
        : 0;
      out.push({
        key, pa, match,
        ourPrice: our,
        ourCost: cost,
        priceDeltaPct: ((our - match.avg_price) / match.avg_price) * 100,
        ourMarginPct: ourMargin,
        competitorAvgMarginPct: compMargin,
        marginGapPct: ourMargin - compMargin,
        position: position(our, match.min_price, match.avg_price, match.max_price),
      });
    });
    return out;
  }, [products, comp, minConfidence]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (s && !r.pa.product.stockName.toLowerCase().includes(s)) return false;
      if (filter === "above" && r.priceDeltaPct <= 2) return false;
      if (filter === "below" && r.priceDeltaPct >= -2) return false;
      if (filter === "match" && Math.abs(r.priceDeltaPct) > 2) return false;
      return true;
    }).sort((a, b) => Math.abs(b.priceDeltaPct) - Math.abs(a.priceDeltaPct));
  }, [rows, search, filter]);

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    const above = rows.filter((r) => r.priceDeltaPct > 2).length;
    const below = rows.filter((r) => r.priceDeltaPct < -2).length;
    const atMarket = rows.length - above - below;
    const avgGap = rows.reduce((s, r) => s + r.priceDeltaPct, 0) / rows.length;
    const avgMarginGap = rows.reduce((s, r) => s + r.marginGapPct, 0) / rows.length;
    return { above, below, atMarket, avgGap, avgMarginGap };
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>💲 Competitor Pricing — Market Position</CardTitle>
        </CardHeader>
        <CardContent>
          {comp.status === "loading" && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Matching {comp.processedCount.toLocaleString()} of {comp.totalCount.toLocaleString()} products to the competitor database…
                {comp.matchedCount > 0 && (
                  <span> · {comp.matchedCount.toLocaleString()} matched so far</span>
                )}
              </div>
              <Progress value={comp.totalCount ? (comp.processedCount / comp.totalCount) * 100 : 0} />
              {rows.length > 0 && (
                <div className="text-xs text-muted-foreground pt-2">Live preview of matches found so far ({rows.length}). Final stats appear once matching completes.</div>
              )}
            </div>
          )}
          {comp.status === "error" && (
            <Alert variant="destructive">
              <AlertTitle>Couldn't load competitor pricing</AlertTitle>
              <AlertDescription>{comp.error}</AlertDescription>
            </Alert>
          )}
          {comp.status === "success" && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-4">
                <Stat
                  label={minConfidence > 0 ? `Matched ≥${Math.round(minConfidence * 100)}%` : "Matched"}
                  value={`${rows.length} / ${comp.totalCount}`}
                />
                <Stat label="Above market" value={String(stats?.above ?? 0)} tone="warn" />
                <Stat label="At market" value={String(stats?.atMarket ?? 0)} />
                <Stat label="Below market" value={String(stats?.below ?? 0)} tone="good" />
                <Stat
                  label="Avg price vs market"
                  value={`${(stats?.avgGap ?? 0).toFixed(1)}%`}
                  tone={(stats?.avgGap ?? 0) > 0 ? "warn" : "good"}
                />
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                <Input
                  placeholder="Search product…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-xs"
                />
                {(["all","above","below","match"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={
                      "px-3 py-1 rounded-md text-xs border " +
                      (filter === f
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted")
                    }
                  >
                    {f === "all" ? "All" : f === "above" ? "Above market" : f === "below" ? "Below market" : "At market"}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <label htmlFor="conf-threshold" className="text-xs text-muted-foreground">
                    Min confidence
                  </label>
                  <select
                    id="conf-threshold"
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(Number(e.target.value))}
                    className="text-xs border rounded-md px-2 py-1 bg-background"
                  >
                    {CONFIDENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Our $</TableHead>
                      <TableHead className="text-right">Comp avg</TableHead>
                      <TableHead className="text-right">Range</TableHead>
                      <TableHead className="text-right">vs Market</TableHead>
                      <TableHead className="text-right">Our margin</TableHead>
                      <TableHead className="text-right">Comp margin*</TableHead>
                      <TableHead className="text-right">Margin gap</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead className="text-xs text-right">Hits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, 500).map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="max-w-[260px] truncate" title={r.pa.product.stockName}>
                          {r.pa.product.stockName}
                          {r.match.example_vendor && (
                            <div className="text-xs text-muted-foreground truncate">
                              vs {r.match.example_vendor}: {r.match.example_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{fmtAUD(r.ourPrice)}</TableCell>
                        <TableCell className="text-right">{fmtAUD(r.match.avg_price)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {fmtAUD(r.match.min_price)}–{fmtAUD(r.match.max_price)}
                        </TableCell>
                        <TableCell className={"text-right font-medium " + (r.priceDeltaPct > 2 ? "text-red-600" : r.priceDeltaPct < -2 ? "text-green-700" : "")}>
                          {r.priceDeltaPct > 0 ? "+" : ""}{r.priceDeltaPct.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">{fmtPct(r.ourMarginPct)}</TableCell>
                        <TableCell className="text-right">
                          {r.ourCost > 0 ? fmtPct(r.competitorAvgMarginPct) : "—"}
                        </TableCell>
                        <TableCell className={"text-right font-medium " + (r.marginGapPct > 0 ? "text-green-700" : r.marginGapPct < 0 ? "text-red-600" : "")}>
                          {r.ourCost > 0 ? `${r.marginGapPct > 0 ? "+" : ""}${r.marginGapPct.toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={positionClass(r.position)}>{r.position}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={methodClass(r.match.match_method)} title={`Match method: ${METHOD_LABEL[r.match.match_method]}`}>
                            {METHOD_LABEL[r.match.match_method]}
                          </Badge>
                        </TableCell>
                        <TableCell className={"text-right font-medium " + confidenceClass(r.match.confidence)}>
                          {Math.round(r.match.confidence * 100)}%
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground text-right">
                          {r.match.match_count}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-6">No matches for this filter.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                * Competitor margin is estimated using <strong>your</strong> wholesale cost as a proxy
                (assumes similar buy-in). Showing top {Math.min(filtered.length, 500)} of {filtered.length} matches, sorted by largest price gap.
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"font-semibold " + (tone === "good" ? "text-green-700" : tone === "warn" ? "text-amber-600" : "")}>
        {value}
      </div>
    </div>
  );
}
