import React, { useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useNotebookDelete } from '@/hooks/useNotebookDelete';
import { useToast } from '@/hooks/use-toast';
import { Share2, Trash2 } from 'lucide-react';
import StudyGlyph from '@/components/notebook/StudyGlyph';
import { formatDisplayTitle } from '@/lib/utils/displayTitle';

interface NotebookCardProps {
  notebook: {
    id: string;
    title: string;
    date: string;
    sources: number;
    icon: string;
    color: string;
    hasCollaborators?: boolean;
    joinCode?: string;
  };
  isSelectionMode?: boolean;
}

const NotebookCard = ({
  notebook,
  isSelectionMode = false
}: NotebookCardProps) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const {
    deleteNotebook,
    isDeleting
  } = useNotebookDelete();
  const { toast } = useToast();
  const displayTitle = formatDisplayTitle(notebook.title, 'Untitled notebook');

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (notebook.joinCode) {
      navigator.clipboard.writeText(notebook.joinCode);
      toast({
        title: "Join code copied!",
        description: `Code ${notebook.joinCode} copied to clipboard. Share it with your teammate!`,
      });
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    console.log('Delete button clicked for notebook:', notebook.id);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    console.log('Confirming delete for notebook:', notebook.id);
    deleteNotebook(notebook.id);
    setShowDeleteDialog(false);
  };

  return <div 
      className="relative flex min-h-44 flex-col rounded-xl border border-border bg-card p-5 transition-colors group-hover:border-primary/50 group-focus-within:border-primary"
    >
      {!isSelectionMode && (
        <div className="absolute z-20 top-3 right-3 flex items-center space-x-1" data-delete-action="true">
          {notebook.joinCode && (
            <button onClick={handleShareClick} className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="Copy share join code" data-delete-action="true">
              <Share2 className="h-4 w-4" />
            </button>
          )}
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogTrigger asChild>
              <button onClick={handleDeleteClick} className="delete-button inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={isDeleting} data-delete-action="true" aria-label={`Delete ${displayTitle}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent onClick={event => event.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this notebook?</AlertDialogTitle>
                <AlertDialogDescription>
                  You're about to delete this notebook and all of its content. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmDelete} className="bg-blue-600 hover:bg-blue-700" disabled={isDeleting}>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      
      <div className="mb-3 flex size-14 items-center justify-center">
        {['', '📚', '📝'].includes(notebook.icon) ? (
          <StudyGlyph kind="notebook" className="size-14" />
        ) : (
          <span aria-hidden="true" className="text-2xl">{notebook.icon}</span>
        )}
      </div>
      
      <h3 className="mb-3 line-clamp-2 break-words text-xl font-semibold leading-tight tracking-tight text-foreground">
        {displayTitle}
      </h3>
      
      <div className="mt-auto flex flex-wrap items-center gap-x-2 text-sm leading-5 text-muted-foreground">
        <span>{notebook.sources} source{notebook.sources !== 1 ? 's' : ''}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{notebook.date}</span>
      </div>
    </div>;
};

export default NotebookCard;
