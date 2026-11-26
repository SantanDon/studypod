
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// import { Copy, ClipboardPaste, AlertTriangle } from 'lucide-react'; // Removed Lucide imports
import { useTextPaste } from '@/hooks/useTextPaste';

interface CopiedTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId?: string; // Add notebook ID to allow direct text paste
  onSuccess?: () => void;
}

const CopiedTextDialog = ({
  open,
  onOpenChange,
  notebookId,
  onSuccess,
}: CopiedTextDialogProps) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const { pasteTextAsSource, isProcessing } = useTextPaste();
  const [validationWarning, setValidationWarning] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim() || !notebookId) {
      return;
    }

    try {
      // Use the validated text paste function
      let acknowledged = false;
      const acknowledgePersistence = () => {
        if (acknowledged) return;
        acknowledged = true;
        setTitle('');
        setContent('');
        onOpenChange(false);
        onSuccess?.();
      };
      const success = await pasteTextAsSource(
        content.trim(),
        notebookId,
        title.trim(),
        acknowledgePersistence,
      );
      if (success) acknowledgePersistence();
    } catch (error) {
      console.error('Error submitting copied text:', error);
    }
  };

  const handleClose = () => {
    setTitle('');
    setContent('');
    setValidationWarning(null);
    onOpenChange(false);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setContent(text);
        if (!title.trim()) {
          const words = text.trim().split(' ').slice(0, 8).join(' ');
          setTitle(words.length > 50 ? words.substring(0, 50) + '...' : words);
        }
      }
    } catch (err) {
      console.error('Could not read clipboard:', err);
    }
  };

  const isValid = title.trim() !== '' && content.trim() !== '' && !!notebookId;
  const characterCount = content.length;

  // Optional: Real-time validation as user types
  useEffect(() => {
    if (content.trim() && validationWarning) {
      setValidationWarning(null); // Clear warning when user starts typing
    }
  }, [content, validationWarning]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <i className="fi fi-rr-copy h-5 w-5 text-purple-600"></i>
            <span>Add Copied Text</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Paste your own text or try a short sample to explore your notebook.
            </p>
          </div>

          {!content && !title && (
            <Button variant="outline" onClick={() => {
              setTitle('School garden experiment');
              setContent('In a fictional school garden, students planted twelve bean seedlings in two equal groups. Both groups received the same amount of water. One group grew in full sun and the other in partial shade. After four weeks, the full-sun group averaged 18 cm tall and the partial-shade group averaged 14 cm. The students planned to repeat the experiment before drawing a conclusion.');
            }}>
              Try a sample
            </Button>
          )}

          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-medium">
              Title
            </Label>
            <Input
              id="title"
              placeholder="Enter a title for this content..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="content" className="text-sm font-medium">
                Content
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePasteFromClipboard}
                className="flex items-center space-x-1"
              >
                <i className="fi fi-rr-clipboard h-4 w-4"></i>
                <span>Paste from Clipboard</span>
              </Button>
            </div>
            <Textarea
              id="content"
              placeholder="Your copied content will appear here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[200px] resize-y"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{characterCount} characters</span>
              {characterCount > 10000 && (
                <span className="text-amber-600">Large content may take longer to process</span>
              )}
            </div>
          </div>

          {validationWarning && (
            <div className="flex items-start space-x-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
              <i className="fi fi-rr-exclamation h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0"></i>
              <p className="text-sm text-amber-800">{validationWarning}</p>
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" onClick={handleClose} disabled={isProcessing}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!isValid || isProcessing}
            >
              {isProcessing ? 'Adding...' : 'Add Copied Text'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CopiedTextDialog;
