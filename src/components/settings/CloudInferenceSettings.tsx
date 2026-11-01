import { useEffect, useState } from "react";
import { CheckCircle2, CircleHelp, Cloud, ExternalLink, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ProviderState {
  configured: boolean;
  available: boolean;
  model?: string;
}

type ProviderMap = Record<string, ProviderState>;

const PROVIDER_LABELS: Record<string, string> = {
  OPENAI: "OpenAI",
  GROQ: "Groq",
  GEMINI: "Google Gemini",
  ANTHROPIC: "Anthropic",
  NVIDIA: "NVIDIA",
  TOKENLLM7: "TokenLLM7",
  OVHCLOUD: "OVHcloud",
};

export function CloudInferenceSettings() {
  const [providers, setProviders] = useState<ProviderMap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/provider", { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Provider status unavailable");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setProviders(data?.providers && typeof data.providers === "object" ? data.providers : {});
      })
      .catch(() => {
        if (!cancelled) setProviders(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const configured = providers
    ? Object.entries(providers).filter(([name, provider]) => PROVIDER_LABELS[name] && provider?.configured)
    : [];

  return (
    <Card className="border-indigo-100 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-slate-900"><Cloud className="h-5 w-5 text-indigo-600" /> Managed cloud inference</CardTitle>
        <CardDescription className="mt-2">Provider status below reflects deployment configuration, not a live connection check. Personal provider connections last only while this tab is open.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
          <div className="flex items-start gap-2 text-sm">
            {loading ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-indigo-600" /> : providers === null ? <CircleHelp className="mt-0.5 h-4 w-4 text-slate-500" /> : configured.length ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 text-amber-600" />}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-800" role="status">
                {loading ? "Checking deployment status…" : providers === null ? "Deployment status is unavailable. Cloud inference depends on this StudyPod deployment." : configured.length ? "Configured provider services for this deployment" : "No managed cloud provider is currently configured"}
              </p>
              {configured.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {configured.map(([name, provider]) => (
                    <li key={name} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-slate-700">{PROVIDER_LABELS[name]}{provider.model ? <span className="text-muted-foreground"> · {provider.model}</span> : null}</span>
                      <Badge variant={provider.available ? "secondary" : "outline"}>{provider.available ? "Configured" : "Configured; cooling down or busy"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Configuration does not verify account access or remaining usage limits.</p>
            </div>
          </div>
        </div>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-slate-800">Provider guides</p>
          <p>These guides explain provider setup. They do not connect an account here.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href="https://ai.google.dev/gemini-api/docs/get-started" target="_blank" rel="noreferrer">Gemini API docs <ExternalLink className="h-3 w-3" /></a>
            <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href="https://console.groq.com/docs/quickstart" target="_blank" rel="noreferrer">Groq API docs <ExternalLink className="h-3 w-3" /></a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
