import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService, LocalSource } from "@/services/localStorageService";
import { extractVideoId, extractYoutubeTranscript } from "@/lib/extraction/youtubeExtractor";
import { useDocumentProcessing } from "@/hooks/useDocumentProcessing";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";
import { isSourceUsableForGroundedWork } from "@/lib/sources/sourceProcessing";

function parseSourceMetadata(source: LocalSource): Record<string, unknown> {
  const rawMetadata = source.metadata as unknown;
  if (!rawMetadata) return {};
  if (typeof rawMetadata === "string") {
    try {
      return JSON.parse(rawMetadata);
    } catch {
      return {};
    }
  }
  return rawMetadata as Record<string, unknown>;
}

export const useYoutubeProcessing = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { processDocumentAsync } = useDocumentProcessing();
  const { generateNotebookContentAsync } = useNotebookGeneration();
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const addYoutubeVideoAsSource = async (
    url: string,
    notebookId: string,
    language = 'en',
  ): Promise<boolean> => {
    try {
      setIsProcessing(true);

      if (!url) {
        throw new Error("No URL provided");
      }

      if (!notebookId) {
        throw new Error("Notebook ID is required");
      }

      const videoId = extractVideoId(url);
      if (!videoId) throw new Error("Enter a valid YouTube video URL.");

      // Fetch only this notebook so recovery retains its existing ownership.
      let existingSources: LocalSource[] = [];
      if (session?.access_token) {
        existingSources = await ApiService.fetchSources(notebookId, session.access_token);
      } else {
        existingSources = (await localStorageService.getSources(notebookId)) as LocalSource[];
      }
      const isFirstUsableSource = !existingSources.some(isSourceUsableForGroundedWork);

      const duplicateSource = videoId
        ? existingSources.find((source) => {
            const metadata = parseSourceMetadata(source);
            return source.type === "youtube" && (metadata.videoId === videoId || (source.url && extractVideoId(source.url) === videoId));
          })
        : null;

      if (duplicateSource && isSourceUsableForGroundedWork(duplicateSource)) {
        toast({
          title: "Video already added",
          description: `"${duplicateSource.title}" is already in this notebook.`,
        });
        return false;
      }

      toast({
        title: duplicateSource ? "Retrying YouTube transcript" : "Processing YouTube Video",
        description: "Fetching transcript and metadata...",
      });

      const result = await extractYoutubeTranscript(url, session?.access_token, language);

      const isMetadataOnly = result.metadata.transcriptStatus === "metadata_only";
      if (duplicateSource && isMetadataOnly) {
        toast({
          title: "Transcript still unavailable",
          description: "Your existing source was kept. Try another caption language, or paste/upload the transcript as a text source.",
        });
        return false;
      }

      const sourcePayload = {
        title: result.title,
        summary: result.description,
        type: "youtube",
        content: result.content,
        url: result.url,
        processing_status: isMetadataOnly ? "degraded" as const : "processing" as const,
        metadata: {
          sourceType: "youtube-transcript",
          wordCount: result.content.split(/\s+/).length,
          charCount: result.content.length,
          duration: result.metadata.duration,
          originalUrl: result.url,
          videoId: result.metadata.videoId,
          author: result.metadata.author,
          keywords: result.metadata.keywords || [],
          extractedBy: result.metadata.extractedBy,
          transcriptStatus: result.metadata.transcriptStatus,
          transcriptLineCount: result.metadata.transcriptLineCount,
          extractionWarning: result.metadata.extractionWarning,
          transcriptProvider: result.metadata.transcriptProvider,
          transcriptMode: result.metadata.transcriptMode,
          transcriptLanguage: result.metadata.transcriptLanguage,
          availableTranscriptLanguages: result.metadata.availableTranscriptLanguages || [],
          selectedTrackKind: result.metadata.selectedTrackKind,
          transcriptQuality: result.metadata.transcriptQuality,
          timingQuality: result.metadata.timingQuality,
          videoAvailability: result.metadata.videoAvailability,
          availabilityReason: result.metadata.availabilityReason,
          participants: result.metadata.participants || [],
          chapters: result.metadata.chapters || [],
          timestampedTranscript: result.metadata.timestampedTranscript,
          transcriptSegments: result.metadata.transcriptSegments || [],
          supadataBillableRequests: result.metadata.supadataBillableRequests || 0,
          channelId: result.metadata.channelId,
          thumbnail: result.metadata.thumbnail,
          publishedAt: result.metadata.publishedAt,
          canonicalUrl: result.metadata.canonicalUrl,
          providerCapabilities: result.metadata.providerCapabilities,
          sovereign_signal: result.metadata.sovereign_signal,
        }
      };

      // Save the source to API or local storage
      let savedSource: LocalSource;
      if (session?.access_token) {
        savedSource = duplicateSource
          ? await ApiService.updateSource(notebookId, duplicateSource.id, sourcePayload, session.access_token)
          : await ApiService.createSource(notebookId, sourcePayload, session.access_token);
      } else {
        const localSource = duplicateSource
          ? localStorageService.updateSource(duplicateSource.id, { ...sourcePayload, type: "youtube" })
          : localStorageService.createSource({
          notebook_id: notebookId,
          ...sourcePayload,
          type: "youtube" as const
        });
        if (!localSource) throw new Error("This source no longer exists. Add the video again.");
        savedSource = localSource;
      }
      
      // Invalidate sources query to refresh UI
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

      if (isMetadataOnly) {
        toast({
          title: "Video saved without a transcript",
          description: "Chat and Studio need the transcript. Re-add this URL to retry, choose another caption language, or paste/upload the transcript as text.",
        });
        return true;
      }

      // Cache the content in localStorage for the document processor
      localStorage.setItem(`file_${result.url}`, JSON.stringify({
        content: result.content,
        metadata: sourcePayload.metadata
      }));

      // Process the document
      try {
        await processDocumentAsync({
          sourceId: savedSource.id,
          filePath: result.url,
          sourceType: "youtube",
          notebookId
        });
        
        if (session?.access_token) {
          await ApiService.updateSource(notebookId, savedSource.id, { processing_status: "completed" }, session.access_token);
        } else {
          localStorageService.updateSource(savedSource.id, { processing_status: "completed" });
        }

        // Invalidate again after processing complete
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

        // IMPORTANT: Trigger notebook generation for first source
        if (isFirstUsableSource) {
          console.log("🚀 Triggering notebook generation for YouTube source...");
          try {
            // Mark notebook as generating
            if (!session?.access_token) {
              localStorageService.updateNotebook(notebookId, {
                generation_status: "processing",
              });
            }
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
            if (!session?.access_token) {
              localStorageService.updateNotebook(notebookId, {
                generation_status: "completed",
              });
            }
          }
          queryClient.invalidateQueries({ queryKey: ["notebooks"] });
        }
        
        toast({
          title: duplicateSource ? "Transcript recovered" : "Video Added",
          description: `Transcript added successfully (${result.metadata.transcriptLineCount || 0} caption lines).`,
        });
        
        return true;
      } catch (processingError) {
        console.error("Error processing YouTube content:", processingError);
        
        if (session?.access_token) {
          await ApiService.updateSource(notebookId, savedSource.id, { processing_status: "failed" }, session.access_token);
        } else {
          localStorageService.updateSource(savedSource.id, { processing_status: "failed" });
        }
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
