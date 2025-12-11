import React, { useState, useMemo } from "react";
// import { X, Loader2, GitCompare, Sparkles, AlertTriangle, CheckCircle } from "lucide-react"; // Removed Lucide imports
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { LocalSource } from "@/services/localStorageService";
import { chatCompletion, checkOllamaHealth } from "@/lib/ai/ollamaService";
import { parseJsonResponse } from "@/utils/jsonParser";

type Source = LocalSource;

interface SourceComparisonViewProps {
  sources: Source[];
  notebookId: string;
  onClose: () => void;
}

interface ComparisonResult {
  commonThemes: string[];
  uniquePointsSource1: string[];
  uniquePointsSource2: string[];
  contradictions: string[];
  sharedKeywords: string[];
}

const SourceComparisonView: React.FC<SourceComparisonViewProps> = ({
  sources,
  notebookId,
  onClose,
}) => {
  const [selectedSource1, setSelectedSource1] = useState<string>("");
  const [selectedSource2, setSelectedSource2] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source1 = useMemo(
    () => sources.find((s) => s.id === selectedSource1),
    [sources, selectedSource1]
  );

  const source2 = useMemo(
    () => sources.find((s) => s.id === selectedSource2),
    [sources, selectedSource2]
  );

  const extractKeywords = (text: string): string[] => {
    if (!text) return [];
    const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const wordFreq = new Map<string, number>();
    
    const stopWords = new Set([
      "that", "this", "with", "from", "have", "been", "were", "they",
      "their", "which", "would", "could", "should", "about", "after",
      "before", "being", "between", "both", "each", "other", "some",
      "than", "them", "then", "there", "these", "through", "under",
      "very", "what", "when", "where", "while", "will", "your",
    ]);

    words.forEach((word) => {
      if (!stopWords.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    });

    return Array.from(wordFreq.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);
  };

  const sharedKeywords = useMemo(() => {
    if (!source1?.content || !source2?.content) return [];
    const keywords1 = new Set(extractKeywords(source1.content));
    const keywords2 = extractKeywords(source2.content);
    return keywords2.filter((k) => keywords1.has(k));
  }, [source1, source2]);

  const highlightKeywords = (text: string, keywords: string[]): React.ReactNode => {
    if (!text || keywords.length === 0) return text;
    
    const pattern = new RegExp(`\\b(${keywords.join("|")})\\b`, "gi");
    const parts = text.split(pattern);
    
    return parts.map((part, index) => {
      if (keywords.some((k) => k.toLowerCase() === part.toLowerCase())) {
        return (
          <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
            {part}
          </mark>
        );
      }
      return part;
    });
  };

  const handleCompare = async () => {
    if (!source1 || !source2) return;

    setIsAnalyzing(true);
    setError(null);
    setComparisonResult(null);

    try {
      const isHealthy = await checkOllamaHealth();
      if (!isHealthy) {
        throw new Error("Ollama is not available. Please ensure Ollama is running.");
      }

      const prompt = `Analyze and compare these two sources. Provide a structured comparison.

SOURCE 1 - "${source1.title}":
${source1.content?.slice(0, 3000) || source1.summary || "No content available"}

SOURCE 2 - "${source2.title}":
${source2.content?.slice(0, 3000) || source2.summary || "No content available"}

Provide your analysis in the following JSON format only, no other text:
{
  "commonThemes": ["theme1", "theme2"],
  "uniquePointsSource1": ["point1", "point2"],
  "uniquePointsSource2": ["point1", "point2"],
  "contradictions": ["contradiction1 if any"],
  "sharedKeywords": ["keyword1", "keyword2"]
}

Rules:
- commonThemes: Topics or ideas that appear in both sources
- uniquePointsSource1: Important points only in source 1
- uniquePointsSource2: Important points only in source 2
- contradictions: Any conflicting information between sources (can be empty)
- sharedKeywords: Key terms that appear in both sources

Respond with ONLY the JSON, no markdown formatting.`;

      const response = await chatCompletion({
        messages: [
          {
            role: "system",
            content: "You are an expert analyst. Compare sources objectively and return only valid JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      });

      const result = parseJsonResponse<ComparisonResult>(response, (obj): obj is ComparisonResult => {
        if (typeof obj !== 'object' || obj === null) return false;
        const r = obj as Record<string, unknown>;
        return Array.isArray(r.commonThemes) && 
               Array.isArray(r.uniquePointsSource1) && 
               Array.isArray(r.uniquePointsSource2);
      });
      
      if (!result) {
        throw new Error("Failed to parse comparison result");
      }
      
      setComparisonResult(result);
    } catch (err) {
      console.error("Comparison error:", err);
      setError(err instanceof Error ? err.message : "Failed to analyze sources");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const canCompare = selectedSource1 && selectedSource2 && selectedSource1 !== selectedSource2;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <i className="fi fi-rr-git-compare h-5 w-5 text-primary"></i>
          <h2 className="text-lg font-semibold">Compare Sources</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <i className="fi fi-rr-cross h-4 w-4"></i>
        </Button>
      </div>

      <div className="flex items-center gap-4 p-4 border-b bg-muted/30">
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">Source 1</label>
          <Select value={selectedSource1} onValueChange={setSelectedSource1}>
            <SelectTrigger>
              <SelectValue placeholder="Select first source" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem
                  key={source.id}
                  value={source.id}
                  disabled={source.id === selectedSource2}
                >
                  {source.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">Source 2</label>
          <Select value={selectedSource2} onValueChange={setSelectedSource2}>
            <SelectTrigger>
              <SelectValue placeholder="Select second source" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem
                  key={source.id}
                  value={source.id}
                  disabled={source.id === selectedSource1}
                >
                  {source.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="pt-5">
          <Button
            onClick={handleCompare}
            disabled={!canCompare || isAnalyzing}
            className="gap-2"
          >
            {isAnalyzing ? (
              <>
                <i className="fi fi-rr-spinner h-4 w-4 animate-spin"></i>
                Analyzing...
              </>
            ) : (
              <>
                <i className="fi fi-rr-sparkles h-4 w-4"></i>
                Compare
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={50} minSize={25}>
            <div className="h-full flex flex-col">
              <div className="p-3 border-b bg-muted/20">
                <h3 className="font-medium text-sm truncate">
                  {source1?.title || "Select Source 1"}
                </h3>
                {source1?.type && (
                  <span className="text-xs text-muted-foreground capitalize">
                    {source1.type}
                  </span>
                )}
              </div>
              <ScrollArea className="flex-1 p-4">
                {source1 ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {source1.summary && (
                      <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                        <p className="text-sm font-medium mb-1">Summary</p>
                        <p className="text-sm text-muted-foreground">
                          {highlightKeywords(source1.summary, sharedKeywords)}
                        </p>
                      </div>
                    )}
                    <div className="text-sm whitespace-pre-wrap">
                      {highlightKeywords(
                        source1.content || "No content available",
                        sharedKeywords
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    Select a source to view
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={25}>
            <div className="h-full flex flex-col">
              <div className="p-3 border-b bg-muted/20">
                <h3 className="font-medium text-sm truncate">
                  {source2?.title || "Select Source 2"}
                </h3>
                {source2?.type && (
                  <span className="text-xs text-muted-foreground capitalize">
                    {source2.type}
                  </span>
                )}
              </div>
              <ScrollArea className="flex-1 p-4">
                {source2 ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {source2.summary && (
                      <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                        <p className="text-sm font-medium mb-1">Summary</p>
                        <p className="text-sm text-muted-foreground">
                          {highlightKeywords(source2.summary, sharedKeywords)}
                        </p>
                      </div>
                    )}
                    <div className="text-sm whitespace-pre-wrap">
                      {highlightKeywords(
                        source2.content || "No content available",
                        sharedKeywords
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    Select a source to view
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {error && (
        <div className="p-4 border-t bg-destructive/10">
          <div className="flex items-center gap-2 text-destructive">
            <i className="fi fi-rr-triangle-warning h-4 w-4"></i>
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {comparisonResult && (
        <div className="border-t max-h-[40%] overflow-auto">
          <div className="p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <i className="fi fi-rr-sparkles h-4 w-4 text-primary"></i>
              Comparison Analysis
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fi fi-rr-check-circle h-4 w-4 text-green-500"></i>
                    Common Themes
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-2 px-4">
                  {comparisonResult.commonThemes.length > 0 ? (
                    <ul className="text-sm space-y-1">
                      {comparisonResult.commonThemes.map((theme, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-primary">•</span>
                          {theme}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No common themes found</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <i className="fi fi-rr-triangle-warning h-4 w-4 text-orange-500"></i>
                    Contradictions
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-2 px-4">
                  {comparisonResult.contradictions.length > 0 ? (
                    <ul className="text-sm space-y-1">
                      {comparisonResult.contradictions.map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-orange-500">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No contradictions found</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">
                    Unique to: {source1?.title?.slice(0, 30)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-2 px-4">
                  {comparisonResult.uniquePointsSource1.length > 0 ? (
                    <ul className="text-sm space-y-1">
                      {comparisonResult.uniquePointsSource1.map((point, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-blue-500">•</span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No unique points</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">
                    Unique to: {source2?.title?.slice(0, 30)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-2 px-4">
                  {comparisonResult.uniquePointsSource2.length > 0 ? (
                    <ul className="text-sm space-y-1">
                      {comparisonResult.uniquePointsSource2.map((point, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-purple-500">•</span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No unique points</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {sharedKeywords.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">Shared Keywords</p>
                <div className="flex flex-wrap gap-2">
                  {sharedKeywords.slice(0, 15).map((keyword, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-full"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SourceComparisonView;
