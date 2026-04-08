import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

// STABILITY PATCH v3: firefighter. playwright and firecrawl-js PURGED.
// Direct fetch used for Firecrawl API to prevent bundling issues.

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

/**
 * Clean metadata extracted from generic DOM nodes
 */
function extractMetadata(doc, url) {
  const title = doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || url;
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content') || 
                      doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
  const author = doc.querySelector('meta[name="author"]')?.getAttribute('content') || 'Unknown';
  const publishedTime = doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || null;

  return { title: title.trim(), description: description.trim(), author, publishedTime };
}

/**
 * Phase 1: Cheerio + Readability. Fast, static HTML extraction.
 */
async function extractWithCheerio(url) {
  const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const response = await fetch(url, {
    headers: {
      'User-Agent': randomUA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'follow',
    timeout: 10000 
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();

  // Load into JSDOM for Readability
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const meta = extractMetadata(dom.window.document, url);

  if (!article || !article.textContent || article.textContent.trim().length < 200) {
    throw new Error('Cheerio extracted insufficient content (likely SPA or gated).');
  }

  return {
    content: article.textContent.replace(/\s+/g, ' ').trim(),
    title: article.title || meta.title,
    metadata: { ...meta, method: 'cheerio-readability' }
  };
}

/**
 * Phase 2: Direct Firecrawl API call (no library).
 */
async function extractWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('Firecrawl API Key missing.');

  console.log(`[ExtractionService] Fetching via Firecrawl API for: ${url}`);
  
  const response = await fetch('https://api.firecrawl.dev/v0/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url: url,
      pageOptions: {
        onlyMainContent: true,
        replaceAllPathsWithAbsolutePaths: true
      },
      extractorOptions: {
        mode: 'markdown'
      }
    })
  });

  const scrapeResult = await response.json();

  if (!scrapeResult.success) {
    throw new Error(`Firecrawl Error: ${scrapeResult.error || 'Unknown error'}`);
  }

  return {
    content: scrapeResult.data?.markdown || scrapeResult.data?.content || '',
    title: scrapeResult.data?.metadata?.title || url,
    metadata: {
      description: scrapeResult.data?.metadata?.description || '',
      author: scrapeResult.data?.metadata?.author || 'Unknown',
      method: 'firecrawl-api-v0'
    }
  };
}


/**
 * Orchestrator: Tries Cheerio -> Firecrawl
 */
export async function extractWebSource(url) {
  try {
    console.log(`[ExtractionService] Tier 1 (Cheerio) -> ${url}`);
    return await extractWithCheerio(url);
  } catch (err1) {
    console.warn(`[ExtractionService] Tier 1 Failed (${err1.message}). Escalating to Tier 2 (Firecrawl)...`);
    
    try {
      return await extractWithFirecrawl(url);
    } catch (err2) {
      console.error(`[ExtractionService] Extraction exhausted.`, err2);
      throw new Error('All extraction methods failed to retrieve readable content.');
    }
  }
}

export default { extractWebSource };
