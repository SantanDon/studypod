/**
 * Web Content Extraction and Validation Service
 *
 * Provides utilities to scrape web content, validate it, and prevent hallucinations
 * when processing website sources.
 */

import { validateDocumentContent } from "./contentValidator";
import * as cheerio from 'cheerio';

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
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $("script, style, noscript, nav, footer").remove();

    // Extract title
    const title =
      $("title").text() || $("h1").first().text() || parsedUrl.hostname;

    // Extract description
    const description = 
      $('meta[name="description"]').attr('content') || 
      $('meta[property="og:description"]').attr('content') || 
      "";

    // Extract main content
    const content = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 50000);

    // Count links and images
    const links = $("a").length;
    const images = $("img").length;

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
