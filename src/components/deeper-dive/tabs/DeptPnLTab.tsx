import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fmtAUD, fmtPct } from "@/lib/fos-analyzer";
import { buildDeptPnL, type CleanedProduct } from "@/lib/deeperDiveUtils";

export function DeptPnLTab({ data }: { data: CleanedProduct[] }) {
  const rows = useMemo(() => buildDeptPnL(data), [data]);
  const chartData = rows.slice(0, 15).map((r) => ({
    dept: (r.dept || "—").slice(0, 20),
    gp: Math.round(r.gp),
    margin: r.avgMargin,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Department P&amp;L Matrix</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Revenue $</TableHead>
                <TableHead className="text-right">GP $</TableHead>
                <TableHead className="text-right">Avg Margin %</TableHead>
                <TableHead className="text-right">SKUs</TableHead>
                <TableHead className="text-right">Stock $</TableHead>
                <TableHead className="text-right">GP ROI</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.dept}>
                  <TableCell className="font-medium">{r.dept}</TableCell>
                  <TableCell className="text-right">{fmtAUD(r.revenue)}</TableCell>
                  <TableCell className="text-right">{fmtAUD(r.gp)}</TableCell>
                  <TableCell className="text-right">
                    {r.avgMargin < 20 ? (
                      <Badge variant="destructive">{fmtPct(r.avgMargin)}</Badge>
                    ) : (
                      fmtPct(r.avgMargin)
                    )}
                  </TableCell>
                  <TableCell className="text-right">{r.skuCount}</TableCell>
                  <TableCell className="text-right">{fmtAUD(r.stockInvestment)}</TableCell>
                  <TableCell className="text-right">
                    {r.gpRoi > 3.0 ? (
                      <Badge className="bg-green-600">{r.gpRoi.toFixed(2)}x</Badge>
                    ) : r.gpRoi < 0.5 && r.stockInvestment > 500 ? (
                      <Badge variant="destructive">{r.gpRoi.toFixed(2)}x</Badge>
                    ) : (
                      `${r.gpRoi.toFixed(2)}x`
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top 15 Departments by GP$</CardTitle></CardHeader>
        <CardContent style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
              <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="dept" width={140} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number, k: string) =>
                  k === "gp" ? fmtAUD(v) : fmtPct(v)
                }
              />
              <Bar dataKey="gp" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
