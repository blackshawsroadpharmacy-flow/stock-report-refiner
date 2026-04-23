import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AnalysisResult } from "@/lib/fos-analyzer";
import { DeeperDiveModal } from "./DeeperDiveModal";

export function DeeperDiveButton({ result }: { result: AnalysisResult }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="my-6 flex justify-center no-print">
        <Button
          size="lg"
          onClick={() => setOpen(true)}
          className="w-full sm:w-auto text-base px-8 py-6 bg-primary text-primary-foreground shadow-lg hover:opacity-90"
        >
          🔍 Deeper Dive Analysis
        </Button>
      </div>
      {open && <DeeperDiveModal open={open} onOpenChange={setOpen} result={result} />}
    </>
  );
}
