import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
// import { Download, FileText, Eye } from 'lucide-react'; // Removed Lucide imports
import { LocalNotebook, LocalSource } from '@/services/localStorageService';
import { Note } from '@/hooks/useNotes';
import { FlashcardDeck } from '@/types/flashcard';
import {
  ExportOptions,
  ExportData,
  ChatMessage,
  exportToMarkdown,
  downloadMarkdown,
  generateFilename,
} from '@/lib/export/markdownExporter';

interface ExportDialogProps {
  notebook: LocalNotebook;
  sources: LocalSource[];
  notes: Note[];
  flashcardDecks?: FlashcardDeck[];
  chatHistory?: ChatMessage[];
  isOpen: boolean;
  onClose: () => void;
}

const ExportDialog: React.FC<ExportDialogProps> = ({
  notebook,
  sources,
  notes,
  flashcardDecks = [],
  chatHistory = [],
  isOpen,
  onClose,
}) => {
  const [options, setOptions] = useState<ExportOptions>({
    includeSources: true,
    includeNotes: true,
    includeFlashcards: true,
    includeChat: false,
    obsidianFormat: false,
  });

  const [showPreview, setShowPreview] = useState(false);

  const exportData: ExportData = useMemo(() => ({
    notebook,
    sources: options.includeSources ? sources : undefined,
    notes: options.includeNotes ? notes : undefined,
    flashcardDecks: options.includeFlashcards ? flashcardDecks : undefined,
    chatHistory: options.includeChat ? chatHistory : undefined,
  }), [notebook, sources, notes, flashcardDecks, chatHistory, options]);

  const previewContent = useMemo(() => {
    const fullContent = exportToMarkdown(exportData, options);
    const maxPreviewLength = 2000;
    if (fullContent.length > maxPreviewLength) {
      return fullContent.substring(0, maxPreviewLength) + '\n\n... (truncated)';
    }
    return fullContent;
  }, [exportData, options]);

  const handleExport = () => {
    const content = exportToMarkdown(exportData, options);
    const filename = generateFilename(notebook.title, options.obsidianFormat);
    downloadMarkdown(content, filename);
    onClose();
  };

  const handleOptionChange = (key: keyof ExportOptions) => (checked: boolean) => {
    setOptions(prev => ({ ...prev, [key]: checked }));
  };

  const hasContent = sources.length > 0 || notes.length > 0 || flashcardDecks.length > 0 || chatHistory.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <i className="fi fi-rr-file h-5 w-5"></i>
            Export Notebook
          </DialogTitle>
          <DialogDescription>
            Export "{notebook.title}" to Markdown format
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground">Include in export:</h3>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeSources"
                    checked={options.includeSources}
                    onCheckedChange={handleOptionChange('includeSources')}
                    disabled={sources.length === 0}
                  />
                  <Label
                    htmlFor="includeSources"
                    className={sources.length === 0 ? 'text-muted-foreground' : ''}
                  >
                    Sources ({sources.length})
                  </Label>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeNotes"
                    checked={options.includeNotes}
                    onCheckedChange={handleOptionChange('includeNotes')}
                    disabled={notes.length === 0}
                  />
                  <Label
                    htmlFor="includeNotes"
                    className={notes.length === 0 ? 'text-muted-foreground' : ''}
                  >
                    Notes ({notes.length})
                  </Label>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeFlashcards"
                    checked={options.includeFlashcards}
                    onCheckedChange={handleOptionChange('includeFlashcards')}
                    disabled={flashcardDecks.length === 0}
                  />
                  <Label
                    htmlFor="includeFlashcards"
                    className={flashcardDecks.length === 0 ? 'text-muted-foreground' : ''}
                  >
                    Flashcards ({flashcardDecks.reduce((acc, deck) => acc + deck.cards.length, 0)} cards)
                  </Label>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="includeChat"
                    checked={options.includeChat}
                    onCheckedChange={handleOptionChange('includeChat')}
                    disabled={chatHistory.length === 0}
                  />
                  <Label
                    htmlFor="includeChat"
                    className={chatHistory.length === 0 ? 'text-muted-foreground' : ''}
                  >
                    Chat History ({chatHistory.length} messages)
                  </Label>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="obsidianFormat" className="font-medium">
                  Obsidian Format
                </Label>
                <p className="text-sm text-muted-foreground">
                  Uses [[wikilinks]] and #tags for Obsidian compatibility
                </p>
              </div>
              <Switch
                id="obsidianFormat"
                checked={options.obsidianFormat}
                onCheckedChange={handleOptionChange('obsidianFormat')}
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm">Preview</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="text-xs"
              >
                <i className="fi fi-rr-eye h-3 w-3 mr-1"></i>
                {showPreview ? 'Hide' : 'Show'} Preview
              </Button>
            </div>

            {showPreview && (
              <div className="bg-muted rounded-md p-4 max-h-64 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                  {previewContent}
                </pre>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={!hasContent}>
            <i className="fi fi-rr-download h-4 w-4 mr-2"></i>
            Export Markdown
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ExportDialog;
