import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSignalQueue } from '@/hooks/useSignalQueue';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { validateBookmarkArchive, validateTweetUrls } from '@/lib/bookmarkImportValidation';

interface BookmarkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
}

const BookmarkImportDialog = ({
  open,
  onOpenChange,
  notebookId
}: BookmarkImportDialogProps) => {
  const [activeTab, setActiveTab] = useState<string>('paste');
  const [urlsText, setUrlsText] = useState('');
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileBookmarksCount, setFileBookmarksCount] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState('');
  const [isReadingFile, setIsReadingFile] = useState(false);
  const fileReadVersion = useRef(0);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { importTweets, isImporting } = useSignalQueue();
  const { toast } = useToast();
  const { session } = useAuth();
  const isAuthenticated = !!session?.access_token;

  const handleClose = () => {
    setUrlsText('');
    setFileContent('');
    setFileName('');
    setFileBookmarksCount(0);
    setFileError('');
    setIsReadingFile(false);
    fileReadVersion.current += 1;
    setActiveTab('paste');
    onOpenChange(false);
  };

  const urlValidation = validateTweetUrls(urlsText);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const processFile = (file: File) => {
    const version = ++fileReadVersion.current;
    setFileContent('');
    setFileName('');
    setFileBookmarksCount(0);
    setFileError('');
    setIsReadingFile(false);
    if (!/\.(json|js)$/i.test(file.name)) {
      setFileError('Please upload a .json or .js Twitter bookmarks file.');
      toast({
        title: "Invalid file type",
        description: "Please upload a .json or .js Twitter bookmarks file",
        variant: "destructive"
      });
      return;
    }

    const reader = new FileReader();
    setIsReadingFile(true);
    reader.onload = (e) => {
      if (version !== fileReadVersion.current) return;
      setIsReadingFile(false);
      const content = e.target?.result as string;
      try {
        const archive = validateBookmarkArchive(content);
        setFileContent(archive.fileContent);
        setFileName(file.name);
        setFileBookmarksCount(archive.count);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : 'Cannot read this archive. Please upload the original export.');
      }
    };
    reader.onerror = () => {
      if (version !== fileReadVersion.current) return;
      setIsReadingFile(false);
      setFileError('This file could not be read. Select it again or try another export.');
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleImport = async () => {
    if (!isAuthenticated || !canSubmit || isReadingFile) return;
    try {
      if (activeTab === 'paste') {
        const urls = urlValidation.urls;
        if (urls.length === 0) {
          toast({
            title: "No URLs found",
            description: "Please paste at least one valid X/Twitter status URL.",
            variant: "destructive"
          });
          return;
        }

        await importTweets({ notebookId, urls });
        toast({
          title: "Importing bookmarks",
          description: `Successfully started import of ${urls.length} tweet(s). Finding referenced resources & replies in background...`,
        });
      } else {
        if (!fileContent) {
          toast({
            title: "No file uploaded",
            description: "Please upload a Twitter bookmarks archive file first.",
            variant: "destructive"
          });
          return;
        }

        await importTweets({ notebookId, fileContent });
        toast({
          title: "Importing archive",
          description: `Successfully loaded bookmarks archive. Scraping and crawler active.`,
        });
      }
      handleClose();
    } catch (err: unknown) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Failed to import bookmarks",
        variant: "destructive"
      });
    }
  };

  const validUrls = urlValidation.urls;
  const canSubmit = isAuthenticated && !isReadingFile && (activeTab === 'paste' ? validUrls.length > 0 && urlValidation.invalidCount === 0 : !!fileContent && fileBookmarksCount > 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl bg-white border border-gray-100 shadow-2xl rounded-2xl p-6">
        <DialogHeader className="pb-4 border-b border-gray-50">
          <DialogTitle className="flex items-center space-x-2 text-xl font-semibold text-gray-900">
            <i className="fi fi-rr-bookmark text-indigo-600 text-2xl"></i>
            <span>Import Bookmarks & Tweet Seeds</span>
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500 mt-1">
            Feed StudyPod tweet seeds. It will automatically crawl embedded links, extract reply links, and populate research trails + the Social Queue.
          </DialogDescription>
        </DialogHeader>

        {!isAuthenticated && (
          <p role="status" className="mt-4 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800">
            Sign in to import bookmarks and tweet seeds into an account-owned notebook. This import is unavailable in guest mode.
          </p>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid grid-cols-2 bg-gray-50/80 p-1 rounded-xl">
            <TabsTrigger value="paste" className="rounded-lg py-2.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <i className="fi fi-rr-link mr-2"></i>Paste URLs
            </TabsTrigger>
            <TabsTrigger value="file" className="rounded-lg py-2.5 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <i className="fi fi-rr-file-import mr-2"></i>Twitter Archive JS/JSON
            </TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-4 pt-4 outline-none">
            <div className="space-y-2">
              <Label htmlFor="bookmark-tweet-urls" className="text-sm font-medium text-gray-700">Paste X / Twitter URL(s)</Label>
              <Textarea
                id="bookmark-tweet-urls"
                placeholder={`https://x.com/username/status/1234567890123456789\nhttps://twitter.com/another/status/987654321098765432`}
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                className="min-h-40 font-mono text-sm border-gray-200 focus:border-indigo-500 focus:ring-indigo-500 rounded-xl"
                rows={6}
              />
              <div className="flex justify-between items-center text-xs text-gray-500 px-1">
                <span>Enter one tweet link per line</span>
                {validUrls.length > 0 && (
                  <span className="font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                    {validUrls.length} valid tweet{validUrls.length !== 1 ? 's' : ''} detected
                  </span>
                )}
              </div>
              {urlValidation.invalidCount > 0 && (
                <p role="alert" className="text-sm text-red-600">
                  {urlValidation.invalidCount} invalid link{urlValidation.invalidCount !== 1 ? 's' : ''}. Use HTTPS links to an individual X or Twitter post, such as https://x.com/username/status/123. Remove profile links and links to other websites.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="file" className="space-y-4 pt-4 outline-none">
            <div className="space-y-2">
              <Label htmlFor="bookmark-archive-file" className="text-sm font-medium text-gray-700">Upload Bookmarks Export File</Label>
              
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  isDragging 
                    ? 'border-indigo-500 bg-indigo-50/30' 
                    : 'border-gray-200 hover:border-indigo-400 hover:bg-gray-50/30'
                }`}
              >
                <input
                  id="bookmark-archive-file"
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".json,.js"
                  className="hidden"
                />
                
                <div className="flex flex-col items-center space-y-3">
                  <div className="p-3 bg-indigo-50 text-indigo-600 rounded-full">
                    <i className="fi fi-rr-cloud-upload text-3xl"></i>
                  </div>
                  {fileName ? (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-800">{fileName}</p>
                      <p className="text-xs text-indigo-600 bg-indigo-50/60 px-3 py-1 rounded-full font-medium inline-block">
                        {fileBookmarksCount} bookmark{fileBookmarksCount !== 1 ? 's' : ''} found
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        Drag and drop your bookmarks export here
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Supports <code className="bg-gray-100 px-1 py-0.5 rounded">bookmarks.json</code> or <code className="bg-gray-100 px-1 py-0.5 rounded">bookmark.js</code> from Twitter archive
                      </p>
                    </div>
                  )}
                </div>
              </div>
              {isReadingFile && <p role="status" className="text-sm text-gray-500">Checking archive...</p>}
              {fileError && <p role="alert" className="text-sm text-red-600">{fileError}</p>}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end space-x-2 pt-4 mt-4 border-t border-gray-50">
          <Button variant="outline" onClick={handleClose} disabled={isImporting} className="rounded-xl border-gray-200 text-gray-700 hover:bg-gray-50">
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!canSubmit || isImporting}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100 hover:shadow-lg transition-all"
          >
            {isImporting ? (
              <span className="flex items-center space-x-2">
                <i className="fi fi-rr-spinner animate-spin"></i>
                <span>Deep-diving...</span>
              </span>
            ) : activeTab === 'paste' ? (
              `Import ${validUrls.length} Tweet${validUrls.length !== 1 ? 's' : ''}`
            ) : (
              'Import Archive'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookmarkImportDialog;
