import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import apiService from '../services/apiService';
import { useAddSourcesHandlers } from '../components/notebook/hooks/useAddSourcesHandlers';
import { shouldReportNetworkError } from '@/lib/utils/networkError';

const ignoreModalChange = () => {};

/**
 * A hook that checks for unencrypted raw files uploaded by CLI agents
 * into the Agent Dropbox, processes them locally (extracts text, generates embeddings),
 * encrypts them, syncs them to the backend, and then deletes the raw footprint.
 */
export const useAgentIngestion = (notebookId: string | undefined) => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);

  // Hook into the main file upload pipeline, ignoring the UI modal states
  const { handleFileUpload } = useAddSourcesHandlers(notebookId, ignoreModalChange, false);
  const uploadHandler = useRef(handleFileUpload);
  const persistedUploads = useRef(new Set<string>());
  const accessToken = session?.access_token;

  useEffect(() => {
    uploadHandler.current = handleFileUpload;
  }, [handleFileUpload]);

  useEffect(() => {
    setIsIngesting(false);
    setIngestionStatus(null);
    if (!notebookId || !accessToken) return;

    const controller = new AbortController();
    let inFlight = false;
    const checkAndProcessPendingUploads = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const { success, pendingUploads } = await apiService.getPendingAgentUploads(notebookId, accessToken, controller.signal);
        if (controller.signal.aborted) return;
        
        if (success && pendingUploads && pendingUploads.length > 0) {
          console.log(`🤖 Agent Ingestion: Found ${pendingUploads.length} pending files.`);
          setIsIngesting(true);

          for (const upload of pendingUploads) {
            if (controller.signal.aborted) break;
            setIngestionStatus(`Processing agent file: ${upload.file_name}...`);
            try {
              if (!persistedUploads.current.has(upload.id)) {
                const fileBlob = await apiService.downloadAgentUpload(upload.id, accessToken);
                if (controller.signal.aborted) break;
                const syntheticFile = new File([fileBlob], upload.file_name, {
                  type: upload.mime_type || 'application/octet-stream',
                });
                const persistedCount = await uploadHandler.current([syntheticFile], { waitForProcessing: true });
                if (persistedCount !== 1) continue;
                persistedUploads.current.add(upload.id);
              }

              if (controller.signal.aborted) break;
              await apiService.deleteAgentUpload(upload.id, accessToken);
              persistedUploads.current.delete(upload.id);
              console.log(`✅ Agent Ingestion: Successfully processed and secured ${upload.file_name}`);
            } catch (err) {
              console.error(`❌ Agent Ingestion: Failed to process ${upload.file_name}`, err);
            }
          }
          
          if (!controller.signal.aborted) {
            setIngestionStatus(null);
            queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
          }
        }
      } catch (err) {
        if (shouldReportNetworkError(err, controller.signal)) console.error("Error during agent ingestion polling:", err);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setIsIngesting(false);
      }
    };

    // Run once on mount and every 30 seconds while the notebook is open
    checkAndProcessPendingUploads();
    const interval = setInterval(checkAndProcessPendingUploads, 30000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [notebookId, accessToken, queryClient]);

  return { isIngesting, ingestionStatus };
};
