import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalystState } from "@/hooks/useStrategicAnalyst";
import type { StrategicReport } from "@/lib/deeperDiveUtils";

function renderInline(text: string) {
  // Tiny **bold** parser
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function StrategicAnalystTab({
  analyst,
}: {
  analyst: { state: AnalystState; report: StrategicReport | null; error: string | null; retry: () => void };
}) {
  if (analyst.state === "loading" || analyst.state === "idle") {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <CardTitle>✨ Strategic Analyst is reviewing your 12-month portfolio data...</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Generated locally from your current stock data
          </p>
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-5/6 mb-2" />
          <Skeleton className="h-4 w-4/6" />
        </CardContent>
      </Card>
    );
  }

  if (analyst.state === "error" || !analyst.report) {
    return (
      <Alert className="border-amber-400 bg-amber-50">
        <AlertTitle>Strategic Analyst is temporarily unavailable</AlertTitle>
        <AlertDescription>
          The analysis above in the other tabs is complete and does not depend on any external AI.
          <div className="mt-3">
            <Button onClick={analyst.retry} size="sm">Retry</Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const r = analyst.report;
  return (
    <Card>
      <CardHeader>
        <CardTitle>✨ Strategic Analyst — Blackshaws Road Pharmacy</CardTitle>
        <p className="text-xs text-muted-foreground">
          Generated {r.generatedAt.toLocaleString("en-AU")}
        </p>
      </CardHeader>
      <CardContent className="prose max-w-none">
        {r.sections.map((s, i) => (
          <section key={i} className="mb-6">
            <h2 className="text-lg font-bold text-primary mb-2">{s.heading}</h2>
            {s.paragraphs.map((p, j) => (
              <p key={j} className="text-sm mb-2">{renderInline(p)}</p>
            ))}
            {s.bullets && (
              <ul className="list-disc pl-6 text-sm space-y-1">
                {s.bullets.map((b, j) => (
                  <li key={j}>{renderInline(b)}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <p className="text-xs text-muted-foreground border-t pt-3">
          Generated locally from your uploaded FOS dataset. This summary is deterministic and based on current business rules, not an external AI model.
        </p>
      </CardContent>
    </Card>
  );
}
