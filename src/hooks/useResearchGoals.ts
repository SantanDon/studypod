import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export interface ResearchGoal {
  id: string;
  user_id: string;
  notebook_id: string;
  title: string;
  description: string | null;
  created_at: string;
}

export const useResearchGoals = (notebookId?: string) => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = !!session?.access_token;

  const { data: goalsData, isLoading, refetch } = useQuery({
    queryKey: ["researchGoals", notebookId, isAuthenticated],
    queryFn: async () => {
      if (!notebookId || !isAuthenticated) return [];
      const res = await ApiService.fetchResearchGoals(notebookId, session!.access_token);
      return res.goals as ResearchGoal[];
    },
    enabled: !!notebookId && isAuthenticated,
  });

  const createGoalMutation = useMutation({
    mutationFn: async ({ title, description }: { title: string; description: string }) => {
      if (!notebookId || !isAuthenticated) throw new Error("Authenticated session and notebook ID required");
      return ApiService.createResearchGoal(notebookId, title, description, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["researchGoals", notebookId] });
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (goalId: string) => {
      if (!notebookId || !isAuthenticated) throw new Error("Authenticated session and notebook ID required");
      return ApiService.deleteResearchGoal(notebookId, goalId, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["researchGoals", notebookId] });
    },
  });

  return {
    goals: goalsData || [],
    isLoading,
    createGoal: createGoalMutation.mutateAsync,
    isCreating: createGoalMutation.isPending,
    deleteGoal: deleteGoalMutation.mutateAsync,
    isDeleting: deleteGoalMutation.isPending,
    refetch,
  };
};
