import { useCallback, useEffect, useState } from "react";
import { checkTGARecalls, type TGAResult } from "@/utils/tga.functions";

export type TGAStatus = "idle" | "loading" | "success" | "error";

export function useTGARecallCheck(productNames: string[], enabled: boolean) {
  const [status, setStatus] = useState<TGAStatus>("idle");
  const [result, setResult] = useState<TGAResult | null>(null);

  const run = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await checkTGARecalls({ data: { productNames } });
      setResult(res);
      setStatus(res.ok ? "success" : "error");
    } catch {
      setResult({ ok: false, error: "NETWORK_ERROR", checkedAt: new Date().toISOString() });
      setStatus("error");
    }
  }, [productNames]);

  useEffect(() => {
    if (enabled && status === "idle") void run();
  }, [enabled, status, run]);

  return { status, result, retry: run };
}
