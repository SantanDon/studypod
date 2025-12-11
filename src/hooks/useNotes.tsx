import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService, LocalNote } from "@/services/localStorageService";
import { useAuth } from "@/contexts/AuthContext";

export interface Note extends LocalNote {}

export interface Note {
  id: string;
  notebook_id: string;
  title: string;
  content: string;
  source_type: "user" | "ai_response";
  extracted_text?: string;
  created_at: string;
  updated_at: string;
}

export const useNotes = (notebookId?: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: notes, isLoading } = useQuery({
    queryKey: ["notes", notebookId],
    queryFn: async () => {
      if (!notebookId) return [];

      // Get notes from local storage
      const notes = await localStorageService.getNotes(notebookId);

      // Sort by updated date (newest first)
      return notes.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    },
    enabled: !!notebookId && !!user,
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
    },
    onSuccess: () => {
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
