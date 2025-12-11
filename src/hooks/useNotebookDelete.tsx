import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export const useNotebookDelete = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  const deleteNotebook = useMutation({
    mutationFn: async (notebookId: string) => {
      console.log("Starting notebook deletion process for:", notebookId);

      try {
        // First, get the notebook details for better error reporting
        const notebook = localStorageService.getNotebook(notebookId);

        if (!notebook) {
          console.error("Notebook not found");
          throw new Error("Notebook not found");
        }

        console.log("Found notebook to delete:", notebook.title);

        // Get all sources for this notebook to delete their files
        const sources = localStorageService.getSources(notebookId);

        if (!sources) {
          console.error("Failed to fetch sources for cleanup");
          throw new Error("Failed to fetch sources for cleanup");
        }

        console.log(`Found ${sources.length} sources to clean up`);

        // Delete all files from storage for sources that have file_path
        const filesToDelete = sources
          .filter((source) => source.file_path)
          .map((source) => source.file_path);

        if (filesToDelete.length > 0) {
          console.log("Deleting files from storage:", filesToDelete);

          // In a local implementation, we don't need to actually delete files
          // Just log that we would delete them
          console.log(
            "Files would be deleted from local storage in a real implementation",
          );

          console.log(
            "All files deleted successfully from local storage (simulated)",
          );
        } else {
          console.log(
            "No files to delete from storage (URL-based sources or no file_paths)",
          );
        }

        // Delete the notebook from local storage
        const deleteSuccess = localStorageService.deleteNotebook(notebookId);

        if (!deleteSuccess) {
          console.error("Error deleting notebook");
          throw new Error("Failed to delete notebook");
        }

        console.log("Notebook deleted successfully from local storage");
        return notebook;
      } catch (error) {
        console.error("Error in deletion process:", error);
        throw error;
      }
    },
    onSuccess: (deletedNotebook, notebookId) => {
      console.log("Delete mutation success, invalidating queries");

      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ["notebooks", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      queryClient.invalidateQueries({ queryKey: ["notebook", notebookId] });

      toast({
        title: "Notebook deleted",
        description: `"${deletedNotebook?.title || "Notebook"}" and all its sources have been successfully deleted.`,
      });
    },
    onError: (error: unknown) => {
      console.error("Delete mutation error:", error);

      let errorMessage = "Failed to delete the notebook. Please try again.";

      if (error instanceof Error) {
        // Provide more specific error messages based on the error type
        if (error.message.includes("not found")) {
          errorMessage = "Notebook not found.";
        } else if (error.message.includes("dependencies")) {
          errorMessage = "Cannot delete notebook due to data dependencies.";
        }
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  return {
    deleteNotebook: deleteNotebook.mutate,
    isDeleting: deleteNotebook.isPending,
  };
};
