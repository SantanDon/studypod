import React from "react";
import {
  Download,
  Trash2,
  Check,
  Loader2,
  Star,
  Cpu,
  MessageSquare,
  Code,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { RecommendedModel, ModelInfo } from "@/hooks/useOllamaModels";

interface ModelCardProps {
  model: RecommendedModel;
  installedInfo?: ModelInfo;
  isInstalled: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  isDefault: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  formatBytes: (bytes: number) => string;
}

const categoryIcons: Record<string, React.ReactNode> = {
  chat: <MessageSquare className="h-4 w-4" />,
  embedding: <Search className="h-4 w-4" />,
  code: <Code className="h-4 w-4" />,
  vision: <Cpu className="h-4 w-4" />,
};

const categoryColors: Record<string, string> = {
  chat: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  embedding: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100",
  code: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  vision: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
};

export function ModelCard({
  model,
  installedInfo,
  isInstalled,
  isDownloading,
  downloadProgress,
  isDefault,
  onDownload,
  onDelete,
  onSetDefault,
  formatBytes,
}: ModelCardProps) {
  return (
    <Card
      className={cn(
        "relative transition-all hover:shadow-md",
        isInstalled && "border-green-200 dark:border-green-800",
        isDefault && "ring-2 ring-primary"
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-medium truncate">
              {model.displayName}
            </CardTitle>
            <code className="text-xs text-muted-foreground">{model.name}</code>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant="secondary"
              className={cn("text-xs", categoryColors[model.category])}
            >
              {categoryIcons[model.category]}
              <span className="ml-1 capitalize">{model.category}</span>
            </Badge>
            {model.recommended && (
              <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-100">
                <Star className="h-3 w-3 mr-1 fill-current" />
                Recommended
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {model.description}
        </p>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            {installedInfo ? formatBytes(installedInfo.size) : model.size}
          </span>
          {model.lowEndFriendly && (
            <Badge variant="outline" className="text-xs">
              Low-end friendly
            </Badge>
          )}
        </div>

        {isDownloading && (
          <div className="space-y-1">
            <Progress value={downloadProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              Downloading... {downloadProgress.toFixed(0)}%
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          {isInstalled ? (
            <>
              <Button
                variant={isDefault ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={onSetDefault}
                disabled={isDefault}
              >
                {isDefault ? (
                  <>
                    <Check className="h-3 w-3 mr-1" />
                    Default
                  </>
                ) : (
                  "Set as Default"
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              variant="default"
              size="sm"
              className="w-full"
              onClick={onDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </>
              )}
            </Button>
          )}
        </div>

        {isInstalled && (
          <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <Check className="h-3 w-3" />
            Installed
          </div>
        )}
      </CardContent>
    </Card>
  );
}
