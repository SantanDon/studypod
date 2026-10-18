import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export const useSourceUpdate = (notebookId?: string) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useAuth();

  const updateSource = useMutation({
    mutationFn: async ({
      sourceId,
      title,
    }: {
      sourceId: string;
      title: string;
    }) => {
      if (session?.access_token && !notebookId) {
        throw new Error("Notebook required to rename this source");
      }
      const updatedSource = session?.access_token
        ? await ApiService.updateSource(notebookId!, sourceId, { title }, session.access_token)
        : localStorageService.updateSource(sourceId, { title });

      if (!updatedSource) {
        throw new Error("Source not found");
      }

      return updatedSource;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notebookId ? ["sources", notebookId] : ["sources"] });
      toast({
        title: "Source renamed",
        description: "The source has been successfully renamed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to rename the source. Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    updateSource: updateSource.mutateAsync,
    isUpdating: updateSource.isPending,
  };
};
