import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { indexedDBService } from '@/services/indexedDBService';
import { clearPlaybackCheckpoint } from '@/lib/audio/playbackProgress';
import { useStudioIdentity, readGuestStudio, writeGuestStudio } from '@/services/studioApiService';
import { podcastApi, latestSavedPodcast, type PodcastRecord, type PodcastSave, type RecentPodcast } from '@/services/podcastApiService';

export function useRecentSavedPodcast(notebookIds: string[]) {
 const identity = useStudioIdentity();
 const notebookKey = notebookIds.join(',');
 const query = useQuery({
  queryKey: ['recentPodcast', identity.owner, identity.authenticated ? 'account' : 'guest', notebookKey],
  enabled: identity.ready && notebookIds.length > 0,
  queryFn: async (): Promise<RecentPodcast | null> => {
   identity.assertCurrent();
   if (identity.authenticated) {
    const record = await latestSavedPodcast(identity.token);
    identity.assertCurrent();
    return record && notebookIds.includes(record.notebook_id) ? record : null;
   }
   const ids = new Set(notebookIds);
   const records = readGuestStudio<PodcastRecord>(identity.owner, 'podcasts')
    .filter(record => ids.has(record.notebook_id) && record.persistence === 'guest')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
   identity.assertCurrent();
   const record = records[0];
   return record ? { id: record.id, notebook_id: record.notebook_id, title: record.title, created_at: record.created_at, duration: record.duration, persistence: 'guest' } : null;
  },
 });
 return { episode: query.data, isLoading: query.isLoading, error: query.error, retry: query.refetch, isRefreshing: query.isFetching };
}

export function usePodcastHistory(notebookId: string) {
 const identity = useStudioIdentity(notebookId);
 const { assertCurrent, authenticated, token } = identity;
 const queryClient = useQueryClient();
 const queryKey = ['podcasts',identity.key];
 const api = podcastApi(notebookId, identity.token);
 const query = useQuery({queryKey, enabled:identity.ready && !!notebookId, queryFn:async () => { identity.assertCurrent(); const records = identity.authenticated ? await api.list() : readGuestStudio<PodcastRecord>(identity.owner,'podcasts').filter(p => p.notebook_id === notebookId); identity.assertCurrent(); return records; }});
 const save = useMutation({ mutationFn:async (input:PodcastSave) => {
  identity.assertCurrent(); const id = input.id || crypto.randomUUID();
  let record:PodcastRecord;
  if(identity.authenticated) record = await api.save({...input,id});
  else { await indexedDBService.saveAudio(id,input.blob); identity.assertCurrent(); record = {id,notebook_id:notebookId,title:input.title,duration:input.duration,created_at:new Date().toISOString(),audio_blob_id:id,script:input.script,source_ids:input.sourceIds,persistence:'guest'}; const records = readGuestStudio<PodcastRecord>(identity.owner,'podcasts'); writeGuestStudio(identity.owner,'podcasts',[record,...records.filter(p=>p.id!==id)]); }
  identity.assertCurrent(); await queryClient.invalidateQueries({queryKey}); await queryClient.invalidateQueries({queryKey:['recentPodcast',identity.owner]}); return record;
 }});
 const remove = useMutation({mutationFn:async (record:PodcastRecord) => { identity.assertCurrent(); if(identity.authenticated) await api.remove(record.id); else { await indexedDBService.deleteAudio(record.audio_blob_id); identity.assertCurrent(); writeGuestStudio(identity.owner,'podcasts',readGuestStudio<PodcastRecord>(identity.owner,'podcasts').filter(p=>p.id!==record.id)); } identity.assertCurrent(); clearPlaybackCheckpoint(record.id); await queryClient.invalidateQueries({queryKey}); await queryClient.invalidateQueries({queryKey:['recentPodcast',identity.owner]}); }});
 const loadAudio = useCallback(async (record:PodcastRecord) => { assertCurrent(); const blob = authenticated ? await podcastApi(notebookId,token).audio(record.id) : await indexedDBService.getAudio(record.audio_blob_id); assertCurrent(); if(!blob) throw new Error('The saved audio is missing. Remove this episode and generate it again.'); return blob; },[assertCurrent,authenticated,token,notebookId]);
 return {podcasts:query.data,isLoading:query.isLoading,loadError:query.error,mutationError:save.error||remove.error,retryHistory:query.refetch,isRefreshing:query.isFetching,savePodcast:save.mutateAsync,isSaving:save.isPending,deletePodcast:remove.mutateAsync,isDeleting:remove.isPending,loadAudio,scopeKey:identity.key,ready:identity.ready,authenticated:identity.authenticated,assertCurrent:identity.assertCurrent};
}
