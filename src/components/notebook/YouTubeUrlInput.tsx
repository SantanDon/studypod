
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUsageLimits } from '@/hooks/useUsageLimits';
import { extractVideoId } from '@/lib/extraction/youtubeExtractor';

interface YouTubeUrlInputProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (url: string, language: string) => Promise<boolean | void>;
}

const YouTubeUrlInput = ({ open, onOpenChange, onSubmit }: YouTubeUrlInputProps) => {
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState('en');
  const [isLoading, setIsLoading] = useState(false);
  const { status, canExtract, refreshStatus } = useUsageLimits();
  const isValidYoutubeUrl = Boolean(extractVideoId(url.trim()));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidYoutubeUrl) return;

    if (!canExtract()) {
      return; // UI should handle this but safety first
    }

    setIsLoading(true);
    try {
      const success = await onSubmit(url.trim(), language.trim() || 'en');
      await refreshStatus();
      if (success === false) return;
      setUrl('');
      onOpenChange(false);
    } catch (error) {
      console.error('Error adding YouTube source:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const isLimitReached = status ? status.remaining <= 0 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-background text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <i className="fi fi-rr-play-alt h-5 w-5 text-red-500"></i>
            </div>
            <span className="text-xl font-semibold tracking-tight text-foreground">
              YouTube Extraction
            </span>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">
          <div className="space-y-3">
            <Label htmlFor="youtube-url" className="text-muted-foreground text-sm">
              YouTube video URL
            </Label>
            <Input
              id="youtube-url"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="bg-background border-input h-12 text-base"
              required
            />
            <div className="space-y-2">
              <Label htmlFor="youtube-language" className="text-muted-foreground text-sm">
                Preferred transcript language
              </Label>
              <Input
                id="youtube-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                placeholder="en, ja, fr, zu..."
                className="bg-background border-input h-10"
                aria-describedby="youtube-language-help"
              />
              <p id="youtube-language-help" className="text-xs text-muted-foreground">
                StudyPod uses this language when multiple caption tracks are available.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center px-1">
              <p className="text-xs text-muted-foreground italic">
                Captions are required for chat and Studio. If unavailable, save the video and re-add its URL to retry later.
              </p>
              {status && (
                <div className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full border ${isLimitReached ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-green-500/20 bg-green-500/5 text-green-400/80'} transition-colors duration-500`}>
                  <div className={`w-1 h-1 rounded-full ${isLimitReached ? 'bg-red-500 animate-pulse' : 'bg-green-500'} `} />
                  <span className="text-[10px] font-medium tracking-tight">
                    {status.used} / {status.limit} used today
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex space-x-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={!url.trim() || !isValidYoutubeUrl || isLoading || isLimitReached}
            >
              {isLoading ? 'Extracting...' : isLimitReached ? 'Limit Reached' : !isValidYoutubeUrl && url.trim() ? 'Invalid URL' : 'Add Source'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default YouTubeUrlInput;
