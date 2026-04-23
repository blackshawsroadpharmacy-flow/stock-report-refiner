import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  SEASONAL_CALENDAR,
  buildSeasonalIntel,
  buildDemographicCoverage,
  type CleanedProduct,
} from "@/lib/deeperDiveUtils";

export function MarketIntelTab({ data }: { data: CleanedProduct[] }) {
  const seasonal = useMemo(() => buildSeasonalIntel(data), [data]);
  const demo = useMemo(() => buildDemographicCoverage(data), [data]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>🗓️ Seasonal Demand — {seasonal.currentSeason}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {seasonal.categories.map((c) => (
              <div key={c.category} className="border rounded-md p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.category}</div>
                  <div className="text-xs text-muted-foreground">{c.matchedSkus} SKU(s) in stock</div>
                </div>
                <Badge
                  className={
                    c.status === "WELL STOCKED"
                      ? "bg-green-600"
                      : c.status === "LOW STOCK"
                        ? "bg-red-600"
                        : "bg-amber-500"
                  }
                >
                  {c.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>👥 Local Demographics — Altona North 3025</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
            <div><div className="text-xs text-muted-foreground">Median age</div><div className="font-semibold">36 yrs</div></div>
            <div><div className="text-xs text-muted-foreground">Aged 65+</div><div className="font-semibold">14.2%</div></div>
            <div><div className="text-xs text-muted-foreground">Median income</div><div className="font-semibold">$91,000</div></div>
            <div><div className="text-xs text-muted-foreground">SEIFA</div><div className="font-semibold">1,002</div></div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Health Category</TableHead>
                <TableHead className="text-right">SKUs</TableHead>
                <TableHead className="text-right">Top Line Days Left</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {demo.map((d) => (
                <TableRow key={d.name}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell className="text-right">{d.skuCount}</TableCell>
                  <TableCell className="text-right">{d.topLineDaysLeft ?? "—"}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        d.status === "COVERED"
                          ? "bg-green-600"
                          : d.status === "THIN RANGE"
                            ? "bg-amber-500"
                            : "bg-red-600"
                      }
                    >
                      {d.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>💲 Live Competitor Pricing</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>Not enabled in this build</AlertTitle>
            <AlertDescription>
              This panel is scaffolded only. To add it later, wire up a pricing source via a server function.
            </AlertDescription>
          </Alert>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Our Price</TableHead>
                <TableHead>Competitor A</TableHead>
                <TableHead>Competitor B</TableHead>
                <TableHead>Position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell>—</TableCell>
                <TableCell>—</TableCell>
                <TableCell>—</TableCell>
                <TableCell>—</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Full seasonal calendar</summary>
        <pre className="mt-2 whitespace-pre-wrap">{JSON.stringify(SEASONAL_CALENDAR, null, 2)}</pre>
      </details>
    </div>
  );
}
