import { useEffect, useState } from "react";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getOllamaBaseUrl, setRuntimeOllamaBaseUrl } from "@/config/ollamaConfig";
import { getLocalModelSettings, saveLocalModelSettings, setLocalModelApiKey, type LocalModelProvider } from "@/config/localModelConfig";
import { checkCompatibleLocalModel } from "@/lib/ai/openAICompatibleLocalClient";
import { CheckCircle2, ExternalLink, Loader2, Server, XCircle } from "lucide-react";

const providerNames: Record<LocalModelProvider, string> = { ollama: "Ollama", "lm-studio": "LM Studio", custom: "Other compatible server" };

export function LocalInferenceSettings() {
  const [localSettings, setLocalSettings] = useState(() => getLocalModelSettings());
  const [endpoint, setEndpoint] = useState(() => localSettings.provider === "ollama" ? getOllamaBaseUrl() : localSettings.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [endpointError, setEndpointError] = useState("");
  const [endpointSaved, setEndpointSaved] = useState(false);
  const [compatibleStatus, setCompatibleStatus] = useState<"idle" | "checking" | "ready" | "unavailable">("idle");
  const [compatibleMessage, setCompatibleMessage] = useState("");
  const [compatibleModels, setCompatibleModels] = useState<string[]>([]);
  const browserOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const {
    ollamaEnabled, setOllamaEnabled, discoveryStatus, discoveryMessage,
    installedModels, defaultModels, setDefaultModel, refetchHealth, refetchModels, refreshEndpoint,
  } = useOllamaModels();
  const provider = localSettings.provider;
  useEffect(() => {
    if (provider !== "ollama") setOllamaEnabled(false);
  }, [provider, setOllamaEnabled]);
  const enabled = provider === "ollama" ? ollamaEnabled : localSettings.enabled;
  const status = provider === "ollama" ? discoveryStatus : compatibleStatus;
  const message = provider === "ollama" ? discoveryMessage : compatibleMessage;
  const models = provider === "ollama" ? installedModels : compatibleModels;

  function chooseProvider(value: LocalModelProvider) {
    // A compatible provider is selected only while enabled. Keep the legacy
    // build-time Ollama opt-in off so disabling it cannot fall through to Ollama.
    if (value !== "ollama") setOllamaEnabled(false);
    setLocalModelApiKey("");
    setApiKey("");
    const next = saveLocalModelSettings({ provider: value });
    setLocalSettings(next);
    setEndpoint(value === "ollama" ? getOllamaBaseUrl() : next.baseUrl);
    setEndpointError("");
    setCompatibleStatus("idle");
    setCompatibleMessage("");
    setCompatibleModels([]);
  }

  async function checkConnection() {
    if (provider === "ollama") {
      const health = await refetchHealth();
      if (health.data === true) await refetchModels();
      return health.data === true;
    }
    setCompatibleStatus("checking");
    const result = await checkCompatibleLocalModel();
    setCompatibleStatus(result.ok ? "ready" : "unavailable");
    setCompatibleMessage(result.message);
    setCompatibleModels(result.models);
    if (result.ok && !localSettings.model) {
      const next = saveLocalModelSettings({ model: result.models[0] });
      setLocalSettings(next);
    }
  }

  async function saveConnection() {
    try {
      if (provider === "ollama") {
        setRuntimeOllamaBaseUrl(endpoint);
        const selectedEndpoint = refreshEndpoint();
        setEndpoint(selectedEndpoint);
      } else {
        const saved = saveLocalModelSettings({ baseUrl: endpoint });
        setLocalSettings(saved);
        setEndpoint(saved.baseUrl);
        setLocalModelApiKey(apiKey);
        setApiKey("");
        setCompatibleStatus("checking");
        setCompatibleMessage("");
        const result = await checkCompatibleLocalModel();
        setCompatibleStatus(result.ok ? "ready" : "unavailable");
        setCompatibleMessage(result.message);
        setCompatibleModels(result.models);
        if (result.ok) {
          const connected = saveLocalModelSettings({
            enabled: true,
            ...(!saved.model && result.models[0] ? { model: result.models[0] } : {}),
          });
          setLocalSettings(connected);
        }
      }
      setEndpointError("");
      if (provider === "ollama") {
        const connected = await checkConnection();
        if (connected && !enabled) setOllamaEnabled(true);
      }
      setEndpointSaved(true);
    } catch (error) {
      setEndpointSaved(false);
      setEndpointError(error instanceof Error ? error.message : "Enter a valid endpoint URL.");
    }
  }

  function useDefaultEndpoint() {
    if (provider === "ollama") {
      setRuntimeOllamaBaseUrl(null);
      setEndpoint(refreshEndpoint());
    } else {
      const defaultUrl = provider === "lm-studio" ? "http://localhost:1234/v1" : "http://localhost:8000/v1";
      const next = saveLocalModelSettings({ baseUrl: defaultUrl });
      setLocalSettings(next);
      setEndpoint(next.baseUrl);
    }
    setEndpointError("");
  }

  function toggleEnabled(checked: boolean) {
    if (provider === "ollama") setOllamaEnabled(checked);
    else {
      // Explicitly opt out of Ollama for every compatible-provider state.
      setOllamaEnabled(false);
      const next = saveLocalModelSettings({ enabled: checked });
      setLocalSettings(next);
      if (!checked) { setCompatibleStatus("idle"); setCompatibleMessage(""); }
      else void checkConnection();
    }
  }

  const connected = status === "ready";
  const statusMessage = message || (!enabled
    ? `${providerNames[provider]} is off. Turn it on to discover models.`
    : status === "idle" && provider !== "ollama"
      ? "Not checked yet. Re-enter the API key after reloading if your server requires one."
      : `${providerNames[provider]} is on. Check the connection to discover models.`);
  return (
    <Card className="border-indigo-100 bg-white shadow-sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-slate-900"><Server className="h-5 w-5 text-indigo-600" /> Local model</CardTitle>
            <CardDescription className="mt-2">Connect a model running on this computer or another computer you can reach.</CardDescription>
          </div>
          <Switch aria-label={`Enable ${providerNames[provider]}`} checked={enabled} onCheckedChange={toggleEnabled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="space-y-1 text-sm font-medium text-slate-700" htmlFor="local-model-provider">
            Connect with
            <select id="local-model-provider" value={provider} onChange={(event) => chooseProvider(event.target.value as LocalModelProvider)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal text-slate-900">
              <option value="ollama">Ollama</option><option value="lm-studio">LM Studio</option><option value="custom">Other compatible server</option>
            </select>
          </label>
          <Button type="button" variant="outline" onClick={() => void checkConnection()} disabled={!enabled || status === "checking"}>
            {status === "checking" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{status === "checking" ? "Checking…" : "Check connection"}
          </Button>
        </div>

        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
          <label htmlFor="local-model-endpoint" className="text-sm font-medium text-slate-800">Server address</label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input id="local-model-endpoint" type="url" inputMode="url" value={endpoint} onChange={(event) => { setEndpoint(event.target.value); setEndpointSaved(false); setEndpointError(""); }} placeholder={provider === "ollama" ? "http://localhost:11434" : "http://localhost:1234/v1"} aria-invalid={Boolean(endpointError)} className="block min-w-0 flex-1 rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" />
            <Button type="button" variant="outline" size="sm" onClick={saveConnection}>Save and check</Button>
          </div>
          <button type="button" className="mt-2 text-xs text-indigo-700 underline underline-offset-2" onClick={useDefaultEndpoint}>Use default address</button>
          {provider !== "ollama" && <p className="mt-2 text-xs text-muted-foreground">Use the server’s API address. Key optional; kept until reload or provider change.</p>}
          {provider !== "ollama" && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input aria-label="Local server API key (optional)" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setLocalModelApiKey(event.target.value); }} placeholder="API key (if required)" className="block min-w-0 flex-1 rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-800" />
          </div>}
          {provider === "ollama" && <p className="mt-2 text-xs text-muted-foreground">When you use StudyPod in a browser, localhost means the computer running that browser.</p>}
          {endpointSaved && <p role="status" className="mt-2 text-xs text-emerald-700">Address saved.</p>}
          {endpointError && <p role="alert" className="mt-2 text-xs text-red-700">{endpointError}</p>}
        </div>

        <div role="status" className="flex items-start gap-2 text-sm">
          {status === "ready" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : status === "unavailable" ? <XCircle className="mt-0.5 h-4 w-4 text-red-600" /> : null}
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span>{statusMessage}</span>{connected && <Badge variant="secondary">Connected</Badge>}</div>
            {status === "no-models" && <p className="mt-1 text-xs text-muted-foreground">Ollama is running, but no models are installed. Install one with the Ollama app or run <code>ollama pull llama3.2</code>.</p>}
            {status === "unavailable" && provider === "ollama" && <p className="mt-1 text-xs text-muted-foreground">Check that Ollama is running and this browser can reach it.</p>}
            {status === "unavailable" && provider !== "ollama" && <p className="mt-1 text-xs text-muted-foreground">Check the server address and that its API is running.</p>}
          </div>
        </div>

        {models.length > 0 && <div className="grid gap-3 sm:grid-cols-3">
          {provider === "ollama" ? (["chat", "embedding", "code"] as const).map((task) => (
            <label key={task} className="space-y-2 text-sm font-medium capitalize text-slate-700">{task} model
              <Select value={defaultModels[task]} onValueChange={(value) => setDefaultModel(task, value)} disabled={!enabled || models.length === 0}>
                <SelectTrigger aria-label={`${task} model`}><SelectValue placeholder="Choose a model" /></SelectTrigger>
                <SelectContent>{models.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          )) : <label className="space-y-2 text-sm font-medium text-slate-700">Chat model
            <select aria-label="Chat model" value={localSettings.model} onChange={(event) => setLocalSettings(saveLocalModelSettings({ model: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal">
              {models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>}
        </div>}

        {provider === "ollama" && <details className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
          <summary className="cursor-pointer font-medium">Advanced and troubleshooting</summary>
          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            <p>Allow this exact browser origin in Ollama’s <code>OLLAMA_ORIGINS</code> setting, then restart Ollama. Avoid <code>*</code>. Current origin: <code aria-label="Current browser origin" className="break-all">{browserOrigin || "Unavailable during server rendering"}</code></p>
            <p>On the live website, allow its local-network access prompt. Browser permissions and Ollama origin settings are separate.</p>
            <a className="inline-flex items-center gap-1 font-medium text-indigo-700 underline" href="https://ollama.com/download" target="_blank" rel="noreferrer">Download Ollama <ExternalLink className="h-3 w-3" /></a>
          </div>
        </details>}
        {!enabled && <p className="text-xs text-muted-foreground">Your selected local server is off. Cloud providers Groq and Gemini are configured separately.</p>}
      </CardContent>
    </Card>
  );
}
