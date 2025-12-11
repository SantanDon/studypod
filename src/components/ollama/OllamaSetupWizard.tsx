import React, { useState, useEffect } from "react";
import {
  CheckCircle,
  Circle,
  Download,
  ExternalLink,
  Loader2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Zap,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useOllamaModels, RECOMMENDED_MODELS } from "@/hooks/useOllamaModels";
import { chatCompletion } from "@/lib/ai/ollamaService";

type WizardStep = "check" | "download" | "test" | "complete";

interface StepStatus {
  check: "pending" | "loading" | "success" | "error";
  download: "pending" | "loading" | "success" | "error";
  test: "pending" | "loading" | "success" | "error";
}

export function OllamaSetupWizard({ onComplete }: { onComplete?: () => void }) {
  const {
    isHealthy,
    healthLoading,
    installedModels,
    downloadProgress,
    downloadingModels,
    pullModel,
    isModelInstalled,
    refetchHealth,
    refetchModels,
  } = useOllamaModels();

  const [currentStep, setCurrentStep] = useState<WizardStep>("check");
  const [stepStatus, setStepStatus] = useState<StepStatus>({
    check: "pending",
    download: "pending",
    test: "pending",
  });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const essentialModels = RECOMMENDED_MODELS.filter(
    (m) => m.recommended && (m.category === "chat" || m.category === "embedding")
  ).slice(0, 2);

  useEffect(() => {
    if (currentStep === "check") {
      checkOllamaInstallation();
    }
  }, [currentStep]);

  const checkOllamaInstallation = async () => {
    setStepStatus((prev) => ({ ...prev, check: "loading" }));
    await refetchHealth();

    setTimeout(() => {
      if (isHealthy) {
        setStepStatus((prev) => ({ ...prev, check: "success" }));
      } else {
        setStepStatus((prev) => ({ ...prev, check: "error" }));
      }
    }, 500);
  };

  const downloadEssentialModels = async () => {
    setStepStatus((prev) => ({ ...prev, download: "loading" }));

    const modelsToDownload = essentialModels.filter(
      (m) => !isModelInstalled(m.name)
    );

    if (modelsToDownload.length === 0) {
      setStepStatus((prev) => ({ ...prev, download: "success" }));
      return;
    }

    for (const model of modelsToDownload) {
      pullModel(model.name);
    }
  };

  useEffect(() => {
    if (currentStep === "download" && stepStatus.download === "loading") {
      const allDownloaded = essentialModels.every((m) =>
        isModelInstalled(m.name)
      );
      const anyDownloading = essentialModels.some((m) =>
        downloadingModels.has(m.name)
      );

      if (allDownloaded && !anyDownloading) {
        setStepStatus((prev) => ({ ...prev, download: "success" }));
      }
    }
  }, [installedModels, downloadingModels, currentStep, stepStatus.download]);

  const testModelConnection = async () => {
    setStepStatus((prev) => ({ ...prev, test: "loading" }));
    setTestResult(null);
    setTestError(null);

    try {
      await refetchModels();

      const result = await chatCompletion({
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant. Respond briefly.",
          },
          {
            role: "user",
            content: "Say 'Hello! Ollama is working correctly.' in exactly those words.",
          },
        ],
        temperature: 0.1,
      });

      setTestResult(result);
      setStepStatus((prev) => ({ ...prev, test: "success" }));
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Connection test failed");
      setStepStatus((prev) => ({ ...prev, test: "error" }));
    }
  };

  const goToNextStep = () => {
    if (currentStep === "check" && stepStatus.check === "success") {
      setCurrentStep("download");
    } else if (currentStep === "download") {
      setCurrentStep("test");
    } else if (currentStep === "test" && stepStatus.test === "success") {
      setCurrentStep("complete");
      onComplete?.();
    }
  };

  const goToPrevStep = () => {
    if (currentStep === "download") setCurrentStep("check");
    else if (currentStep === "test") setCurrentStep("download");
    else if (currentStep === "complete") setCurrentStep("test");
  };

  const steps: { key: WizardStep; label: string }[] = [
    { key: "check", label: "Check Installation" },
    { key: "download", label: "Download Models" },
    { key: "test", label: "Test Connection" },
    { key: "complete", label: "Complete" },
  ];

  const getStepIndex = (step: WizardStep) => steps.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-2">
        {steps.map((step, index) => (
          <React.Fragment key={step.key}>
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors",
                getStepIndex(currentStep) > index
                  ? "bg-primary border-primary text-primary-foreground"
                  : getStepIndex(currentStep) === index
                    ? "border-primary text-primary"
                    : "border-muted text-muted-foreground"
              )}
            >
              {getStepIndex(currentStep) > index ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <span className="text-sm font-medium">{index + 1}</span>
              )}
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "w-12 h-0.5",
                  getStepIndex(currentStep) > index ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {currentStep === "check" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Step 1: Check Ollama Installation
            </CardTitle>
            <CardDescription>
              Make sure Ollama is installed and running on your system.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stepStatus.check === "loading" || healthLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking Ollama status...
              </div>
            ) : stepStatus.check === "success" || isHealthy ? (
              <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800 dark:text-green-200">
                  Ollama is running and ready! {installedModels.length} model(s) available.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Ollama is not running. Please install and start Ollama.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <h4 className="font-medium">Installation Steps:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>
                      Download Ollama from{" "}
                      <a
                        href="https://ollama.ai/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        ollama.ai/download
                      </a>
                    </li>
                    <li>Install and run the application</li>
                    <li>Click "Retry" below to check again</li>
                  </ol>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open("https://ollama.ai/download", "_blank")}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Download Ollama
                  </Button>
                  <Button onClick={checkOllamaInstallation}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {(stepStatus.check === "success" || isHealthy) && (
              <Button onClick={goToNextStep} className="w-full">
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep === "download" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Step 2: Download Recommended Models
            </CardTitle>
            <CardDescription>
              Download efficient models optimized for local processing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {essentialModels.map((model) => {
                const installed = isModelInstalled(model.name);
                const downloading = downloadingModels.has(model.name);
                const progress = downloadProgress[model.name] || 0;

                return (
                  <div key={model.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {installed ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : downloading ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium">{model.displayName}</span>
                        <Badge variant="secondary" className="text-xs">
                          {model.size}
                        </Badge>
                      </div>
                      {!installed && !downloading && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pullModel(model.name)}
                        >
                          Download
                        </Button>
                      )}
                    </div>
                    {downloading && (
                      <div className="ml-6">
                        <Progress value={progress} className="h-2" />
                        <p className="text-xs text-muted-foreground mt-1">
                          {progress.toFixed(0)}% complete
                        </p>
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground ml-6">
                      {model.description}
                    </p>
                  </div>
                );
              })}
            </div>

            {stepStatus.download !== "loading" &&
              essentialModels.every((m) => !isModelInstalled(m.name)) && (
                <Button onClick={downloadEssentialModels} className="w-full">
                  <Download className="h-4 w-4 mr-2" />
                  Download All Recommended Models
                </Button>
              )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={goToPrevStep}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={goToNextStep} className="flex-1">
                {essentialModels.some((m) => isModelInstalled(m.name))
                  ? "Continue"
                  : "Skip for Now"}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "test" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Step 3: Test Model Connection
            </CardTitle>
            <CardDescription>
              Verify that StudyLM can communicate with your local models.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stepStatus.test === "loading" ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Testing model connection...
              </div>
            ) : stepStatus.test === "success" ? (
              <div className="space-y-3">
                <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800 dark:text-green-200">
                    Connection successful! Your local AI is ready.
                  </AlertDescription>
                </Alert>
                {testResult && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Model Response:</p>
                    <p className="text-sm text-muted-foreground">{testResult}</p>
                  </div>
                )}
              </div>
            ) : stepStatus.test === "error" ? (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {testError || "Failed to connect to model. Make sure you have at least one chat model installed."}
                  </AlertDescription>
                </Alert>
                <Button onClick={testModelConnection}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry Test
                </Button>
              </div>
            ) : (
              <Button onClick={testModelConnection} className="w-full">
                <Zap className="h-4 w-4 mr-2" />
                Run Connection Test
              </Button>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={goToPrevStep}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              {stepStatus.test === "success" && (
                <Button onClick={goToNextStep} className="flex-1">
                  Complete Setup
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "complete" && (
        <Card className="border-green-200 dark:border-green-800">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>Setup Complete!</CardTitle>
            <CardDescription>
              Your local AI environment is configured and ready to use.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <h4 className="font-medium">What's next?</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Chat responses will now use your local models</li>
                <li>• Document processing happens entirely on your machine</li>
                <li>• No data is sent to external servers</li>
              </ul>
            </div>

            <Button onClick={onComplete} className="w-full">
              Start Using StudyLM
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
