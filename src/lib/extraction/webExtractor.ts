/**
 * Web Content Extraction and Validation Service
 *
 * Provides utilities to scrape web content, validate it, and prevent hallucinations
 * when processing website sources.
 */

import { validateDocumentContent } from "./contentValidator";

export interface WebContentResult {
  url: string;
  title: string;
  description?: string;
  content: string;
  extractedText: string;
  metadata: {
    wordCount: number;
    charCount: number;
    images: number;
    links: number;
    processingTime: number;
    extractionMethod: string;
  };
  isValid: boolean;
  validationIssues?: string[];
}

/**
 * Extracts content from a web page using browser-compatible methods
 */
export async function extractWebContent(
  url: string,
  token?: string
): Promise<WebContentResult> {
  const startTime = Date.now();

  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid URL protocol");
    }

    // 1. Try smart backend extraction first
    const smartUrl = `/api/proxy/extract-web?url=${encodeURIComponent(url)}`;
    
    console.log(`[WebExtractor] Attempting smart extraction via backend: ${url}`);
    try {
      const headers: Record<string, string> = {};
      const authToken = token || localStorage.getItem("guest_id");
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const smartResponse = await fetch(smartUrl, { headers });
      if (smartResponse.ok) {
        const data = await smartResponse.json();
        
        if (data.content && data.content.length > 50) {
          console.log(`[WebExtractor] Backend extraction success!`);
          const validation = await validateDocumentContent(data.content, data.title || url);
          
          return {
            url,
            title: data.title || url,
            description: data.description || "",
            content: data.content,
            extractedText: data.content,
            metadata: {
              wordCount: data.metadata?.wordCount || data.content.split(/\s+/).filter((w: string) => w.length > 0).length,
              charCount: data.content.length,
              images: 0,
              links: 0,
              processingTime: Date.now() - startTime,
              extractionMethod: data.metadata?.extractionMethod || "server",
            },
            isValid: validation.isValid,
            validationIssues: validation.issues,
          };
        }
      }
    } catch (smartError) {
      console.warn('[WebExtractor] Backend extraction fetch failed:', smartError);
    }
    
    throw new Error("Backend extraction returned insufficient or invalid content.");
  } catch (error) {
    console.error(`Failed to extract content from ${url}:`, error);
    return {
      url,
      title: `Failed: ${url}`,
      content: `Failed to extract content from ${url}. Error: ${
        (error as Error).message
      }`,
      extractedText: "",
      metadata: {
        wordCount: 0,
        charCount: 0,
        images: 0,
        links: 0,
        processingTime: Date.now() - startTime,
        extractionMethod: "error",
      },
      isValid: false,
      validationIssues: [`Extraction failed: ${(error as Error).message}`],
    };
  }
}

/**
 * Validates web content for hallucination risks
 */
export async function validateWebContent(
  url: string,
  content: string
): Promise<{
  isValid: boolean;
  isHighQuality: boolean;
  issues: string[];
  confidenceScore: number;
}> {
  const validation = await validateDocumentContent(
    content,
    `web-content-${url}`
  );

  // Additional web-specific validation
  const issues = [...validation.issues];
  let confidenceScore = validation.confidenceScore;

  // Check if content looks like a proper web page
  if (content.length < 50) {
    issues.push("Content is too short to be meaningful web content");
    confidenceScore = Math.max(0, confidenceScore - 0.3);
  }

  // Check for common web scraping artifacts
  if (
    content.includes("404") ||
    content.includes("Not Found") ||
    content.includes("Access Denied")
  ) {
    issues.push("Content appears to be an error page");
    confidenceScore = Math.max(0, confidenceScore - 0.5);
  }

  return {
    isValid: validation.isValid,
    isHighQuality: validation.isHighQuality,
    issues,
    confidenceScore,
  };
}

/**
 * Extracts content from multiple URLs with parallel processing
 */
export async function extractMultipleWebContents(
  urls: string[],
  options: {
    maxConcurrent?: number;
    timeout?: number;
  } = {},
  token?: string
): Promise<WebContentResult[]> {
  const { maxConcurrent = 3, timeout = 30000 } = options;

  // Process URLs in batches to avoid overwhelming
  const results: WebContentResult[] = [];

  // Process in batches
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent);

    const batchPromises = batch.map((url) => {
      return Promise.race([
        extractWebContent(url, token),
        new Promise<WebContentResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout: ${url}`)), timeout)
        ),
      ]).catch((error) => {
        // Return error result if extraction fails
        return {
          url,
          title: `Error: ${url}`,
          content: `Failed to extract content from ${url}. Error: ${
            error.message || "Unknown error"
          }`,
          extractedText: "",
          metadata: {
            wordCount: 0,
            charCount: 0,
            images: 0,
            links: 0,
            processingTime: timeout,
            extractionMethod: "error",
          },
          isValid: false,
          validationIssues: [
            `Extraction failed: ${error.message || "Unknown error"}`,
          ],
        };
      });
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

/** Return plain source text, preserving the line breaks used by notebook citations. */
export function sanitizeWebContent(content: string): string {
  let text = content;
  // Most extracts already contain Markdown. Only interpret recognizable web markup.
  if (/<(?:!--|\/?(?:script|style|p|div|br|section|article|h[1-6]|li|table|span)\b)/i.test(content)) {
    const template = document.createElement("template");
    template.innerHTML = content;
    const fragment = template.content;
    fragment.querySelectorAll("script, style, template, noscript").forEach(node => node.remove());
    fragment.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
    fragment.querySelectorAll("p, div, section, article, h1, h2, h3, h4, h5, h6, li, tr")
      .forEach(node => node.append("\n"));
    text = fragment.textContent ?? "";
  }
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n").map(line => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Checks if a URL is likely to contain extractable content
 */
export function isLikelyExtractable(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    // Check for file extensions that might not be web pages
    const nonContentExtensions = [
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".mp4",
      ".mp3",
    ];
    const pathname = parsedUrl.pathname.toLowerCase();

    if (nonContentExtensions.some((ext) => pathname.endsWith(ext))) {
      return false;
    }

    // Check for common non-content URLs
    const nonContentPatterns = [
      /^mailto:/i,
      /^tel:/i,
      /\.pdf$/i,
      /\.zip$/i,
      /\.exe$/i,
    ];

    return !nonContentPatterns.some((pattern) => pattern.test(url));
  } catch {
    return false; // Invalid URL
  }
}
