import { useState } from "react";
import { localStorageService } from "@/services/localStorageService";
import { useToast } from "@/hooks/use-toast";
import { extractContent, getFileCategory } from "@/lib/extraction/documentExtractor";
import { validateDocumentContent } from "@/lib/extraction/contentValidator";
import { enhancedPDFExtraction } from "@/lib/extraction/pdfExtractor";

export const useFileUpload = () => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const uploadFile = async (
    file: File,
    notebookId: string,
    sourceId: string,
  ): Promise<string | null> => {
    try {
      setIsUploading(true);

      // Get file extension
      const fileExtension = file.name.split(".").pop() || "bin";

      // Create file path: sources/{notebook_id}/{source_id}.{extension}
      const filePath = `${notebookId}/${sourceId}.${fileExtension}`;

      console.log("📤 Uploading file to:", filePath);

      // Extract content using optimized extractor
      let content = "";
      let metadata: { extractionMethod?: string; [key: string]: unknown } = {};
      let chunks: string[] = [];

      try {
        console.log(`🔍 Starting extraction for: ${file.name} (${file.type})`);
        const extractionResult = await extractContent(file);
        content = extractionResult.content;
        metadata = extractionResult.metadata;
        chunks = extractionResult.chunks || [];

        // Check if the content is actually an error message from the server
        if (content &&
            (content.toLowerCase().includes("server error") ||
             content.toLowerCase().includes("pdf processing error") ||
             content.toLowerCase().includes("network connectivity issues") ||
             content.toLowerCase().includes("unable to extract text from"))) {
          console.warn("Server returned error message instead of processed content");

          // Try PDF to text conversion as fallback for PDF files
          if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
            console.log("🔄 Attempting client-side PDF to text conversion as fallback...");
            try {
              const pdfResult = await enhancedPDFExtraction(file);
              if (pdfResult.success && pdfResult.content && pdfResult.content.trim().length > 0) {
                console.log(`✅ Client-side PDF to text conversion successful: ${pdfResult.content.length} chars extracted from ${pdfResult.metadata.extractedPages} pages`);
                content = pdfResult.content;
                metadata = {
                  ...metadata,
                  extractionMethod: "enhanced-pdf-extraction",
                  totalPages: pdfResult.metadata.totalPages,
                  extractedPages: pdfResult.metadata.extractedPages,
                  pdfTitle: pdfResult.metadata.title,
                  pdfAuthor: pdfResult.metadata.author
                };
                chunks = [];
              } else {
                console.warn("PDF to text conversion failed or returned no content:", pdfResult.error);
                toast({
                  title: "PDF Conversion Failed",
                  description: `Failed to extract text from ${file.name}. ${pdfResult.error || 'The PDF may be encrypted, password-protected, or contain only images.'}`,
                  variant: "destructive",
                });
                throw new Error("PDF extraction failed and fallback also failed");
              }
            } catch (pdfConversionError) {
              console.error("PDF to text conversion also failed:", pdfConversionError);
              toast({
                title: "PDF Processing Error",
                description: `Could not process ${file.name} as a PDF. The file may be password-protected, encrypted, or corrupted.`,
                variant: "destructive",
              });
              throw pdfConversionError; // Re-throw the conversion error
            }
          } else {
            // For non-PDF files, show the original error
            toast({
              title: "Extraction Error",
              description: `Failed to extract content from ${file.name}. The file may be corrupted or in an unsupported format.`,
              variant: "destructive",
            });
            throw new Error("Content extraction returned an error instead of valid content");
          }
        } else {
          console.log(
            `✅ Extracted ${content.length} chars using ${metadata.extractionMethod}`,
          );
          console.log(`📦 Created ${chunks.length} chunks for better search`);
          console.log(`📝 Content preview: ${content.substring(0, 200)}...`);
          console.log(`🔢 First chunk: ${chunks[0]?.substring(0, 100)}...`);
        }
      } catch (extractionError) {
        console.error("⚠️ Content extraction failed:", extractionError);
        console.error("⚠️ Error details:", extractionError);

        // Try PDF to text conversion as fallback for PDF files
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          console.log("🔄 Attempting PDF to text conversion as fallback...");
          try {
            const pdfResult = await enhancedPDFExtraction(file);
            if (pdfResult.success && pdfResult.content && pdfResult.content.trim().length > 0) {
              console.log(`✅ PDF to text conversion successful: ${pdfResult.content.length} chars extracted from ${pdfResult.metadata.extractedPages} pages`);
              content = pdfResult.content;
              metadata = {
                ...metadata,
                extractionMethod: "enhanced-pdf-extraction",
                totalPages: pdfResult.metadata.totalPages,
                extractedPages: pdfResult.metadata.extractedPages,
                pdfTitle: pdfResult.metadata.title,
                pdfAuthor: pdfResult.metadata.author
              };
              // Note: chunks will be empty initially, they'll be created later if needed
              chunks = [];
            } else {
              console.warn("PDF to text conversion failed or returned no content:", pdfResult.error);
              // Show specific PDF conversion error
              toast({
                title: "PDF Conversion Failed",
                description: `Failed to extract text from ${file.name}. ${pdfResult.error || 'The PDF may be encrypted, password-protected, or contain only images.'}`,
                variant: "destructive",
              });
              throw extractionError; // Re-throw original error
            }
          } catch (pdfConversionError) {
            console.error("PDF to text conversion also failed:", pdfConversionError);
            toast({
              title: "PDF Processing Error",
              description: `Could not process ${file.name} as a PDF. The file may be password-protected, encrypted, or corrupted.`,
              variant: "destructive",
            });
            throw extractionError; // Re-throw original error
          }
        } else {
          // For non-PDF files, show the original error
          toast({
            title: "Extraction Error",
            description: `Failed to extract content from ${file.name}. The file may be corrupted or in an unsupported format.`,
            variant: "destructive",
          });
          throw extractionError; // Re-throw to handle at higher level
        }
      }

      // Validate extracted content using comprehensive validation
      // If this is a PDF file, we may need to be more lenient with certain formatting artifacts
      const isPdfFile = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const validation = await validateDocumentContent(content, file.name);

      if (!validation.isValid) {
        console.error(`❌ Content validation failed for file: ${file.name}`, validation.issues);
        toast({
          title: "Content Validation Error",
          description: `Invalid content extracted from ${file.name}. ${validation.issues.join('; ')}`,
          variant: "destructive",
        });
        throw new Error(`Content validation failed for ${file.name}: ${validation.issues.join(', ')}`);
      }

      // For content quality, be more strict about certain types of issues
      // But be more lenient for PDF-converted content which may have formatting artifacts
      if (!validation.isHighQuality) {
        // Check if there are quality issues but content is still valid
        if (validation.issues.length > 0) {
          // For PDF files, be more lenient with formatting-related issues
          let criticalIssues = validation.issues.filter(issue =>
            issue.includes("binary") ||
            issue.includes("control characters") ||
            issue.includes("non-human text") ||
            issue.includes("only numbers or symbols") ||
            issue.includes("encoded data")
          );

          // If this is a PDF file, filter out formatting-specific issues since
          // PDF conversion can introduce these artifacts
          if (isPdfFile) {
            const formattingIssues = ["excessive length", "average word length", "special characters"];
            criticalIssues = criticalIssues.filter(issue =>
              !formattingIssues.some(formatIssue => issue.includes(formatIssue))
            );
          }

          if (criticalIssues.length > 0) {
            // If there are serious readability issues, fail the upload
            console.error(`❌ Content has serious readability issues for file: ${file.name}`, criticalIssues);
            toast({
              title: "Content Quality Error",
              description: `Content from ${file.name} has serious readability issues: ${criticalIssues.join('; ')}. ${validation.suggestions[0] || 'The file may not contain readable text.'}`,
              variant: "destructive",
            });
            throw new Error(`Content quality issues for ${file.name}: ${criticalIssues.join(', ')}`);
          } else {
            // For less serious quality issues (especially for PDFs), warn but continue
            console.warn(`⚠️ Content quality issues detected for file: ${file.name}`, validation.issues);
            toast({
              title: "Content Quality Warning",
              description: `Content extracted from ${file.name} has quality issues: ${validation.issues.join(', ')}. ${validation.suggestions[0] || ''}`,
              variant: "destructive",
            });
            // Continue with the upload but mark as lower quality
          }
        }
      }

      // Perform readability check only for content that passed all other validations
      // This check happens after successful extraction but before storing
      if (content.trim().length > 0) {
        try {
          const { isReadableText } = await import("@/lib/ai/ollamaService");
          if (!isReadableText(content)) {
            console.warn(`⚠️ Content may not be readable text for file: ${file.name}`);
            // Only show toast for content that passed extraction but failed readability
            toast({
              title: "Content Quality Note",
              description: `Content from ${file.name} may have limited readability. AI processing results may be affected.`,
              variant: "default", // Changed to default to avoid alarming users
            });
          }
        } catch (validationError) {
          console.log(`⚠️ Could not validate content readability: ${validationError}`);
          // Continue anyway, as validation function might not be available
        }
      }

      // Store file content in localStorage with chunks
      const fileData = {
        path: filePath,
        content: content,
        chunks: chunks,
        metadata: metadata,
        type: file.type,
        size: file.size,
        name: file.name,
      };

      localStorage.setItem(`file_${filePath}`, JSON.stringify(fileData));

      // Update the source with content, chunks, and validation results immediately
      console.log(
        `💾 Updating source ${sourceId} with content and ${chunks.length} chunks`,
      );
      const updateResult = localStorageService.updateSource(sourceId, {
        content: content,
        file_path: filePath,
        metadata: {
          ...metadata,
          chunks: chunks,
          fileCategory: getFileCategory(file),
          validation: validation, // Store the validation results
        },
      });
      console.log(`✅ Source updated:`, updateResult ? "success" : "failed");

      // Create blob URL for file access
      const blobUrl = URL.createObjectURL(file);

      console.log("✅ File uploaded successfully with content:", {
        path: filePath,
        contentLength: content.length,
        chunksCount: chunks.length,
        blobUrl,
      });

      // Verify source was saved correctly
      const verifySource = localStorageService.getSourceById(sourceId);
      console.log(
        `🔍 Verification - Source has content: ${!!verifySource?.content}, Length: ${verifySource?.content?.length || 0}`,
      );

      return blobUrl;
    } catch (error) {
      console.error("File upload failed:", error);
      toast({
        title: "Upload Error",
        description: `Failed to upload ${file.name}. Please try again.`,
        variant: "destructive",
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const getFileUrl = (filePath: string): string => {
    // Since we're using blob URLs now, just return the filePath as is
    return filePath;
  };

  return {
    uploadFile,
    getFileUrl,
    isUploading,
  };
};
