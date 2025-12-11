import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { localNotebookStore } from "@/integrations/local/localNotebookStore";

export const useNotebooks = () => {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: notebooks = [],
    isLoading,
    error,
    isError,
  } = useQuery({
    queryKey: ["notebooks", user?.id],
    queryFn: async () => {
      if (!user) {
        console.log("No user found, returning empty notebooks array");
        return [];
      }

      console.log("Fetching notebooks for user:", user.id);

      // Get notebooks from the local store
      const notebooksData = await localNotebookStore.getNotebooks(user.id);

      console.log("Fetched notebooks:", notebooksData?.length || 0);
      return notebooksData || [];
    },
    enabled: isAuthenticated && !authLoading,
    retry: (failureCount: number, err: unknown) => {
      // Don't retry on auth errors
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message?: string }).message
          : undefined;

      if (msg?.includes("JWT") || msg?.toLowerCase().includes("auth")) {
        return false;
      }
      return failureCount < 3;
    },
  });

  const createNotebook = useMutation({
    mutationFn: async (notebookData: {
      title: string;
      description?: string;
    }) => {
      console.log("Creating notebook with data:", notebookData);
      console.log("Current user:", user?.id);

      if (!user) {
        console.error("User not authenticated");
        throw new Error("User not authenticated");
      }

      const data = await localNotebookStore.createNotebook(
        {
          title: notebookData.title,
          description: notebookData.description,
        },
        user.id,
      );

      console.log("Notebook created successfully:", data);
      return data;
    },
    onSuccess: () => {
      console.log("Mutation success, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ["notebooks", user?.id] });
    },
    onError: (error) => {
      console.error("Mutation error:", error);
    },
  });

  return {
    notebooks,
    isLoading: authLoading || isLoading,
    error: (error as Error)?.message || null,
    isError,
    createNotebook: createNotebook.mutate,
    isCreating: createNotebook.isPending,
  };
};
