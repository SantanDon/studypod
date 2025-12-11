import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService, LocalSource } from "@/services/localStorageService";
import { useAuth } from "@/contexts/AuthContext";
import { useNotebookGeneration } from "./useNotebookGeneration";
import { useEffect } from "react";

type Source = LocalSource;

export const useSources = (notebookId?: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { generateNotebookContentAsync } = useNotebookGeneration();

  const {
    data: sources = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["sources", notebookId],
    queryFn: async () => {
      if (!notebookId) return [];

      // Get sources from local storage
      const sources = await localStorageService.getSources(notebookId);

      // Sort by creation date (newest first)
      return sources.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
    enabled: !!notebookId,
  });

  // Refresh sources when notebook or user changes
  useEffect(() => {
    if (!notebookId || !user) return;

    console.log("Refreshing sources for notebook:", notebookId);

    // Invalidate queries to refetch sources
    queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
  }, [notebookId, user, queryClient]);

  const addSource = useMutation({
    mutationFn: async (sourceData: {
      notebookId: string;
      title: string;
      type: "pdf" | "text" | "website" | "youtube" | "audio";
      content?: string;
      url?: string;
      file_path?: string;
      file_size?: number;
      processing_status?: string;
      metadata?: unknown;
    }) => {
      if (!user) throw new Error("User not authenticated");

      // Create source in local storage
      const newSource = await localStorageService.createSource({
        notebook_id: sourceData.notebookId,
        // If title is an error message, use the file name instead
        title: sourceData.title && !sourceData.title.includes("extraction failed") 
          && !sourceData.title.includes("Unable to extract text") 
          && !sourceData.title.includes("PDF contains no extractable text")
          ? sourceData.title
          : (sourceData.file_path ? sourceData.file_path.split('/').pop()?.replace(/\.[^/.]+$/, "") || "Document" : "New Source"),
        type: sourceData.type,
        content: sourceData.content,
        url: sourceData.url,
        file_path: sourceData.file_path,
        file_size: sourceData.file_size,
        processing_status: sourceData.processing_status,
        metadata: sourceData.metadata || {},
      });

      return newSource;
    },
    onSuccess: async (newSource) => {
      console.log("Source added successfully:", newSource);

      // IMPORTANT: Snapshot current sources BEFORE invalidating to correctly detect first source
      const existingSources =
        (queryClient.getQueryData(["sources", notebookId]) as Source[]) || [];
      const isFirstSource = existingSources.length === 0;

      console.log(`📊 Existing sources count: ${existingSources.length}, isFirstSource: ${isFirstSource}`);

      // Now invalidate queries to refresh sources
      if (notebookId) {
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      }

      // Check for first source to trigger generation
      if (isFirstSource && notebookId) {
        console.log(
          "This is the first source, checking notebook generation status...",
        );

        // Check notebook generation status
        const notebook = localStorageService.getNotebook(notebookId);

        // Treat anything not 'completed' as eligible for generation
        const isAlreadyCompleted = notebook?.generation_status === "completed";

        if (!isAlreadyCompleted) {
          console.log("Triggering notebook content generation...");

          // Determine if we can trigger generation based on source type and available data
          const canGenerate =
            (newSource.type === "pdf" && newSource.file_path) ||
            (newSource.type === "text" && newSource.content) ||
            (newSource.type === "website" && (newSource.url || newSource.content)) ||
            (newSource.type === "youtube" && (newSource.url || newSource.content)) ||
            (newSource.type === "audio" && newSource.file_path);

          if (canGenerate) {
            try {
              // Mark as generating so UI shows spinner
              localStorageService.updateNotebook(notebookId, {
                generation_status: "processing",
              });
              // Invalidate notebook query to show generating state
              queryClient.invalidateQueries({ queryKey: ["notebooks"] });

              await generateNotebookContentAsync({
                notebookId,
                filePath: newSource.file_path || newSource.url,
                sourceType: newSource.type,
              });
            } catch (error) {
              console.error("Failed to generate notebook content:", error);
              // Still mark as completed on error so UI isn't stuck
              localStorageService.updateNotebook(notebookId, {
                generation_status: "completed",
              });
            }
          } else {
            console.log(
              "Source not ready for generation yet - missing required data",
            );
          }
        }
      }
    },
  });

  const updateSource = useMutation({
    mutationFn: async ({
      sourceId,
      updates,
    }: {
      sourceId: string;
      updates: {
        title?: string;
        file_path?: string;
        processing_status?: string;
      };
    }) => {
      // Update source in local storage
      const updatedSource = await localStorageService.updateSource(
        sourceId,
        updates,
      );

      if (!updatedSource) {
        throw new Error("Source not found");
      }

      return updatedSource;
    },
    onSuccess: async (updatedSource) => {
      // IMPORTANT: Snapshot BEFORE invalidating
      const existingSources =
        (queryClient.getQueryData(["sources", notebookId]) as Source[]) || [];
      const isFirstSource = existingSources.length === 1;

      // Invalidate queries to refresh sources
      if (notebookId) {
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      }

      // If file_path was added and this is the first source, trigger generation
      if (updatedSource.file_path && notebookId && isFirstSource) {
        const notebook = localStorageService.getNotebook(notebookId);

        // Treat anything not 'completed' as eligible for generation
        const isAlreadyCompleted = notebook?.generation_status === "completed";

        if (!isAlreadyCompleted) {
          console.log(
            "File path updated, triggering notebook content generation...",
          );

          try {
            // Mark as generating so UI shows spinner
            localStorageService.updateNotebook(notebookId, {
              generation_status: "processing",
            });
            queryClient.invalidateQueries({ queryKey: ["notebooks"] });

            await generateNotebookContentAsync({
              notebookId,
              filePath: updatedSource.file_path,
              sourceType: updatedSource.type,
            });
          } catch (error) {
            console.error("Failed to generate notebook content:", error);
            // Still mark as completed on error so UI isn't stuck
            localStorageService.updateNotebook(notebookId, {
              generation_status: "completed",
            });
          }
        }
      }
    },
  });

  return {
    sources,
    isLoading,
    error,
    addSource: addSource.mutate,
    addSourceAsync: addSource.mutateAsync,
    isAdding: addSource.isPending,
    updateSource: updateSource.mutate,
    isUpdating: updateSource.isPending,
  };
};
