import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export const useSourceDelete = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  const deleteSource = useMutation({
    mutationFn: async (sourceId: string) => {
      console.log("Starting source deletion process for:", sourceId);

      try {
        // First, get the source details including file information
        const source = localStorageService.getSourceById(sourceId);

        if (!source) {
          console.error("Source not found");
          throw new Error("Failed to find source");
        }

        console.log(
          "Found source to delete:",
          source.title,
          "with file_path:",
          source.file_path,
        );

        // Delete the file from storage if it exists
        if (source.file_path) {
          console.log("Deleting file from storage:", source.file_path);

          // In a local implementation, we don't need to actually delete files
          // Just log that we would delete them
          console.log(
            "File would be deleted from local storage in a real implementation",
          );
          console.log(
            "File deleted successfully from local storage (simulated)",
          );
        } else {
          console.log(
            "No file to delete from storage (URL-based source or no file_path)",
          );
        }

        // Delete the source record from local storage
        const deleteSuccess = localStorageService.deleteSource(sourceId);

        if (!deleteSuccess) {
          console.error("Error deleting source from local storage");
          throw new Error("Failed to delete source");
        }

        console.log("Source deleted successfully from local storage");
        return source;
      } catch (error) {
        console.error("Error in source deletion process:", error);
        throw error;
      }
    },
    onSuccess: (deletedSource) => {
      console.log("Delete mutation success, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast({
        title: "Source deleted",
        description: `"${deletedSource?.title || "Source"}" has been successfully deleted.`,
      });
    },
    onError: (error: unknown) => {
      console.error("Delete mutation error:", error);

      let errorMessage = "Failed to delete the source. Please try again.";

      if (error instanceof Error) {
        // Provide more specific error messages based on the error type
        if (error.message.includes("not found")) {
          errorMessage = "Source not found.";
        } else if (error.message.includes("dependencies")) {
          errorMessage = "Cannot delete source due to data dependencies.";
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
    deleteSource: deleteSource.mutate,
    isDeleting: deleteSource.isPending,
  };
};
