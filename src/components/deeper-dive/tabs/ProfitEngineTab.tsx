import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtAUD, fmtPct } from "@/lib/fos-analyzer";
import type { CleanedProduct, ProfitEngineResult } from "@/lib/deeperDiveUtils";

export function ProfitEngineTab({
  profitEngine,
}: {
  data: CleanedProduct[];
  profitEngine: ProfitEngineResult;
}) {
  const { top20, top20GpSum, top20GpPct, starsAtRisk } = profitEngine;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Top 20 GP Contribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtPct(top20GpPct)}</div>
            <div className="text-xs text-muted-foreground">of total portfolio GP</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Top 20 Total GP$</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtAUD(top20GpSum)}</div>
          </CardContent>
        </Card>
        <Card className={starsAtRisk.length > 0 ? "border-destructive" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Stars at Stockout Risk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${starsAtRisk.length > 0 ? "text-destructive" : ""}`}>
              {starsAtRisk.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {starsAtRisk.length > 0 && (
        <Alert className="border-orange-400 bg-orange-50">
          <AlertTitle>⚠️ High-margin lines within 60 days of stockout</AlertTitle>
          <AlertDescription>
            <div className="mt-2 text-sm">Reorder immediately: {starsAtRisk.map((p) => p.stockName).join(", ")}</div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Top 20 Profit Engine</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Dept</TableHead>
                <TableHead className="text-right">GP $</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead className="text-right">Revenue $</TableHead>
                <TableHead className="text-right">SOH</TableHead>
                <TableHead className="text-right">Days Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top20.map(({ rank, product: p }) => {
                const critical = (p.daysOfStockLeft !== null && p.daysOfStockLeft < 30) || p.soh === 0;
                const warn = p.daysOfStockLeft !== null && p.daysOfStockLeft >= 30 && p.daysOfStockLeft < 60;
                return (
                  <TableRow
                    key={rank}
                    className={critical ? "bg-red-50" : warn ? "bg-amber-50" : ""}
                  >
                    <TableCell>{rank}</TableCell>
                    <TableCell className="font-medium">{p.stockName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.dept}</TableCell>
                    <TableCell className="text-right">{fmtAUD(p.salesGP)}</TableCell>
                    <TableCell className="text-right">{fmtPct(p.marginPct)}</TableCell>
                    <TableCell className="text-right">{fmtAUD(p.salesVal)}</TableCell>
                    <TableCell className="text-right">{p.soh}</TableCell>
                    <TableCell className="text-right">{p.daysOfStockLeft ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            Tip: These 20 lines deserve dedicated shelf monitoring. Set a physical reorder reminder for any line shown in red or amber.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
