import React, { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
// import { Upload, FileText, Link, Copy } from "lucide-react"; // Removed Lucide imports
import MultipleWebsiteUrlsDialog from "./MultipleWebsiteUrlsDialog";
import CopiedTextDialog from "./CopiedTextDialog";
import { useSources } from "@/hooks/useSources";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useDocumentProcessing } from "@/hooks/useDocumentProcessing";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useWebsiteProcessing } from "@/hooks/useWebsiteProcessing";
import { useYoutubeProcessing } from "@/hooks/useYoutubeProcessing";
import YouTubeUrlInput from "./YouTubeUrlInput";
import { useToast } from "@/hooks/use-toast";
// Local implementation - no Supabase needed
import { localStorageService } from "@/services/localStorageService";
import { useQueryClient } from "@tanstack/react-query";

interface AddSourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId?: string;
}

const AddSourcesDialog = ({
  open,
  onOpenChange,
  notebookId,
}: AddSourcesDialogProps) => {
  const [dragActive, setDragActive] = useState(false);
  const queryClient = useQueryClient();

  // Process a single source with Ollama
  const processSourceWithOllama = async (params: {
    type: string;
    notebookId: string;
    title: string;
    content: string;
    sourceId: string;
  }) => {
    console.log("Processing source with Ollama:", params);

    // In a real implementation, this would use Ollama to process the content
    // For now, we'll just simulate the processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("Source processing completed");

    // Update the source processing status in local storage
    localStorageService.updateSource(params.sourceId, {
      processing_status: "completed",
    });

    // Invalidate queries to refresh the UI
    queryClient.invalidateQueries({
      queryKey: ["sources", params.notebookId],
    });
  };

  // Process multiple sources with Ollama
  const processSourcesWithOllama = async (params: {
    type: string;
    notebookId: string;
    urls: string[];
    sourceIds: string[];
  }) => {
    console.log("Processing multiple sources with Ollama:", params);

    // In a real implementation, this would use Ollama to process each URL
    // For now, we'll just simulate the processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log("Multiple sources processing completed");

    // Update each source's processing status in local storage
    for (const sourceId of params.sourceIds) {
      localStorageService.updateSource(sourceId, {
        processing_status: "completed",
      });
    }

    // Invalidate queries to refresh the UI
    queryClient.invalidateQueries({
      queryKey: ["sources", params.notebookId],
    });
  };
  const [showCopiedTextDialog, setShowCopiedTextDialog] = useState(false);
  const [showMultipleWebsiteDialog, setShowMultipleWebsiteDialog] =
    useState(false);
  const [showYouTubeDialog, setShowYouTubeDialog] = useState(false);
  const [isLocallyProcessing, setIsLocallyProcessing] = useState(false);

  const { addSourceAsync, updateSource, isAdding } = useSources(notebookId);

  const { uploadFile, isUploading } = useFileUpload();

  const { processDocumentAsync, isProcessing } = useDocumentProcessing();

  const { generateNotebookContentAsync, isGenerating } =
    useNotebookGeneration();

  const { addWebsitesAsSources, isProcessing: isWebsiteProcessing } = useWebsiteProcessing();
  const { addYoutubeVideoAsSource, isProcessing: isYoutubeProcessing } = useYoutubeProcessing();

  const { toast } = useToast();

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      const processFileAsync = async (
        file: File,
        sourceId: string,
        notebookId: string,
      ) => {
        try {
          console.log(
            "Starting file processing for:",
            file.name,
            "source:",
            sourceId,
          );
          const fileType = file.type.includes("pdf")
            ? "pdf"
            : file.type.includes("audio")
              ? "audio"
              : "text";

          // Update status to uploading
          updateSource({
            sourceId,
            updates: {
              processing_status: "uploading",
            },
          });

          // Upload the file
          const filePath = await uploadFile(file, notebookId, sourceId);
          if (!filePath) {
            throw new Error("File upload failed - no file path returned");
          }
          console.log("File uploaded successfully:", filePath);

          // Update with file path and set to processing
          updateSource({
            sourceId,
            updates: {
              file_path: filePath,
              processing_status: "processing",
            },
          });

          // Start document processing
          try {
            await processDocumentAsync({
              sourceId,
              filePath,
              sourceType: fileType,
            });

            // Generate notebook content - only if notebookId is valid
            if (notebookId && fileType) {
              await generateNotebookContentAsync({
                notebookId,
                filePath,
                sourceType: fileType,
              });
            } else {
              console.error(
                "Missing required parameters for notebook generation:",
                {
                  notebookId,
                  fileType,
                },
              );
            }
            console.log("Document processing completed for:", sourceId);
          } catch (processingError) {
            console.error("Document processing failed:", processingError);

            // Update to completed with basic info if processing fails
            updateSource({
              sourceId,
              updates: {
                processing_status: "completed",
              },
            });
          }
        } catch (error) {
          console.error("File processing failed for:", file.name, error);

          // Update status to failed
          updateSource({
            sourceId,
            updates: {
              processing_status: "failed",
            },
          });
        }
      };

      if (!notebookId) {
        toast({
          title: "Error",
          description: "No notebook selected",
          variant: "destructive",
        });
        return;
      }

      console.log(
        "Processing multiple files with delay strategy:",
        files.length,
      );
      setIsLocallyProcessing(true);

      try {
        // Step 1: Create the first source immediately (this will trigger generation if it\'s the first source)
        const firstFile = files[0];
        const firstFileType = firstFile.type.includes("pdf")
          ? "pdf"
          : firstFile.type.includes("audio")
            ? "audio"
            : "text";
        const firstSourceData = {
          notebookId,
          title: firstFile.name,
          type: firstFileType as
            | "pdf"
            | "text"
            | "website"
            | "youtube"
            | "audio",
          file_size: firstFile.size,
          processing_status: "pending",
          metadata: {
            fileName: firstFile.name,
            fileType: firstFile.type,
          },
        };

        console.log("Creating first source for:", firstFile.name);
        const firstSource = await addSourceAsync(firstSourceData);

        let remainingSources = [];

        // Step 2: If there are more files, add a delay before creating the rest
        if (files.length > 1) {
          console.log(
            "Adding 150ms delay before creating remaining sources...",
          );
          await new Promise((resolve) => setTimeout(resolve, 150));

          // Create remaining sources
          remainingSources = await Promise.all(
            files.slice(1).map(async (file, index) => {
              const fileType = file.type.includes("pdf")
                ? "pdf"
                : file.type.includes("audio")
                  ? "audio"
                  : "text";
              const sourceData = {
                notebookId,
                title: file.name,
                type: fileType as
                  | "pdf"
                  | "text"
                  | "website"
                  | "youtube"
                  | "audio",
                file_size: file.size,
                processing_status: "pending",
                metadata: {
                  fileName: file.name,
                  fileType: file.type,
                },
              };
              console.log("Creating source for:", file.name);
              return await addSourceAsync(sourceData);
            }),
          );

          console.log("Remaining sources created:", remainingSources.length);
        }

        // Combine all created sources
        const allCreatedSources = [firstSource, ...remainingSources];

        console.log(
          "All sources created successfully:",
          allCreatedSources.length,
        );

        // Step 3: Close dialog immediately
        setIsLocallyProcessing(false);
        onOpenChange(false);

        // Step 4: Show success toast
        toast({
          title: "Files Added",
          description: `${files.length} file${files.length > 1 ? "s" : ""} added and processing started`,
        });

        // Step 5: Process files in parallel (background)
        const processingPromises = files.map((file, index) =>
          processFileAsync(file, allCreatedSources[index].id, notebookId),
        );

        // Don\'t await - let processing happen in background
        Promise.allSettled(processingPromises).then((results) => {
          const successful = results.filter(
            (r) => r.status === "fulfilled",
          ).length;
          const failed = results.filter((r) => r.status === "rejected").length;

          console.log("File processing completed:", {
            successful,
            failed,
          });

          if (failed > 0) {
            toast({
              title: "Processing Issues",
              description: `${failed} file${failed > 1 ? "s" : ""} had processing issues. Check the sources list for details.`,
              variant: "destructive",
            });
          }
        });
      } catch (error) {
        console.error("Error creating sources:", error);
        setIsLocallyProcessing(false);
        toast({
          title: "Error",
          description: "Failed to add files. Please try again.",
          variant: "destructive",
        });
      }
    },
    [
      notebookId,
      toast,
      addSourceAsync,
      updateSource,
      uploadFile,
      processDocumentAsync,
      generateNotebookContentAsync,
      setIsLocallyProcessing,
      onOpenChange,
    ],
  );

  // Reset local processing state when dialog opens
  useEffect(() => {
    if (open) {
      setIsLocallyProcessing(false);
    }
  }, [open]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const files = Array.from(e.dataTransfer.files);
        handleFileUpload(files);
      }
    },
    [handleFileUpload],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        const files = Array.from(e.target.files);
        handleFileUpload(files);
      }
    },
    [handleFileUpload],
  );


  const handleMultipleWebsiteSubmit = async (urls: string[]) => {
    if (!notebookId) return;
    setIsLocallyProcessing(true);

    try {
      // Use the new validated website processing
      const success = await addWebsitesAsSources(urls, notebookId);

      if (success) {
        toast({
          title: "Websites Added",
          description: `Successfully added websites to your notebook`,
        });
        onOpenChange(false);
      } else {
        throw new Error("Failed to add websites");
      }
    } catch (error) {
      console.error("Error adding multiple websites:", error);
      toast({
        title: "Error",
        description: "Failed to add websites",
        variant: "destructive",
      });
    } finally {
      setIsLocallyProcessing(false);
    }
  };

  const handleYouTubeSubmit = async (url: string) => {
    if (!notebookId) return;
    setIsLocallyProcessing(true);

    try {
      const success = await addYoutubeVideoAsSource(url, notebookId);
      if (success) {
        onOpenChange(false);
      }
    } catch (error) {
      console.error("Error adding YouTube video:", error);
    } finally {
      setIsLocallyProcessing(false);
    }
  };

  // Use local processing state instead of global processing states
  const isProcessingFiles = isLocallyProcessing || isWebsiteProcessing || isYoutubeProcessing;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-black rounded flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16px"
                    viewBox="0 -960 960 960"
                    width="16px"
                    fill="#FFFFFF"
                  >
                    <path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-200v-80h320v80H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm24-80h252q45-32 69.5-79T700-580q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 54 24.5 101t69.5 79Zm126 0Z" />
                  </svg>
                </div>
                <DialogTitle className="text-xl font-medium">
                  StudyLM
                </DialogTitle>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-medium mb-2">Add sources</h2>
              <p className="text-gray-600 text-sm mb-1">
                Sources let StudyLM base its responses on the information
                that matters most to you.
              </p>
              <p className="text-gray-500 text-xs">
                (Examples: marketing plans, course reading, research notes,
                meeting transcripts, sales documents, etc.)
              </p>
            </div>

            {/* File Upload Area */}
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                dragActive
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              } ${isProcessingFiles ? "opacity-50 pointer-events-none" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center space-y-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-slate-100">
                  <i className="fi fi-rr-upload h-6 w-6 text-slate-600"></i>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">
                    {isProcessingFiles
                      ? "Processing files..."
                      : "Upload sources"}
                  </h3>
                  <p className="text-gray-600 text-sm">
                    {isProcessingFiles ? (
                      "Please wait while we process your files"
                    ) : (
                      <>
                        Drag & drop or{" "}
                        <button
                          className="text-blue-600 hover:underline"
                          onClick={() =>
                            document.getElementById("file-upload")?.click()
                          }
                          disabled={isProcessingFiles}
                        >
                          choose file
                        </button>{" "}
                        to upload
                      </>
                    )}
                  </p>
                </div>
                <p className="text-xs text-gray-500">
                  Supported file types: PDF, txt, Markdown, Audio (e.g. mp3)
                </p>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.txt,.md,.mp3,.wav,.m4a"
                  onChange={handleFileSelect}
                  disabled={isProcessingFiles}
                />
              </div>
            </div>

            {/* Integration Options */}
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="h-auto p-4 flex flex-col items-center space-y-2"
                onClick={() => setShowMultipleWebsiteDialog(true)}
                disabled={isProcessingFiles}
              >
                <i className="fi fi-rr-link h-6 w-6 text-green-600"></i>
                <span className="font-medium">Link - Website</span>
                <span className="text-sm text-gray-500">
                  Multiple URLs at once
                </span>
              </Button>

              <Button
                variant="outline"
                className="h-auto p-4 flex flex-col items-center space-y-2"
                onClick={() => setShowCopiedTextDialog(true)}
                disabled={isProcessingFiles}
              >
                <i className="fi fi-rr-copy h-6 w-6 text-purple-600"></i>
                <span className="font-medium">Paste Text - Copied Text</span>
                <span className="text-sm text-gray-500">
                  Add copied content
                </span>
              </Button>
            </div>

            {/* Additional Options Row */}
            <div className="grid grid-cols-1 gap-4 mt-4">
              <Button
                variant="outline"
                className="h-auto p-4 flex flex-col items-center space-y-2"
                onClick={() => setShowYouTubeDialog(true)}
                disabled={isProcessingFiles}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                    <i className="fi fi-rr-youtube h-6 w-6 text-red-600"></i>
                </div>
                <span className="font-medium">YouTube Video</span>
                <span className="text-sm text-gray-500">
                  Analyze video transcript
                </span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sub-dialogs */}
      <CopiedTextDialog
        open={showCopiedTextDialog}
        onOpenChange={setShowCopiedTextDialog}
        notebookId={notebookId}
      />

      <MultipleWebsiteUrlsDialog
        open={showMultipleWebsiteDialog}
        onOpenChange={setShowMultipleWebsiteDialog}
        onSubmit={handleMultipleWebsiteSubmit}
      />

      <YouTubeUrlInput
        open={showYouTubeDialog}
        onOpenChange={setShowYouTubeDialog}
        onSubmit={handleYouTubeSubmit}
      />
    </>
  );
};

export default AddSourcesDialog;
