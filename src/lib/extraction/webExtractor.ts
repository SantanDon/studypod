/**
 * Web Content Extraction and Validation Service
 *
 * Provides utilities to scrape web content, validate it, and prevent hallucinations
 * when processing website sources.
 */

import { validateDocumentContent } from "./contentValidator";
import { Readability } from '@mozilla/readability';

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
  url: string
): Promise<WebContentResult> {
  const startTime = Date.now();

  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid URL protocol");
    }

    // Use CORS proxy for fetching external websites
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    
    console.log(`Fetching website content via proxy: ${url}`);
    
    const response = await fetch(proxyUrl, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Parse HTML string into DOM Document
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Extract title
    const title = doc.title || doc.querySelector("h1")?.textContent || parsedUrl.hostname;

    // Extract description
    const description = 
      doc.querySelector('meta[name="description"]')?.getAttribute('content') || 
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || 
      "";
      
    // Count links and images using the original document BEFORE Readability modifies it
    const links = doc.querySelectorAll("a").length;
    const images = doc.querySelectorAll("img").length;

    // Use Readability to extract the core article content intelligently
    const reader = new Readability(doc);
    const article = reader.parse();

    let content = "";
    if (article && article.textContent && article.textContent.trim().length > 100) {
      content = article.textContent
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 50000);
    } else {
      // Fallback if Readability yields nothing or very little text
      const contentElement = doc.querySelector("article, main, [role='main'], #mw-content-text, .mw-parser-output, #content, .post-content, .entry-content") || doc.body;
      content = (contentElement?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 50000);
    }

    const validation = await validateDocumentContent(content, title);

    return {
      url,
      title,
      description,
      content,
      extractedText: content,
      metadata: {
        wordCount: content.split(/\s+/).filter((w) => w.length > 0).length,
        charCount: content.length,
        images,
        links,
        processingTime: Date.now() - startTime,
        extractionMethod: "cheerio",
      },
      isValid: validation.isValid,
      validationIssues: validation.issues,
    };
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
  } = {}
): Promise<WebContentResult[]> {
  const { maxConcurrent = 3, timeout = 30000 } = options;

  // Process URLs in batches to avoid overwhelming
  const results: WebContentResult[] = [];

  // Process in batches
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent);

    const batchPromises = batch.map((url) => {
      return Promise.race([
        extractWebContent(url),
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

/**
 * Sanitizes and cleans web content to remove potential hallucination sources
 */
export function sanitizeWebContent(content: string): string {
  // Remove common web artifacts that might cause hallucinations
  return (
    content
      // Remove script and style tags if present in raw HTML
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      // Remove comments
      .replace(/<!--[\s\S]*?-->/g, "")
      // Remove excessive whitespace and normalize line breaks
      .replace(/\s+/g, " ")
      .trim()
  );
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
