import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiService } from '@/services/apiService';
import { useStudioIdentity } from '@/services/studioApiService';

export interface Task {
  id: string; notebook_id: string; userId: string; content: string;
  status: 'pending' | 'completed'; priority: 'low' | 'medium' | 'high';
  source_id?: string; createdAt: string; updatedAt: string;
}

function normalizeTask(raw: Record<string, unknown>): Task {
  const notebook = raw.notebookId ?? raw.notebook_id;
  if (typeof raw.id !== 'string' || typeof notebook !== 'string' || typeof raw.content !== 'string'
    || !['pending', 'completed'].includes(String(raw.status))
    || !['low', 'medium', 'high'].includes(String(raw.priority))) {
    throw new Error('Saved tasks could not be read. Please retry.');
  }
  return { id: raw.id, notebook_id: notebook, content: raw.content,
    userId: String(raw.userId ?? raw.user_id ?? ''), status: raw.status as Task['status'],
    priority: raw.priority as Task['priority'],
    source_id: typeof (raw.sourceId ?? raw.source_id) === 'string' ? String(raw.sourceId ?? raw.source_id) : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''), updatedAt: String(raw.updatedAt ?? raw.updated_at ?? '') };
}

export const useTasks = (notebookId?: string) => {
  const identity = useStudioIdentity(notebookId);
  const queryClient = useQueryClient();
  const queryKey = ['tasks', notebookId, identity.owner];
  const eligible = !!notebookId && identity.ready && identity.authenticated;
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      identity.assertCurrent();
      if (!eligible) return [];
      const raw = await ApiService.fetchTasks(notebookId!, identity.token || 'COOKIE_SESSION');
      identity.assertCurrent();
      if (!Array.isArray(raw)) throw new Error('Saved tasks could not be read. Please retry.');
      return raw.map(normalizeTask);
    },
    enabled: eligible, refetchInterval: eligible ? 15000 : false,
  });
  const mutation = useMutation({
    mutationFn: async ({ content, priority = 'medium' }: { content: string; priority?: Task['priority']; sourceId?: string }) => {
      identity.assertCurrent();
      if (!eligible) throw new Error('Sign in and choose a notebook to save tasks.');
      const result = await ApiService.createTask(notebookId!, content, priority, identity.token || 'COOKIE_SESSION');
      identity.assertCurrent();
      await queryClient.invalidateQueries({ queryKey });
      return result;
    },
  });
  return { tasks: eligible ? query.data : undefined, isLoading: !identity.ready || (eligible && query.isLoading),
    ready: identity.ready, isAuthenticated: identity.authenticated, isError: eligible && query.isError,
    error: query.error, refetch: query.refetch,
    createTask: mutation.mutate, createTaskAsync: mutation.mutateAsync, isCreating: mutation.isPending };
};
