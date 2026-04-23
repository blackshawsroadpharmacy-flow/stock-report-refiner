import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtAUD } from "@/lib/fos-analyzer";
import { buildIntegrityReport, type CleanedDataset } from "@/lib/deeperDiveUtils";
import type { TGAStatus } from "@/hooks/useTGARecallCheck";
import type { TGAResult } from "@/utils/tga.functions";

export function ComplianceTab({
  dataset,
  tga,
}: {
  dataset: CleanedDataset;
  tga: { status: TGAStatus; result: TGAResult | null; retry: () => void };
}) {
  const report = useMemo(() => buildIntegrityReport(dataset), [dataset]);
  const reliability = report.reliabilityScore;
  const band =
    reliability >= 95
      ? { label: "GOOD", cls: "bg-green-600" }
      : reliability >= 90
        ? { label: "FAIR", cls: "bg-amber-500" }
        : { label: "POOR — ACTION NEEDED", cls: "bg-red-600" };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>🛡️ TGA Recall Check</CardTitle>
        </CardHeader>
        <CardContent>
          {tga.status === "loading" && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Checking TGA recall database...</p>
              <Skeleton className="h-6 w-full" />
            </div>
          )}
          {tga.status === "error" && (
            <Alert className="border-amber-400 bg-amber-50">
              <AlertTitle>Unable to reach TGA recall database</AlertTitle>
              <AlertDescription>
                Check manually at{" "}
                <a className="underline" href="https://www.tga.gov.au/safety/alerts-and-recalls" target="_blank" rel="noreferrer">
                  tga.gov.au/safety/alerts-and-recalls
                </a>
                <button onClick={tga.retry} className="ml-2 underline">Retry</button>
              </AlertDescription>
            </Alert>
          )}
          {tga.status === "success" && tga.result?.ok && !tga.result.recallsFound && (
            <Alert className="border-green-400 bg-green-50">
              <AlertTitle>✅ No TGA recall matches found</AlertTitle>
              <AlertDescription>
                Last checked: {new Date(tga.result.checkedAt).toLocaleString("en-AU")} ·
                {" "}{tga.result.totalRecallsChecked} recall notices reviewed.
              </AlertDescription>
            </Alert>
          )}
          {tga.status === "success" && tga.result?.ok && tga.result.recallsFound && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Recall Notice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tga.result.matches.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell>{m.productName}</TableCell>
                    <TableCell>{m.recallTitle}</TableCell>
                    <TableCell className="text-xs">{m.pubDate}</TableCell>
                    <TableCell>
                      <a className="underline" href={m.recallLink} target="_blank" rel="noreferrer">View</a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>📊 Data Reliability</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">{reliability.toFixed(1)}%</div>
            <Badge className={band.cls}>{band.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Reliability issues affect stock valuations, reorder triggers, and margin reporting. Fix these in Z Office for accurate analytics.
          </p>

          <Accordion type="multiple" className="mt-4">
            <AccordionItem value="neg">
              <AccordionTrigger>Negative SOH Lines ({report.negativeSOH.length})</AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>APN</TableHead>
                      <TableHead>Dept</TableHead>
                      <TableHead className="text-right">SOH</TableHead>
                      <TableHead className="text-right">Cost $</TableHead>
                      <TableHead className="text-right">Implied Error $</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.negativeSOH.slice(0, 100).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.stockName}</TableCell>
                        <TableCell>{p.apn}</TableCell>
                        <TableCell>{p.dept}</TableCell>
                        <TableCell className="text-right">{p.soh}</TableCell>
                        <TableCell className="text-right">{fmtAUD(p.cost)}</TableCell>
                        <TableCell className="text-right">{fmtAUD(Math.abs(p.soh * p.cost))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="cost">
              <AccordionTrigger>No Cost Data ({report.noCostData.length})</AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>APN</TableHead>
                      <TableHead>Dept</TableHead>
                      <TableHead className="text-right">SOH</TableHead>
                      <TableHead className="text-right">Sell $</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.noCostData.slice(0, 100).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.stockName}</TableCell>
                        <TableCell>{p.apn}</TableCell>
                        <TableCell>{p.dept}</TableCell>
                        <TableCell className="text-right">{p.soh}</TableCell>
                        <TableCell className="text-right">{fmtAUD(p.sellPrice)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="sell">
              <AccordionTrigger>No Sell Price ({report.noSellPrice.length})</AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>APN</TableHead>
                      <TableHead>Dept</TableHead>
                      <TableHead className="text-right">SOH</TableHead>
                      <TableHead className="text-right">Cost $</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.noSellPrice.slice(0, 100).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.stockName}</TableCell>
                        <TableCell>{p.apn}</TableCell>
                        <TableCell>{p.dept}</TableCell>
                        <TableCell className="text-right">{p.soh}</TableCell>
                        <TableCell className="text-right">{fmtAUD(p.cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
