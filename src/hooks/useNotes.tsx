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
  updatedAt?: string;
}

// Cloud notes store the title as a leading Markdown heading.
// Decode that envelope so opening and saving a note does not duplicate its title.
export const normalizeNoteRecord = (raw: Record<string, unknown>): Note => {
  const storedContent = typeof raw.content === "string" ? raw.content : "";
  const explicitTitle = typeof raw.title === "string" ? raw.title : "";
  const heading = !explicitTitle ? /^# ([^\r\n]+)\r?\n(?:\r?\n)?/.exec(storedContent) : null;
  return {
    ...raw,
    id: String(raw.id),
    notebook_id: String(raw.notebookId ?? raw.notebook_id ?? ""),
    title: explicitTitle || heading?.[1].trim() || "Untitled Note",
    content: heading ? storedContent.slice(heading[0].length) : storedContent,
    source_type: raw.source_type === "ai_response" ? "ai_response" : "user",
    author_id: (raw.authorId ?? raw.author_id) as string | undefined,
    created_at: (raw.createdAt ?? raw.created_at) as string,
    updated_at: (raw.updatedAt ?? raw.updated_at) as string,
  };
};

export const serializeNoteContent = (title: string, content: string): string =>
  title.trim() ? `# ${title.trim()}\n\n${content}` : content;

export const useNotes = (notebookId?: string) => {
  const { user } = useAuthState();
  const { session } = useAuth();
  const { guestId } = useGuest();
  const effectiveUserId = user?.id || guestId;
  const queryClient = useQueryClient();

  const isAuthenticated = !!session?.access_token;
  const notesQueryKey = ["notes", notebookId, effectiveUserId, isAuthenticated] as const;

  // ─── READ ──────────────────────────────────────────────────────────────────
  const { data: notes, isLoading } = useQuery({
    queryKey: notesQueryKey,
    queryFn: async () => {
      if (!notebookId) return [];

      let notes: Note[];

      if (isAuthenticated) {
        console.log("useNotes: Fetching from backend API...");
        const rawNotes = await ApiService.fetchNotes(notebookId, session!.access_token);
        notes = rawNotes.map(normalizeNoteRecord);
      } else {
        console.log("useNotes: Fetching from local storage...");
        notes = await localStorageService.getNotes(notebookId) as Note[];
      }

      return notes.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    },
    enabled: !!notebookId && !!effectiveUserId,
    // Refresh often so agent-created notes appear quickly
    refetchInterval: isAuthenticated ? 10000 : false,
  });

  // ─── CREATE ────────────────────────────────────────────────────────────────
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

      if (isAuthenticated) {
        // Write to backend — visible to agents and across devices
        const fullContent = serializeNoteContent(title, content);
        return ApiService.createNote(notebookId, fullContent, session!.access_token);
      } else {
        return localStorageService.createNote({
          notebook_id: notebookId,
          title,
          content,
          source_type,
          extracted_text,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  // ─── UPDATE ────────────────────────────────────────────────────────────────
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
      if (isAuthenticated) {
        const fullContent = serializeNoteContent(title, content);
        return ApiService.updateNote(notebookId!, id, fullContent, session!.access_token);
      } else {
        const updatedNote = await localStorageService.updateNote(id, { title, content });
        if (!updatedNote) throw new Error("Note not found");
        return updatedNote;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  // ─── DELETE ────────────────────────────────────────────────────────────────
  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (isAuthenticated) {
        return ApiService.deleteNote(notebookId!, id, session!.access_token);
      } else {
        const deleteSuccess = await localStorageService.deleteNote(id);
        if (!deleteSuccess) throw new Error("Note not found");
        return { id, notebookId };
      }
    },
    onMutate: async (noteId) => {
      await queryClient.cancelQueries({ queryKey: ["notes", notebookId] });
      const previousNotes = queryClient.getQueryData<Note[]>(notesQueryKey);
      if (previousNotes) {
        queryClient.setQueryData<Note[]>(
          notesQueryKey,
          previousNotes.filter((note) => note.id !== noteId)
        );
      }
      return { previousNotes, queryKey: notesQueryKey };
    },
    onError: (_err, _noteId, context) => {
      if (context?.previousNotes) {
        queryClient.setQueryData(context.queryKey, context.previousNotes);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  return {
    notes,
    isLoading,
    createNote: createNoteMutation.mutate,
    createNoteAsync: createNoteMutation.mutateAsync,
    isCreating: createNoteMutation.isPending,
    updateNote: updateNoteMutation.mutate,
    updateNoteAsync: updateNoteMutation.mutateAsync,
    isUpdating: updateNoteMutation.isPending,
    deleteNote: deleteNoteMutation.mutate,
    deleteNoteAsync: deleteNoteMutation.mutateAsync,
    isDeleting: deleteNoteMutation.isPending,
  };
};
