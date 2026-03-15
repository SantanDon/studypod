import { useState, useMemo } from 'react';
import { LocalSource } from '@/services/localStorageService';
import { chatCompletion } from '@/lib/ai/ollamaService';
import { parseJsonResponse } from '@/utils/jsonParser';

export interface ComparisonResult {
  commonThemes: string[];
  uniquePointsSource1: string[];
  uniquePointsSource2: string[];
  contradictions: string[];
  sharedKeywords: string[];
}

export function extractKeywords(text: string): string[] {
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
}

export function useSourceComparison(sources: LocalSource[]) {
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

  const sharedKeywords = useMemo(() => {
    if (!source1?.content || !source2?.content) return [];
    const keywords1 = new Set(extractKeywords(source1.content));
    const keywords2 = extractKeywords(source2.content);
    return keywords2.filter((k) => keywords1.has(k));
  }, [source1, source2]);

  const handleCompare = async () => {
    if (!source1 || !source2) return;

    setIsAnalyzing(true);
    setError(null);
    setComparisonResult(null);

    try {
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

  return {
    selectedSource1, setSelectedSource1,
    selectedSource2, setSelectedSource2,
    isAnalyzing,
    comparisonResult,
    error,
    source1,
    source2,
    sharedKeywords,
    handleCompare,
    canCompare
  };
}
