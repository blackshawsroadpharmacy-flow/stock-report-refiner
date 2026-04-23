import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmtAUD } from "@/lib/fos-analyzer";
import { buildCapitalRelease, type CleanedProduct } from "@/lib/deeperDiveUtils";

export function CapitalReleaseTab({ data }: { data: CleanedProduct[] }) {
  const result = useMemo(() => buildCapitalRelease(data), [data]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Total Capital in Slow Stock: {fmtAUD(result.totalCapital)}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Stock on hand with no sales in 180+ days. Returning, discounting, or donating these lines could release this capital for better-performing stock.
          </p>
        </CardContent>
      </Card>

      {result.hasCovidStock && (
        <Alert variant="destructive">
          <AlertTitle>⚠️ COVID RAT Stock Alert</AlertTitle>
          <AlertDescription>
            You have COVID-related products in slow stock. These may reach expiry before sale. Check expiry dates and consider writing down or donating to a community health centre.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Dept</TableHead>
                <TableHead className="text-right">SOH</TableHead>
                <TableHead className="text-right">Stock $</TableHead>
                <TableHead className="text-right">Days Since Sold</TableHead>
                <TableHead>Suggested Action</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.slice(0, 200).map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.product.stockName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.product.dept}</TableCell>
                  <TableCell className="text-right">{r.product.soh}</TableCell>
                  <TableCell className="text-right">{fmtAUD(r.product.stockValue)}</TableCell>
                  <TableCell className="text-right">{r.product.daysSinceSold ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.suggestedAction}</TableCell>
                  <TableCell>
                    {r.priority === "high" && <Badge variant="destructive">⚠️ High</Badge>}
                    {r.priority === "medium" && <Badge className="bg-amber-500">Medium</Badge>}
                    {r.priority === "low" && <Badge variant="secondary">Low</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            Talk to your Sigma/API rep about returning slow-moving stock. Many wholesalers offer returns on non-PBS stock within 12 months of purchase.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
