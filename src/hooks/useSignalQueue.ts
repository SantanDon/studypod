import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export interface SignalQueueItem {
  id: string;
  user_id: string;
  notebook_id: string | null;
  platform: 'linkedin' | 'twitter' | 'reddit' | 'threads';
  content: string;
  source_id: string | null;
  tweet_source_id: string | null;
  scheduled_for: string | null;
  note_id: string | null;
  status: 'draft' | 'approved' | 'posted' | 'archived';
  posted_at: string | null;
  created_at: string;
}

export interface SignalQueueStats {
  draft: number;
  approved: number;
  posted: number;
  archived: number;
  platforms: {
    linkedin: number;
    twitter: number;
    reddit: number;
    threads: number;
  };
}

export const useSignalQueue = (params?: { status?: string; platform?: string; notebookId?: string; limit?: number }) => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = !!session?.access_token;

  // Fetch queue items
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["signalQueue", params, isAuthenticated],
    queryFn: async () => {
      if (!isAuthenticated) return { items: [], total: 0 };
      return ApiService.fetchSignalQueue(session!.access_token, params);
    },
    enabled: isAuthenticated,
    refetchInterval: 10000, // Refresh every 10s
  });

  // Fetch stats
  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    queryKey: ["signalQueueStats", isAuthenticated],
    queryFn: async () => {
      if (!isAuthenticated) return null;
      const res = await ApiService.fetchSignalQueueStats(session!.access_token);
      return res.stats as SignalQueueStats;
    },
    enabled: isAuthenticated,
    refetchInterval: 10000,
  });

  // Create queue item
  const createItemMutation = useMutation({
    mutationFn: async (item: { notebookId?: string; platform: string; content: string; sourceId?: string; tweetSourceId?: string; scheduledFor?: string; noteId?: string }) => {
      if (!isAuthenticated) throw new Error("Authenticated session required");
      return ApiService.createSignalQueueItem(session!.access_token, item);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signalQueue"] });
      queryClient.invalidateQueries({ queryKey: ["signalQueueStats"] });
    },
  });

  // Update queue item
  const updateItemMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<SignalQueueItem> }) => {
      if (!isAuthenticated) throw new Error("Authenticated session required");
      return ApiService.updateSignalQueueItem(id, session!.access_token, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signalQueue"] });
      queryClient.invalidateQueries({ queryKey: ["signalQueueStats"] });
    },
  });

  // Delete queue item
  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!isAuthenticated) throw new Error("Authenticated session required");
      return ApiService.deleteSignalQueueItem(id, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signalQueue"] });
      queryClient.invalidateQueries({ queryKey: ["signalQueueStats"] });
    },
  });

  // Import tweets bulk
  const importTweetsMutation = useMutation({
    mutationFn: async ({ notebookId, urls, fileContent }: { notebookId: string; urls?: string[]; fileContent?: string }) => {
      if (!isAuthenticated) throw new Error("Authenticated session required");
      return ApiService.importTweets(notebookId, session!.access_token, { urls, fileContent });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["signalQueue"] });
      queryClient.invalidateQueries({ queryKey: ["signalQueueStats"] });
    },
  });

  return {
    items: data?.items || ([] as SignalQueueItem[]),
    total: data?.total || 0,
    stats: statsData || null,
    isLoading: isLoading || isLoadingStats,
    createItem: createItemMutation.mutateAsync,
    isCreating: createItemMutation.isPending,
    updateItem: updateItemMutation.mutateAsync,
    isUpdating: updateItemMutation.isPending,
    deleteItem: deleteItemMutation.mutateAsync,
    isDeleting: deleteItemMutation.isPending,
    importTweets: importTweetsMutation.mutateAsync,
    isImporting: importTweetsMutation.isPending,
    refetch,
  };
};
