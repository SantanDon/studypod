import { useEffect, useState } from 'react';
// import { AlertCircle, CheckCircle, Download, ExternalLink } from 'lucide-react'; // Removed Lucide imports
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface OllamaStatusProps {
  showDetails?: boolean;
}

export function OllamaStatus({ showDetails = false }: OllamaStatusProps) {
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkOllama();
    const interval = setInterval(checkOllama, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  async function checkOllama() {
    try {
      const { checkOllamaHealth, getAvailableModels } = await import('@/lib/ai/ollamaService');
      
      const healthy = await checkOllamaHealth();
      setIsHealthy(healthy);
      
      if (healthy) {
        const availableModels = await getAvailableModels();
        setModels(availableModels);
      }
    } catch (error) {
      setIsHealthy(false);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-2 w-2 rounded-full bg-gray-400 animate-pulse" />
        <span>Checking Ollama...</span>
      </div>
    );
  }

  if (!showDetails) {
    // Compact status indicator
    return (
      <div className="flex items-center gap-2 text-sm">
        {isHealthy ? (
          <>
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-green-600 dark:text-green-400">AI Ready</span>
            {models.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {models.length} model{models.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </>
        ) : (
          <>
            <div className="h-2 w-2 rounded-full bg-yellow-500" />
            <span className="text-yellow-600 dark:text-yellow-400">AI Offline</span>
          </>
        )}
      </div>
    );
  }

  // Detailed status card
  if (!isHealthy) {
    return (
      <Alert variant="destructive">
        <i className="fi fi-rr-exclamation h-4 w-4"></i>
        <AlertTitle>Ollama Not Running</AlertTitle>
        <AlertDescription className="mt-2 space-y-3">
          <p>
            Ollama is not running. Install and start Ollama to enable ultra-fast local AI features.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open('https://ollama.ai/download', '_blank')}
              className="w-fit"
            >
              <i className="fi fi-rr-download mr-2 h-4 w-4"></i>
              Download Ollama
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open('/docs/OLLAMA_SETUP.md', '_blank')}
              className="w-fit"
            >
              <i className="fi fi-rr-arrow-up-right-from-square mr-2 h-4 w-4"></i>
              Setup Guide
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const requiredModels = ['phi:2.7b', 'nomic-embed-text:v1.5'];
  const hasRequiredModels = requiredModels.every(model =>
    models.some(m => m.startsWith(model.split(':')[0]))
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <i className="fi fi-rr-check-circle h-5 w-5 text-green-500"></i>
            <CardTitle>Ollama Connected</CardTitle>
          </div>
          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
            Ultra-Fast AI Enabled
          </Badge>
        </div>
        <CardDescription>
          Local AI models are ready for ultra-fast processing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Installed Models */}
        <div>
          <h4 className="text-sm font-medium mb-2">Installed Models ({models.length})</h4>
          {models.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {models.slice(0, 10).map((model) => (
                <Badge key={model} variant="outline" className="text-xs">
                  {model}
                </Badge>
              ))}
              {models.length > 10 && (
                <Badge variant="outline" className="text-xs">
                  +{models.length - 10} more
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No models installed</p>
          )}
        </div>

        {/* Required Models Check */}
        {!hasRequiredModels && (
          <Alert>
            <i className="fi fi-rr-exclamation h-4 w-4"></i>
            <AlertTitle>Missing Recommended Models</AlertTitle>
            <AlertDescription className="mt-2 space-y-2">
              <p className="text-sm">
                Install ultra-fast models for the best experience:
              </p>
              <div className="space-y-1 text-sm font-mono">
                {requiredModels.map(model => {
                  const installed = models.some(m => m.startsWith(model.split(':')[0]));
                  return (
                    <div key={model} className="flex items-center gap-2">
                      {installed ? (
                        <i className="fi fi-rr-check-circle h-3 w-3 text-green-500"></i>
                      ) : (
                        <i className="fi fi-rr-exclamation h-3 w-3 text-yellow-500"></i>
                      )}
                      <code className="text-xs">ollama pull {model}</code>
                    </div>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const commands = requiredModels
                    .filter(model => !models.some(m => m.startsWith(model.split(':')[0])))
                    .map(model => `ollama pull ${model}`)
                    .join('\n');
                  navigator.clipboard.writeText(commands);
                }}
                className="mt-2"
              >
                Copy Commands
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Performance Tips */}
        {hasRequiredModels && (
          <div className="rounded-lg bg-muted p-3 space-y-2">
            <h4 className="text-sm font-medium">⚡ Ultra-Fast Mode Active</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Chat responses: ~0.5-2 seconds</li>
              <li>• Document processing: ~1-3 seconds</li>
              <li>• Title generation: ~0.3-1 second</li>
              <li>• Responses are cached for 5 minutes</li>
            </ul>
          </div>
        )}

        {/* Setup Guide Link */}
        <Button
          variant="link"
          size="sm"
          onClick={() => window.open('/docs/OLLAMA_SETUP.md', '_blank')}
          className="w-fit p-0 h-auto"
        >
          <i className="fi fi-rr-arrow-up-right-from-square mr-2 h-3 w-3"></i>
          View Setup Guide
        </Button>
      </CardContent>
    </Card>
  );
}

