import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { localStorageService } from "@/services/localStorageService";
import { generatePodcastScript, PodcastScript } from "@/lib/podcastGenerator";
import { 
  getPodcastAudioGenerator, 
  GenerationProgress,
  PodcastAudioResult 
} from "@/lib/tts/podcastAudioGenerator";

export interface AudioGenerationResult {
  success: boolean;
  script?: PodcastScript;
  audioUrl?: string;
  provider?: string;
}

export const useAudioOverview = (notebookId?: string) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Periodically check for notebook updates
  useEffect(() => {
    if (!notebookId) return;

    // Set up an interval to check for updates
    const interval = setInterval(() => {
      const notebook = localStorageService.getNotebook(notebookId);
      if (notebook) {
        console.log(
          "Checking notebook audio status:",
          notebook.generation_status,
        );

        if (notebook.generation_status) {
          setGenerationStatus(notebook.generation_status);

          if (
            notebook.generation_status === "completed" &&
            notebook.audio_overview_url
          ) {
            setIsGenerating(false);
            toast({
              title: "Audio Overview Ready!",
              description: "Your deep dive conversation is ready to play!",
            });

            // Invalidate queries to refresh the UI
            queryClient.invalidateQueries({ queryKey: ["notebooks"] });
          } else if (notebook.generation_status === "failed") {
            setIsGenerating(false);
            toast({
              title: "Generation Failed",
              description:
                "Failed to generate audio overview. Please try again.",
              variant: "destructive",
            });
          }
        }
      }
    }, 5000); // Check every 5 seconds

    return () => {
      clearInterval(interval);
    };
  }, [notebookId, toast, queryClient]);

  // Initialize generation status and load persisted audio
  useEffect(() => {
    if (notebookId) {
      const notebook = localStorageService.getNotebook(notebookId);
      if (notebook) {
        setGenerationStatus(notebook.generation_status);

        // If marked as completed, try to load the blob from IndexedDB if we don't have a URL yet
        // or if the URL is a blob URL (which might be stale from a previous session)
        if (notebook.generation_status === 'completed' && !notebook.audio_overview_url?.startsWith('http')) {
           import('../services/blobStorageService').then(({ blobStorageService }) => {
             blobStorageService.getPodcastAudio(notebookId).then(blob => {
               if (blob) {
                 const url = URL.createObjectURL(blob);
                 console.log('✅ Restored audio from IndexedDB');
                 // Update the notebook's URL in memory/local state mainly, 
                 // strictly updating localStorage with a blob URL is okay for the current session,
                 // but we rely on this restoration logic for future sessions.
                 localStorageService.updateNotebook(notebookId, {
                   audio_overview_url: url
                 });
                 // Force a re-render/invalidation if needed, though updateNotebook should trigger listeners if any
                 queryClient.invalidateQueries({ queryKey: ["notebooks"] });
               } else {
                 console.warn('Audio blob not found in IndexedDB despite completed status');
               }
             });
           });
        }
      }
    }
  }, [notebookId, queryClient]);

  const generateAudioOverview = useMutation<AudioGenerationResult, Error, string>({
    // mutation takes a notebookId string
    mutationFn: async (notebookId: string) => {
      setIsGenerating(true);
      setGenerationStatus("processing");
      setGenerationProgress(null);

      // Update the notebook status in local storage
      localStorageService.updateNotebook(notebookId, {
        generation_status: "processing",
      });

      const notebook = localStorageService.getNotebook(notebookId);
      if (!notebook) {
        throw new Error("Notebook not found");
      }

      // Get all sources for this notebook to create content for the podcast
      const sources = localStorageService.getSources(notebookId);
      const notes = localStorageService.getNotes(notebookId);
      
      // Combine content from sources
      let combinedContent = "";
      
      // Add source content
      for (const source of sources) {
        if (source.content) {
          combinedContent += `\n\n--- ${source.title} ---\n${source.content.substring(0, 4000)}`;
        }
      }
      
      // Collect user notes separately - these are the user's highlights and insights
      let userNotes = "";
      for (const note of notes) {
        if (note.content) {
          userNotes += `\n\n${note.title}:\n${note.content}`;
        }
      }

      if (!combinedContent.trim()) {
        throw new Error("No content available to generate podcast. Please add some sources first.");
      }

      // Step 1: Generate the podcast script using AI
      console.log("🎙️ Generating podcast script...");
      console.log(`📚 Sources: ${sources.length}, Notes: ${notes.length}`);
      setGenerationStatus("generating_script");
      
      // Pass both content and user notes to the generator
      const script = await generatePodcastScript(
        combinedContent.substring(0, 12000),
        undefined,
        userNotes.trim() || undefined
      );
      console.log("✅ Podcast script generated:", script.title, `(${script.segments.length} segments)`);

      // Step 2: Generate audio using TTS provider (Ultimate TTS Studio or Web Speech)
      console.log("🔊 Generating audio with TTS...");
      setGenerationStatus("generating_audio");
      
      const audioGenerator = getPodcastAudioGenerator();
      const initResult = await audioGenerator.initialize();
      
      let audioUrl: string;
      let provider: string;

      if (initResult.available) {
        try {
          const audioResult = await audioGenerator.generatePodcastAudio(
            script,
            undefined,
            (progress) => {
              setGenerationProgress(progress);
              console.log(`🎵 Audio generation: ${progress.percentage}% - ${progress.status}`);
            }
          );
          
          audioUrl = audioResult.audioUrl;
          provider = audioResult.provider;
          
          // Persist the blob to IndexedDB
          const { blobStorageService } = await import('../services/blobStorageService');
          await blobStorageService.savePodcastAudio(notebookId, audioResult.audioBlob);
          
          console.log(`✅ Audio generated using ${provider} and saved to IDB`);
        } catch (audioError) {
          console.warn("TTS generation failed, falling back to script-only mode:", audioError);
          // Fall back to script-only mode
          audioUrl = `data:application/json;base64,${btoa(JSON.stringify(script))}`;
          provider = "Script Only (TTS unavailable)";
        }
      } else {
        // No TTS available, store script for Web Speech API playback
        audioUrl = `data:application/json;base64,${btoa(JSON.stringify(script))}`;
        provider = "Web Speech API (Browser)";
      }

      // Update notebook with the audio URL
      localStorageService.updateNotebook(notebookId, {
        audio_overview_url: audioUrl,
        generation_status: "completed",
      });

      return { success: true, script, audioUrl, provider };
    },
    onSuccess: (data) => {
      console.log("Audio generation completed successfully:", data);
      setIsGenerating(false);
      setGenerationStatus("completed");
      setGenerationProgress(null);
      
      toast({
        title: "🎙️ Podcast Ready!",
        description: `Generated using ${data.provider}`,
      });
    },
    onError: (error, notebookIdVar) => {
      console.error("Audio generation failed:", error);
      setIsGenerating(false);
      setGenerationStatus("failed");
      setGenerationProgress(null);

      // Ensure notebook stored state reflects failure when possible
      if (typeof notebookIdVar === "string") {
        try {
          localStorageService.updateNotebook(notebookIdVar, {
            generation_status: "failed",
          });
        } catch (e) {
          console.error("Failed to mark notebook generation as failed:", e);
        }
      }

      toast({
        title: "Failed to Generate Podcast",
        description:
          (error && (error as Error).message) ||
          "Failed to generate audio overview. Please try again.",
        variant: "destructive",
      });
    },
  });

  const refreshAudioUrl = useMutation({
    mutationFn: async ({
      notebookId,
      silent = false,
    }: {
      notebookId: string;
      silent?: boolean;
    }) => {
      if (!silent) {
        setIsAutoRefreshing(true);
      }

      // Check if we have audio in IDB to restore
      const { blobStorageService } = await import('../services/blobStorageService');
      const blob = await blobStorageService.getPodcastAudio(notebookId);

      if (blob) {
        const url = URL.createObjectURL(blob);
        localStorageService.updateNotebook(notebookId, {
           audio_overview_url: url,
           audio_url_expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        });
        return { success: true, url };
      }

      throw new Error("No saved audio found to refresh");
    },
    onSuccess: (data, variables) => {
      console.log("Audio URL refreshed successfully:", data);
      // Invalidate queries to refresh the UI with new URL
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });

      if (!variables.silent) {
        setIsAutoRefreshing(false);
      }
    },
    onError: (error, variables) => {
      console.error("Failed to refresh audio URL:", error);
      if (!variables.silent) {
        setIsAutoRefreshing(false);
        toast({
          title: "Failed to Restore Audio",
          description: "Could not restore the audio file. You may need to regenerate it.",
          variant: "destructive",
        });
      }
    },
  });

  const checkAudioExpiry = (expiresAt: string | null): boolean => {
    // With IDB Blob URLs, we might not strictly "expire" in the same way, 
    // but the Blob URL itself is session bound, so checking on load is more important.
    // We can keep this for compatibility if we want to "refresh" the blob url periodically.
    if (!expiresAt) return true;
    return new Date(expiresAt) <= new Date();
  };

  const autoRefreshIfExpired = async (
    notebookId: string,
    expiresAt: string | null,
  ) => {
    if (
      checkAudioExpiry(expiresAt) &&
      !isAutoRefreshing &&
      !refreshAudioUrl.isPending
    ) {
      console.log("Audio URL expired or invalid, attempting restore...");
      try {
        await refreshAudioUrl.mutateAsync({ notebookId, silent: true });
      } catch (error) {
        console.error("Auto-refresh failed:", error);
      }
    }
  };

  return {
    generateAudioOverview: generateAudioOverview.mutate,
    refreshAudioUrl: (notebookId: string) =>
      refreshAudioUrl.mutate({ notebookId }),
    autoRefreshIfExpired,
    isGenerating: isGenerating || generateAudioOverview.isPending,
    isAutoRefreshing,
    generationStatus,
    generationProgress,
    checkAudioExpiry,
  };
};
