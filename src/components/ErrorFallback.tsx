import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
// import { AlertTriangle, RefreshCw, Home } from 'lucide-react'; // Removed Lucide imports
import { useNavigate } from 'react-router-dom';

export interface ErrorFallbackProps {
  error?: Error;
  resetError?: () => void;
  variant?: 'page' | 'component';
  title?: string;
  message?: string;
  showHomeButton?: boolean;
  showDetails?: boolean;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  resetError,
  variant = 'component',
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  showHomeButton = true,
  showDetails = import.meta.env.DEV,
}) => {
  const navigate = useNavigate();

  const handleGoHome = () => {
    navigate('/');
  };

  if (variant === 'page') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <i className="fi fi-rr-exclamation h-6 w-6 text-red-600"></i>
            </div>
            <CardTitle className="text-xl text-gray-900">{title}</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-gray-600 mb-4">{message}</p>
            {showDetails && error && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  Error Details
                </summary>
                <div className="mt-2 rounded-md bg-gray-100 p-3">
                  <p className="text-xs font-mono text-red-600 break-all">
                    {error.message}
                  </p>
                  {error.stack && (
                    <pre className="mt-2 text-xs text-gray-600 overflow-auto max-h-32 whitespace-pre-wrap">
                      {error.stack}
                    </pre>
                  )}
                </div>
              </details>
            )}
          </CardContent>
          <CardFooter className="flex justify-center gap-3">
            {resetError && (
              <Button onClick={resetError} variant="default">
                <i className="fi fi-rr-refresh h-4 w-4 mr-2"></i>
                Try Again
              </Button>
            )}
            {showHomeButton && (
              <Button onClick={handleGoHome} variant="outline">
                <i className="fi fi-rr-home h-4 w-4 mr-2"></i>
                Go to Dashboard
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-lg border border-gray-200 min-h-[200px]">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 mb-3">
        <i className="fi fi-rr-exclamation h-5 w-5 text-red-600"></i>
      </div>
      <h3 className="text-sm font-medium text-gray-900 mb-1">{title}</h3>
      <p className="text-xs text-gray-600 text-center mb-4 max-w-xs">{message}</p>
      {showDetails && error && (
        <details className="w-full max-w-xs mb-4">
          <summary className="cursor-pointer text-xs font-medium text-gray-700 hover:text-gray-900">
            Error Details
          </summary>
          <div className="mt-2 rounded-md bg-gray-100 p-2">
            <p className="text-xs font-mono text-red-600 break-all">
              {error.message}
            </p>
          </div>
        </details>
      )}
      <div className="flex gap-2">
        {resetError && (
          <Button onClick={resetError} size="sm" variant="default">
            <i className="fi fi-rr-refresh h-3 w-3 mr-1"></i>
            Retry
          </Button>
        )}
        {showHomeButton && (
          <Button onClick={handleGoHome} size="sm" variant="outline">
            <i className="fi fi-rr-home h-3 w-3 mr-1"></i>
            Dashboard
          </Button>
        )}
      </div>
    </div>
  );
};

export default ErrorFallback;
