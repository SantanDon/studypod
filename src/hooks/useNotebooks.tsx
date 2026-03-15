import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthState } from "@/hooks/useAuthState";
import { useGuest } from "@/hooks/useGuest";
import { localNotebookStore } from "@/integrations/local/localNotebookStore";
import { useSyncTrigger } from "@/hooks/useSyncTrigger";

export const useNotebooks = () => {
  const { user, isSignedIn: isAuthenticated } = useAuthState();
  const { isGuest, guestId, incrementUsage } = useGuest();
  const queryClient = useQueryClient();
  const { triggerSync } = useSyncTrigger();

  // Get the effective user ID (guest or authenticated)
  const effectiveUserId = user?.id || guestId;

  const {
    data: notebooks = [],
    isLoading,
    error,
    isError,
  } = useQuery({
    queryKey: ["notebooks", effectiveUserId],
    queryFn: async () => {
      if (!effectiveUserId) {
        console.log("No user or guest found, returning empty notebooks array");
        return [];
      }

      console.log("Fetching notebooks for:", isGuest ? "guest" : "user", effectiveUserId);

      // Get notebooks from the local store
      const notebooksData = await localNotebookStore.getNotebooks(effectiveUserId);

      console.log("Fetched notebooks:", notebooksData?.length || 0);
      return notebooksData || [];
    },
    enabled: !!effectiveUserId,
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
      console.log("Current user:", effectiveUserId);

      if (!effectiveUserId) {
        console.error("No user or guest ID available");
        throw new Error("Unable to create notebook. Please refresh and try again.");
      }

      const data = await localNotebookStore.createNotebook(
        {
          title: notebookData.title,
          description: notebookData.description,
        },
        effectiveUserId,
      );

      console.log("Notebook created successfully:", data);
      
      // Track guest usage
      if (isGuest) {
        incrementUsage('notebooks');
      }
      
      return data;
    },
    onSuccess: (data) => {
      console.log("Mutation success, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ["notebooks", effectiveUserId] });
      
      // Trigger background sync
      if (data) {
        triggerSync('notebook', data.id, data, 'create').catch(err => {
          console.error("Failed to trigger sync after creation:", err);
        });
      }
    },
    onError: (error) => {
      console.error("Mutation error:", error);
    },
  });

  return {
    notebooks,
    isLoading: isLoading,
    error: (error as Error)?.message || null,
    isError,
    createNotebook: createNotebook.mutate,
    isCreating: createNotebook.isPending,
  };
};
