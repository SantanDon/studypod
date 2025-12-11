import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService } from "@/services/localStorageService";
import { extractYoutubeTranscript } from "@/lib/extraction/youtubeExtractor";
import { useDocumentProcessing } from "@/hooks/useDocumentProcessing";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useQueryClient } from "@tanstack/react-query";

export const useYoutubeProcessing = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { processDocumentAsync } = useDocumentProcessing();
  const { generateNotebookContentAsync } = useNotebookGeneration();
  const queryClient = useQueryClient();

  const addYoutubeVideoAsSource = async (
    url: string,
    notebookId: string
  ): Promise<boolean> => {
    try {
      setIsProcessing(true);

      if (!url) {
        throw new Error("No URL provided");
      }

      if (!notebookId) {
        throw new Error("Notebook ID is required");
      }

      toast({
        title: "Processing YouTube Video",
        description: "Fetching transcript...",
      });

      const result = await extractYoutubeTranscript(url);

      // Check if this is the first source in the notebook
      const existingSources = localStorageService.getSources(notebookId);
      const isFirstSource = existingSources.length === 0;

      console.log(`📺 YouTube: isFirstSource=${isFirstSource}, existingSources=${existingSources.length}`);

      const sourceData = {
        notebook_id: notebookId,
        title: result.title,
        summary: result.description,
        type: "youtube" as const,
        content: result.content,
        url: result.url,
        processing_status: "processing",
        metadata: {
          sourceType: "youtube-transcript",
          wordCount: result.content.split(/\s+/).length,
          charCount: result.content.length,
          duration: result.metadata.duration,
          originalUrl: result.url,
        }
      };

      // Save the source to local storage
      const savedSource = localStorageService.createSource(sourceData);
      
      // Invalidate sources query to refresh UI
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      
      // Process the document
      try {
        await processDocumentAsync({
          sourceId: savedSource.id,
          filePath: result.url,
          sourceType: "youtube"
        });
        
        localStorageService.updateSource(savedSource.id, {
          processing_status: "completed"
        });

        // Invalidate again after processing complete
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

        // IMPORTANT: Trigger notebook generation for first source
        if (isFirstSource) {
          console.log("🚀 Triggering notebook generation for YouTube source...");
          try {
            // Mark notebook as generating
            localStorageService.updateNotebook(notebookId, {
              generation_status: "processing",
            });
            queryClient.invalidateQueries({ queryKey: ["notebooks"] });

            await generateNotebookContentAsync({
              notebookId,
              filePath: result.url,
              sourceType: "youtube",
            });

            console.log("✅ Notebook generation completed for YouTube source");
          } catch (genError) {
            console.error("Failed to generate notebook content:", genError);
            // Still mark as completed
            localStorageService.updateNotebook(notebookId, {
              generation_status: "completed",
            });
          }
          queryClient.invalidateQueries({ queryKey: ["notebooks"] });
        }
        
        toast({
          title: "Video Added",
          description: "YouTube transcript added successfully.",
        });
        
        return true;
      } catch (processingError) {
        console.error("Error processing YouTube content:", processingError);
        
        localStorageService.updateSource(savedSource.id, {
          processing_status: "failed"
        });
        throw processingError;
      }
    } catch (error) {
      console.error("Error adding YouTube video:", error);
      toast({
        title: "Failed to Add Video",
        description: error instanceof Error ? error.message : "Failed to add video. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    addYoutubeVideoAsSource,
    isProcessing,
  };
};
