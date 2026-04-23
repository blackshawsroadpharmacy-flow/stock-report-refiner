import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  buildActionCard,
  type CleanedProduct,
  type ProfitEngineResult,
} from "@/lib/deeperDiveUtils";

export function ActionCardTab({
  cleanedData,
  negativeSOHLines,
  profitEngine,
}: {
  cleanedData: CleanedProduct[];
  negativeSOHLines: CleanedProduct[];
  profitEngine: ProfitEngineResult;
}) {
  const rows = useMemo(
    () => buildActionCard(cleanedData, negativeSOHLines, profitEngine),
    [cleanedData, negativeSOHLines, profitEngine],
  );
  const [done, setDone] = useState<Record<number, boolean>>({});
  const today = new Date().toLocaleDateString("en-AU");

  return (
    <div className="space-y-4">
      <div className="flex justify-end no-print">
        <Button onClick={() => window.print()}>🖨️ Print Action List</Button>
      </div>
      <div id="print-action-card">
        <Card>
          <CardHeader>
            <CardTitle>BLACKSHAWS ROAD PHARMACY — DAILY STOCK ACTION LIST</CardTitle>
            <p className="text-sm text-muted-foreground">
              Generated: {today} | Manager to review before distributing
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">✓</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Action Type</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Do This</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const isDone = !!done[i];
                  return (
                    <TableRow
                      key={i}
                      className={isDone ? "opacity-50 line-through" : ""}
                      style={{ pageBreakInside: "avoid" }}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isDone}
                          onCheckedChange={(v) =>
                            setDone((d) => ({ ...d, [i]: !!v }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={r.priorityColor === "red" ? "destructive" : "secondary"}
                          className={
                            r.priorityColor === "orange"
                              ? "bg-orange-500 text-white"
                              : r.priorityColor === "yellow"
                                ? "bg-amber-400 text-black"
                                : ""
                          }
                        >
                          {r.priorityColor.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold">{r.bucket}</TableCell>
                      <TableCell>{(r.product.stockName || "").slice(0, 35)}</TableCell>
                      <TableCell className="text-xs">{r.why}</TableCell>
                      <TableCell className="text-xs">{r.doThis}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="mt-6 text-sm">
              Completed by: _______________ Date: ___/___/______
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
