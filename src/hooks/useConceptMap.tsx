import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConceptMap } from '@/types/conceptMap';
import { generateConceptMap } from '@/lib/conceptMap/conceptMapGenerator';

const STORAGE_KEY = 'concept_maps';

function getMapsFromStorage(): ConceptMap[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveMapsToStorage(maps: ConceptMap[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
}

export function useConceptMap(notebookId?: string) {
  const queryClient = useQueryClient();
  const [generatingProgress, setGeneratingProgress] = useState<string | null>(null);

  const { data: conceptMaps = [], isLoading } = useQuery({
    queryKey: ['concept-maps', notebookId],
    queryFn: () => getMapsFromStorage().filter(m => !notebookId || m.notebookId === notebookId),
  });

  const generateMutation = useMutation({
    mutationFn: async ({ content, title, notebookId }: { content: string; title: string; notebookId: string }) => {
      setGeneratingProgress('Analyzing content...');
      const result = await generateConceptMap(content, title, 'llama3.2:latest', (progress) => {
        setGeneratingProgress(progress);
      });
      
      const newMap: ConceptMap = {
        id: crypto.randomUUID(),
        notebookId,
        title,
        nodes: result.nodes,
        edges: result.edges,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      const maps = getMapsFromStorage();
      maps.push(newMap);
      saveMapsToStorage(maps);
      setGeneratingProgress(null);
      return newMap;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concept-maps'] });
    },
    onError: () => {
      setGeneratingProgress(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mapId: string) => {
      const maps = getMapsFromStorage().filter(m => m.id !== mapId);
      saveMapsToStorage(maps);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concept-maps'] });
    },
  });

  return {
    conceptMaps,
    isLoading,
    generatingProgress,
    generateMap: generateMutation.mutate,
    isGenerating: generateMutation.isPending,
    deleteMap: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
}
