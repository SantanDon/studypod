import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
// import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react'; // Removed Lucide imports
import { ollamaHealthMonitor, OllamaHealthStatus } from '@/lib/ai/ollamaHealthCheck';

export const OllamaHealthIndicator: React.FC = () => {
  const [status, setStatus] = useState<OllamaHealthStatus | null>(null);

  useEffect(() => {
    // Start monitoring
    ollamaHealthMonitor.start();

    // Subscribe to status changes
    const unsubscribe = ollamaHealthMonitor.addListener(setStatus);

    // Cleanup
    return () => {
      unsubscribe();
      ollamaHealthMonitor.stop();
    };
  }, []);

  if (!status) {
    return (
      <Badge variant="outline" className="gap-1">
        <i className="fi fi-rr-exclamation h-3 w-3"></i>
        <span className="text-xs">Checking...</span>
      </Badge>
    );
  }

  if (status.isAvailable) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 bg-green-50 text-green-700 border-green-200">
              <i className="fi fi-rr-check-circle h-3 w-3"></i>
              <span className="text-xs">Ollama Connected</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-sm">
              <p className="font-medium">Ollama is running</p>
              <p className="text-xs text-gray-500 mt-1">
                {status.models.length} model(s) available
              </p>
              {status.models.length > 0 && (
                <ul className="text-xs mt-1 space-y-0.5">
                  {status.models.slice(0, 5).map((model) => (
                    <li key={model}>• {model}</li>
                  ))}
                  {status.models.length > 5 && (
                    <li>• +{status.models.length - 5} more...</li>
                  )}
                </ul>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 bg-red-50 text-red-700 border-red-200">
            <i className="fi fi-rr-cross-circle h-3 w-3"></i>
            <span className="text-xs">Ollama Offline</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm max-w-xs">
            <p className="font-medium text-red-600">Ollama is not available</p>
            <p className="text-xs text-gray-600 mt-1">
              {status.error || 'Cannot connect to Ollama service'}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Make sure Ollama is running on http://localhost:11434
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default OllamaHealthIndicator;
