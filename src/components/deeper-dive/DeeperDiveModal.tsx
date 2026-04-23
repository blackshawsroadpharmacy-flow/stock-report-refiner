import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AnalysisResult } from "@/lib/fos-analyzer";
import { cleanDataset, buildProfitEngine } from "@/lib/deeperDiveUtils";
import { useStrategicAnalyst } from "@/hooks/useStrategicAnalyst";
import { useTGARecallCheck } from "@/hooks/useTGARecallCheck";
import { ProfitEngineTab } from "./tabs/ProfitEngineTab";
import { DeptPnLTab } from "./tabs/DeptPnLTab";
import { CapitalReleaseTab } from "./tabs/CapitalReleaseTab";
import { ActionCardTab } from "./tabs/ActionCardTab";
import { MarketIntelTab } from "./tabs/MarketIntelTab";
import { ComplianceTab } from "./tabs/ComplianceTab";
import { StrategicAnalystTab } from "./tabs/StrategicAnalystTab";

export function DeeperDiveModal({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  result: AnalysisResult;
}) {
  const ds = useMemo(() => cleanDataset(result.products, result.periodDays), [result]);
  const profitEngine = useMemo(() => buildProfitEngine(ds.cleanedData), [ds]);
  const analyst = useStrategicAnalyst(ds, result.periodDays);

  const productNames = useMemo(
    () => ds.cleanedData.map((p) => p.stockName).filter(Boolean),
    [ds],
  );
  const tga = useTGARecallCheck(productNames, open);
  const [tab, setTab] = useState("profit");

  const tgaUrgent =
    tga.status === "success" && tga.result?.ok && tga.result.recallsFound;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none rounded-none p-0 flex flex-col gap-0 sm:rounded-none">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="text-xl">🔍 Deeper Dive Analysis</DialogTitle>
          {tgaUrgent && (
            <Alert variant="destructive" className="mt-2">
              <AlertTitle>🚨 URGENT: Potential TGA recall match found</AlertTitle>
              <AlertDescription>See the Compliance tab for details.</AlertDescription>
            </Alert>
          )}
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-3 flex flex-wrap h-auto justify-start gap-1 bg-muted">
            <TabsTrigger value="profit">💰 Profit Engine</TabsTrigger>
            <TabsTrigger value="dept">🏢 Dept P&amp;L</TabsTrigger>
            <TabsTrigger value="capital">🧊 Capital Release</TabsTrigger>
            <TabsTrigger value="action">📋 Action Card</TabsTrigger>
            <TabsTrigger value="market">🌐 Market Intel</TabsTrigger>
            <TabsTrigger value="compliance">🛡️ Compliance</TabsTrigger>
            <TabsTrigger value="analyst">✨ Strategic Analyst</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-6">
              <TabsContent value="profit" className="mt-0">
                <ProfitEngineTab data={ds.cleanedData} profitEngine={profitEngine} />
              </TabsContent>
              <TabsContent value="dept" className="mt-0">
                <DeptPnLTab data={ds.cleanedData} />
              </TabsContent>
              <TabsContent value="capital" className="mt-0">
                <CapitalReleaseTab data={ds.cleanedData} />
              </TabsContent>
              <TabsContent value="action" className="mt-0">
                <ActionCardTab
                  cleanedData={ds.cleanedData}
                  negativeSOHLines={ds.negativeSOHLines}
                  profitEngine={profitEngine}
                />
              </TabsContent>
              <TabsContent value="market" className="mt-0">
                <MarketIntelTab data={ds.cleanedData} />
              </TabsContent>
              <TabsContent value="compliance" className="mt-0">
                <ComplianceTab dataset={ds} tga={tga} />
              </TabsContent>
              <TabsContent value="analyst" className="mt-0">
                <StrategicAnalystTab analyst={analyst} />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
