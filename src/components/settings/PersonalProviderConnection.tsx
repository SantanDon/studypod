import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldCheck, Unplug } from 'lucide-react';
import { API_BASE_URL } from '@/config/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clearPersonalProviderConnection, connectPersonalProvider, getPersonalProviderConnection, PersonalProvider, redactPersonalProviderKey, subscribePersonalProvider } from '@/lib/ai/personalProviderContext';

const PROVIDERS: Record<PersonalProvider, { label: string; keyUrl: string }> = {
  groq: { label: 'Groq', keyUrl: 'https://console.groq.com/keys' },
  gemini: { label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey' },
};

export function PersonalProviderConnection() {
  const [provider, setProvider] = useState<PersonalProvider>('groq');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [connection, setConnection] = useState(getPersonalProviderConnection());
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribePersonalProvider(() => setConnection(getPersonalProviderConnection()));
    // Keep the effect cleanup explicitly void even if the subscription API's
    // Set.delete return type changes; React cleanup callbacks cannot return it.
    return () => { unsubscribe(); };
  }, []);

  async function testAndConnect() {
    setError(null);
    if (!apiKey.trim()) { setError('Enter your API key to test the connection.'); return; }
    setTesting(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-StudyPod-Provider': provider,
        'X-StudyPod-Api-Key': apiKey.trim(),
      };
      if (model.trim()) headers['X-StudyPod-Model'] = model.trim();
      const response = await fetch(`${API_BASE_URL}/ai/provider/test`, {
        method: 'POST', credentials: 'include', headers, body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Provider connection test failed. Check the key and try again.');
      connectPersonalProvider(provider, apiKey, model);
      setApiKey('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not test this provider. Check your connection and try again.';
      setError(redactPersonalProviderKey(message, apiKey.trim()));
    } finally {
      setTesting(false);
    }
  }

  function disconnect() {
    clearPersonalProviderConnection();
    setApiKey('');
    setError(null);
  }

  const selected = PROVIDERS[provider];
  return (
    <Card className="border-indigo-100 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-slate-900"><KeyRound className="h-5 w-5 text-indigo-600" /> Connect your provider</CardTitle>
        <CardDescription>Connect Groq or Gemini with your own API key.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connection ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" /> {PROVIDERS[connection.provider].label} connected{connection.model ? ` · ${connection.model}` : ''}</div>
            <Button type="button" variant="outline" size="sm" onClick={disconnect}><Unplug className="mr-2 h-4 w-4" />Disconnect</Button>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="personal-provider">Provider</Label>
                <select id="personal-provider" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={provider} onChange={(event) => setProvider(event.target.value as PersonalProvider)}>
                  <option value="groq">Groq</option><option value="gemini">Google Gemini</option>
                </select>
                <a className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2" href={selected.keyUrl} target="_blank" rel="noreferrer">Get a key from {selected.label} <ExternalLink className="h-3 w-3" /></a>
              </div>
              <div className="space-y-2">
                <Label htmlFor="personal-provider-model">Model (optional)</Label>
                <Input id="personal-provider-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Use the provider default" autoComplete="off" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="personal-provider-key">API key</Label>
              <Input id="personal-provider-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder="Paste your provider key" />
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" /> Held in this page’s memory. Sent to StudyPod, then your chosen provider, for requests. Cleared on reload or disconnect.</p>
            </div>
            {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <Button type="button" onClick={testAndConnect} disabled={testing || !apiKey.trim()}>{testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{testing ? 'Testing provider…' : 'Test and connect'}</Button>
          </>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">How provider requests work</summary>
          <p className="mt-2">Requests use the provider you select. If one fails, StudyPod shows the error; it does not switch providers. Local inference is configured separately.</p>
        </details>
      </CardContent>
    </Card>
  );
}
