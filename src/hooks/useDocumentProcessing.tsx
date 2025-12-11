import { useMutation } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useToast } from "@/hooks/use-toast";
import { processDocument as processDocumentWithEmbeddings } from "@/lib/extraction/documentProcessor";

export const useDocumentProcessing = () => {
  const { toast } = useToast();

  const processDocument = useMutation({
    mutationFn: async ({
      sourceId,
      filePath,
      sourceType,
    }: {
      sourceId: string;
      filePath: string;
      sourceType: string;
    }) => {
      console.log("🚀 Ultra-fast document processing for:", {
        sourceId,
        filePath,
        sourceType,
      });

      // Get the source to process by ID
      const source = localStorageService.getSourceById(sourceId);

      if (!source) {
        console.error("Source not found:", sourceId);
        throw new Error(`Source not found: ${sourceId}`);
      }

      // Update status to processing
      localStorageService.updateSource(sourceId, {
        processing_status: "processing",
      });

      try {
        // Check if source has content
        if (!source.content || source.content.trim().length === 0) {
          console.warn("⚠️ Source has no content, skipping processing");
          localStorageService.updateSource(sourceId, {
            processing_status: "completed",
          });
          return { success: true, sourceId, filePath, sourceType };
        }

        // Check if the content contains extraction error messages
        const hasExtractionError = source.content.includes("extraction failed") || 
                                 source.content.includes("Unable to extract text") ||
                                 source.content.includes("PDF contains no extractable text") ||
                                 source.content.includes("extraction/OCR failed") ||
                                 source.content.includes("encrypted or password-protected") ||
                                 source.content.includes("corrupted or in an unsupported format");

        if (hasExtractionError) {
          console.warn("⚠️ Source contains extraction error, skipping document processing");
          // Don't process error content - just mark as completed
          localStorageService.updateSource(sourceId, {
            processing_status: "completed",
          });
          return { success: true, sourceId, filePath, sourceType };
        }

        // Use optimized document processor with parallel chunking and embeddings
        const { checkOllamaHealth } = await import("@/lib/ai/ollamaService");
        const isHealthy = await checkOllamaHealth();

        if (isHealthy) {
          console.log("⚡ Processing with optimized document processor...");

          // Process document with parallel chunking and embedding generation
          const result = await processDocumentWithEmbeddings(
            sourceId,
            source.content,
            {
              generateEmbeddings: true,
              chunkSize: 1000,
              generateSummary: false, // Keep it fast
            },
          );

          console.log("✅ Document processed:", {
            chunks: result.chunks.length,
            embeddings: result.chunks.filter((c) => c.embedding).length,
          });

          // Update source with processed data including chunks
          localStorageService.updateSource(sourceId, {
            processing_status: "completed",
            content: source.content,
            metadata: {
              ...(source.metadata || {}),
              chunks: result.chunks,
              documentEmbedding: result.embeddings,
              processedAt: new Date().toISOString(),
            },
          });

          return {
            success: true,
            sourceId,
            filePath,
            sourceType,
            chunks: result.chunks.length,
            embeddings: result.chunks.filter((c) => c.embedding).length,
          };
        } else {
          console.log(
            "⚠️ Ollama not available, marking as completed without embeddings",
          );

          // Fallback: just mark as completed
          localStorageService.updateSource(sourceId, {
            processing_status: "completed",
          });

          return { success: true, sourceId, filePath, sourceType };
        }
      } catch (error) {
        console.error("Document processing error:", error);

        // Mark as completed even on error (graceful degradation)
        localStorageService.updateSource(sourceId, {
          processing_status: "completed",
        });

        return { success: true, sourceId, filePath, sourceType };
      }
    },
    onSuccess: (data) => {
      console.log("Document processing completed successfully:", data);

      // Invalidate queries to refresh the UI
      // This would be implemented to refresh source data
    },
    onError: (error) => {
      console.error("Failed to initiate document processing:", error);
      toast({
        title: "Processing Error",
        description: "Failed to start document processing. Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    processDocumentAsync: processDocument.mutateAsync,
    processDocument: processDocument.mutate,
    isProcessing: processDocument.isPending,
  };
};
