import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { extractWebSource } from './extractionService.js';
import { logger } from '../utils/logger.js';

/**
 * Performs a web search using DuckDuckGo HTML scraper and extracts the top result.
 * @param {string} query - The search query
 * @returns {Promise<{results: Array, topPageContent: string, topPageTitle: string}>}
 */
export async function performWebSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  logger.info(`[WebSearch] Querying DDG for: "${query}"`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    if (!res.ok) {
      throw new Error(`DDG returned HTTP ${res.status}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];

    $('.result__body').each((i, el) => {
      if (results.length >= 5) return;
      const titleEl = $(el).find('.result__a');
      const snippetEl = $(el).find('.result__snippet');
      const title = titleEl.text().trim();
      const rawLink = titleEl.attr('href');
      const snippet = snippetEl.text().trim();

      if (title && rawLink) {
        let targetUrl = rawLink;
        if (rawLink.includes('uddg=')) {
          const match = rawLink.match(/uddg=([^&]+)/);
          if (match) {
            targetUrl = decodeURIComponent(match[1]);
          }
        } else if (rawLink.startsWith('//')) {
          targetUrl = 'https:' + rawLink;
        }
        results.push({ title, url: targetUrl, snippet });
      }
    });

    logger.info(`[WebSearch] DDG returned ${results.length} links.`);

    // Fetch the full content of the top result to ground the AI
    let topPageContent = '';
    let topPageTitle = '';
    if (results.length > 0) {
      const topResult = results[0];
      try {
        logger.info(`[WebSearch] Attempting to extract top result: ${topResult.url}`);
        const extracted = await extractWebSource(topResult.url);
        if (extracted && extracted.content) {
          topPageContent = extracted.content;
          topPageTitle = extracted.title || topResult.title;
          logger.info(`[WebSearch] Successfully extracted ${topPageContent.length} chars from top page.`);
        }
      } catch (err) {
        logger.warn(`[WebSearch] Failed to extract top result content: ${err.message}`);
      }
    }

    return {
      results,
      topPageContent,
      topPageTitle
    };
  } catch (error) {
    logger.error(`[WebSearch] Search failed:`, error);
    return { results: [], topPageContent: '', topPageTitle: '' };
  }
}

export default { performWebSearch };
