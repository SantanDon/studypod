import React, { useState } from "react";
import {
  RefreshCw,
  AlertCircle,
  Trash2,
  HardDrive,
  MessageSquare,
  Search,
  Code,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ModelCard } from "./ModelCard";
import { useOllamaModels, type ModelInfo } from "@/hooks/useOllamaModels";

export function ModelManager() {
  const {
    isHealthy,
    healthLoading,
    installedModels,
    modelsLoading,
    modelDetails,
    recommendedModels,
    defaultModels,
    downloadProgress,
    downloadingModels,
    pullModel,
    deleteModel,
    isModelInstalled,
    setDefaultModel,
    formatBytes,
    refetchModels,
    refetchDetails,
  } = useOllamaModels();

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("recommended");

  const handleRefresh = () => {
    refetchModels();
    refetchDetails();
  };

  const handleDelete = (modelName: string) => {
    setDeleteConfirm(modelName);
  };

  const confirmDelete = () => {
    if (deleteConfirm) {
      deleteModel(deleteConfirm);
      setDeleteConfirm(null);
    }
  };

  const getDefaultTask = (category: string): "chat" | "embedding" | "code" | null => {
    if (category === "chat") return "chat";
    if (category === "embedding") return "embedding";
    if (category === "code") return "code";
    return null;
  };

  const totalSize = modelDetails.reduce((acc, m) => acc + (m.size || 0), 0);

  if (!isHealthy && !healthLoading) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Ollama Not Running</AlertTitle>
        <AlertDescription>
          Please start Ollama to manage models. Visit{" "}
          <a
            href="https://ollama.ai/download"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            ollama.ai
          </a>{" "}
          to download and install.
        </AlertDescription>
      </Alert>
    );
  }

  const chatModels = recommendedModels.filter((m) => m.category === "chat");
  const embeddingModels = recommendedModels.filter((m) => m.category === "embedding");
  const codeModels = recommendedModels.filter((m) => m.category === "code");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Model Manager</h2>
          <p className="text-sm text-muted-foreground">
            Download and manage local AI models
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={modelsLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${modelsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Storage Usage</CardTitle>
            </div>
            <Badge variant="secondary">
              {installedModels.length} model{installedModels.length !== 1 ? "s" : ""} installed
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Total size:</span>
            <span className="font-medium">{formatBytes(totalSize)}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded bg-blue-500" />
              <span>Chat: {defaultModels.chat}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded bg-purple-500" />
              <span>Embedding: {defaultModels.embedding}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded bg-green-500" />
              <span>Code: {defaultModels.code}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="recommended">Recommended</TabsTrigger>
          <TabsTrigger value="chat" className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="embedding" className="flex items-center gap-1">
            <Search className="h-3 w-3" />
            Embedding
          </TabsTrigger>
          <TabsTrigger value="installed" className="flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            Installed
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommended" className="mt-4">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Start with these efficient models optimized for low-end hardware.
            </p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recommendedModels
                .filter((m) => m.recommended)
                .map((model) => {
                  const installedInfo = modelDetails.find(
                    (d) =>
                      d.name === model.name ||
                      d.name.startsWith(model.name.split(":")[0] + ":")
                  );
                  const task = getDefaultTask(model.category);
                  const isDefault = task ? defaultModels[task] === model.name : false;

                  return (
                    <ModelCard
                      key={model.name}
                      model={model}
                      installedInfo={installedInfo}
                      isInstalled={isModelInstalled(model.name)}
                      isDownloading={downloadingModels.has(model.name)}
                      downloadProgress={downloadProgress[model.name] || 0}
                      isDefault={isDefault}
                      onDownload={() => pullModel(model.name)}
                      onDelete={() => handleDelete(model.name)}
                      onSetDefault={() => task && setDefaultModel(task, model.name)}
                      formatBytes={formatBytes}
                    />
                  );
                })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {chatModels.map((model) => {
              const installedInfo = modelDetails.find(
                (d) =>
                  d.name === model.name ||
                  d.name.startsWith(model.name.split(":")[0] + ":")
              );

              return (
                <ModelCard
                  key={model.name}
                  model={model}
                  installedInfo={installedInfo}
                  isInstalled={isModelInstalled(model.name)}
                  isDownloading={downloadingModels.has(model.name)}
                  downloadProgress={downloadProgress[model.name] || 0}
                  isDefault={defaultModels.chat === model.name}
                  onDownload={() => pullModel(model.name)}
                  onDelete={() => handleDelete(model.name)}
                  onSetDefault={() => setDefaultModel("chat", model.name)}
                  formatBytes={formatBytes}
                />
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="embedding" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {embeddingModels.map((model) => {
              const installedInfo = modelDetails.find(
                (d) =>
                  d.name === model.name ||
                  d.name.startsWith(model.name.split(":")[0] + ":")
              );

              return (
                <ModelCard
                  key={model.name}
                  model={model}
                  installedInfo={installedInfo}
                  isInstalled={isModelInstalled(model.name)}
                  isDownloading={downloadingModels.has(model.name)}
                  downloadProgress={downloadProgress[model.name] || 0}
                  isDefault={defaultModels.embedding === model.name}
                  onDownload={() => pullModel(model.name)}
                  onDelete={() => handleDelete(model.name)}
                  onSetDefault={() => setDefaultModel("embedding", model.name)}
                  formatBytes={formatBytes}
                />
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="installed" className="mt-4">
          {modelDetails.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <HardDrive className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No models installed yet.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Go to the Recommended tab to download models.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {modelDetails.map((model: ModelInfo) => (
                <Card key={model.name}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium truncate">{model.name}</h3>
                          {model.details?.parameter_size && (
                            <Badge variant="outline" className="text-xs">
                              {model.details.parameter_size}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          <span>{formatBytes(model.size)}</span>
                          {model.details?.quantization_level && (
                            <span>Q: {model.details.quantization_level}</span>
                          )}
                          {model.details?.family && (
                            <span>Family: {model.details.family}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(model.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteConfirm}</strong>? This will
              free up disk space but you'll need to download it again to use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
