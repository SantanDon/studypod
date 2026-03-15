import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useAuthState } from "@/hooks/useAuthState";
import { useGuest } from "@/hooks/useGuest";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export interface Note {
  id: string;
  notebook_id: string;
  title: string;
  content: string;
  source_type: "user" | "ai_response";
  author_id?: string;
  author_name?: string;
  extracted_text?: string;
  created_at: string;
  updated_at: string;
}

export const useNotes = (notebookId?: string) => {
  const { user } = useAuthState();
  const { session } = useAuth();
  const { guestId } = useGuest();
  const effectiveUserId = user?.id || guestId;
  const queryClient = useQueryClient();

  const { data: notes, isLoading } = useQuery({
    queryKey: ["notes", notebookId, !!session?.access_token],
    queryFn: async () => {
      if (!notebookId) return [];

      let notes: Note[];
      
      if (session?.access_token) {
        console.log("useNotes: Fetching from cloud...");
        notes = await ApiService.fetchNotes(notebookId, session.access_token);
      } else {
        console.log("useNotes: Fetching from local storage...");
        notes = await localStorageService.getNotes(notebookId) as Note[];
      }

      // Sort by updated date (newest first)
      return notes.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    },
    enabled: !!notebookId && !!effectiveUserId,
  });

  const createNoteMutation = useMutation({
    mutationFn: async ({
      title,
      content,
      source_type = "user",
      extracted_text,
    }: {
      title: string;
      content: string;
      source_type?: "user" | "ai_response";
      extracted_text?: string;
    }) => {
      if (!notebookId) throw new Error("Notebook ID is required");

      // Create note in local storage
      const newNote = await localStorageService.createNote({
        notebook_id: notebookId,
        title,
        content,
        source_type,
        extracted_text,
      });

      return newNote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({
      id,
      title,
      content,
    }: {
      id: string;
      title: string;
      content: string;
    }) => {
      // Update note in local storage
      const updatedNote = await localStorageService.updateNote(id, {
        title,
        content,
      });

      if (!updatedNote) {
        throw new Error("Note not found");
      }

      return updatedNote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Delete note from local storage
      const deleteSuccess = await localStorageService.deleteNote(id);

      if (!deleteSuccess) {
        throw new Error("Note not found");
      }
      
      return { id, notebookId };
    },
    onMutate: async (noteId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["notes", notebookId] });

      // Snapshot the previous value
      const previousNotes = queryClient.getQueryData<Note[]>(["notes", notebookId]);

      // Optimistically update to remove the note
      if (previousNotes) {
        queryClient.setQueryData<Note[]>(
          ["notes", notebookId],
          previousNotes.filter((note) => note.id !== noteId)
        );
      }

      return { previousNotes };
    },
    onError: (err, noteId, context) => {
      // Rollback on error
      if (context?.previousNotes) {
        queryClient.setQueryData(["notes", notebookId], context.previousNotes);
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  return {
    notes,
    isLoading,
    createNote: createNoteMutation.mutate,
    isCreating: createNoteMutation.isPending,
    updateNote: updateNoteMutation.mutate,
    isUpdating: updateNoteMutation.isPending,
    deleteNote: deleteNoteMutation.mutate,
    isDeleting: deleteNoteMutation.isPending,
  };
};
