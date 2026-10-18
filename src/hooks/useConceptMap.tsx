import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConceptMap } from '@/types/conceptMap';
import { generateConceptMap } from '@/lib/conceptMap/conceptMapGenerator';
import { useStudioIdentity, studioApi, readGuestStudio, writeGuestStudio } from '@/services/studioApiService';

// Legacy concept_maps has no owner. Preserve it without attributing it to any current identity.
export function useConceptMap(notebookId?: string) {
  const queryClient = useQueryClient();
  const identity = useStudioIdentity(notebookId);
  const api = studioApi(identity.token);
  const queryKey = ['concept-maps', identity.owner, notebookId];
  const [generatingProgress, setGeneratingProgress] = useState<string | null>(null);
  const query = useQuery({
    queryKey,
    enabled: identity.ready && (!identity.authenticated || !!notebookId),
    queryFn: async () => {
      identity.assertCurrent();
      const maps = identity.authenticated ? await api.maps(notebookId!)
        : readGuestStudio<ConceptMap>(identity.owner, 'maps').filter(map => !notebookId || map.notebookId === notebookId);
      identity.assertCurrent();
      return maps;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const generateMutation = useMutation({
    mutationFn: async ({ content, title, notebookId: id }: { content: string; title: string; notebookId: string }) => {
      identity.assertCurrent();
      if (!notebookId || id !== notebookId) throw new Error('Choose the current notebook before saving a map.');
      setGeneratingProgress('Analyzing content...');
      try {
        const result = await generateConceptMap(content, title, undefined, progress => {
          try { identity.assertCurrent(); setGeneratingProgress(progress); } catch { /* Discard stale progress. */ }
        });
        identity.assertCurrent();
        const now = new Date().toISOString();
        const draft: ConceptMap = { id: crypto.randomUUID(), notebookId: id, title, ...result, createdAt: now, updatedAt: now };
        setGeneratingProgress('Saving map...');
        const saved = identity.authenticated ? await api.createMap(draft) : draft;
        identity.assertCurrent();
        if (!identity.authenticated) writeGuestStudio(identity.owner, 'maps', [...readGuestStudio<ConceptMap>(identity.owner, 'maps'), saved]);
        return saved;
      } finally {
        try { identity.assertCurrent(); setGeneratingProgress(null); } catch { /* New scope owns progress. */ }
      }
    },
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: async (mapId: string) => {
      identity.assertCurrent();
      const map = (queryClient.getQueryData<ConceptMap[]>(queryKey) || query.data || []).find(item => item.id === mapId);
      if (!map) throw new Error('Map not found. Reload the notebook and try again.');
      if (identity.authenticated) await api.deleteMap(map);
      identity.assertCurrent();
      if (!identity.authenticated) writeGuestStudio(identity.owner, 'maps', readGuestStudio<ConceptMap>(identity.owner, 'maps').filter(item => item.id !== mapId));
    },
    onSuccess: refresh,
  });
  const resetGeneration = generateMutation.reset;
  const resetDeletion = deleteMutation.reset;
  useEffect(() => {
    setGeneratingProgress(null);
    resetGeneration();
    resetDeletion();
  }, [identity.key, resetGeneration, resetDeletion]);
  return {
    scopeKey: identity.key,
    conceptMaps: query.data || [],
    isLoading: query.isLoading,
    loadError: query.error instanceof Error ? query.error.message : null,
    mutationError: (generateMutation.error || deleteMutation.error)?.message || null,
    generatingProgress,
    generateMap: generateMutation.mutate,
    generateMapAsync: generateMutation.mutateAsync,
    isGenerating: generateMutation.isPending,
    deleteMap: deleteMutation.mutate,
    deleteMapAsync: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
