import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Terminal, ExternalLink, Globe, CheckCircle2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

export function DeveloperSettings() {
  const { session, loading } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const currentToken = session?.access_token || '';

  const copyToken = () => {
    if (!currentToken) return;
    navigator.clipboard.writeText(currentToken);
    setCopied(true);
    toast({
      title: 'API Key Copied!',
      description: 'Paste this into your AI agent when it asks for a StudyPodLM API key.',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">

      {/* API Key Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-muted-foreground" />
            Your API Key
          </CardTitle>
          <CardDescription>
            Give this key to any AI agent to connect it to your account. No setup needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Verifying your session...
            </div>
          ) : !currentToken ? (
            <div className="flex flex-col items-center gap-4 py-6 border-2 border-dashed rounded-xl bg-muted/20">
              <p className="text-sm font-medium text-center text-muted-foreground max-w-xs">
                You need to be signed in to access your API key.
              </p>
              <Button
                variant="default"
                onClick={() => window.location.href = '/auth'}
              >
                <Globe className="w-4 h-4 mr-2" />
                Sign In
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground">Session Token (your API key)</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${currentToken.substring(0, 48)}...`}
                  className="font-mono text-[11px] h-9 bg-muted border-muted-foreground/20"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={copyToken}
                  title="Copy full API key"
                >
                  {copied
                    ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                    : <Copy className="w-4 h-4" />
                  }
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>How to use:</strong> When your AI agent asks for an API key or auth token, paste the copied value. 
                Keys refresh each session — sign in again if yours expires.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Headless Dropbox</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              StudyPod is E2EE. Agents pushing files to the "Dropbox" route do <b>not</b> need your passphrase.
              Uploads are automatically encrypted when you next open the notebook.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Developer Documentation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" size="sm" className="w-full text-[11px] h-7" asChild>
              <a href="/API_HEADLESS.md" target="_blank" rel="noreferrer">
                <ExternalLink className="w-3 h-3 mr-1" /> View Headless API Guide
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
