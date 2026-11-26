import fetch from "node-fetch";
import { lookup } from "node:dns/promises";
import { Agent } from "node:https";
import { isIP } from "node:net";
import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";
import { assertSafeExternalHttpsUrl, isPublicIpAddress, parseExternalHttpsUrl } from "../utils/externalUrlSafety.js";

// Cheerio keeps the serverless extraction pass lightweight and ESM-compatible.

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_SAFE_REDIRECTS = 4;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

class ExternalDestinationError extends Error {}

async function lookupBeforeDeadline(host, signal) {
  signal.throwIfAborted();
  let onAbort;
  const deadline = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // The system resolver may finish later. The race still handles its rejection.
    return await Promise.race([lookup(host, { all: true, verbatim: true }), deadline]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function fetchPublicUrl(url, { headers, timeout = 15000 } = {}, fetchImpl = fetch) {
  // One deadline covers DNS, the redirect chain and reading the decoded body.
  const signal = AbortSignal.timeout(timeout);
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_SAFE_REDIRECTS; redirectCount += 1) {
    let target;
    let agent;
    try {
      target = parseExternalHttpsUrl(currentUrl);
      const host = target.hostname.replace(/^\[|\]$/g, "");
      if (!isIP(host)) {
        const addresses = await lookupBeforeDeadline(host, signal);
        if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
          throw new Error("Hostname must resolve exclusively to public addresses.");
        }
        // Keep the original HTTPS name for TLS and use exactly the vetted DNS answers.
        agent = new Agent({
          keepAlive: false,
          lookup(hostname, options, callback) {
            if (hostname !== host) return callback(new Error("Unexpected destination hostname."));
            const candidates = addresses.filter(({ family }) => !options.family || family === options.family);
            if (!candidates.length) return callback(new Error("No public address for this address family."));
            if (options.all) return callback(null, candidates);
            callback(null, candidates[0].address, candidates[0].family);
          },
        });
      }
    } catch (cause) {
      throw new ExternalDestinationError(cause.message, { cause });
    }
    const response = await fetchImpl(target.toString(), { headers, agent, redirect: "manual", signal, size: MAX_SOURCE_BYTES });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    response.body?.destroy?.();
    if (redirectCount === MAX_SAFE_REDIRECTS) {
      throw new ExternalDestinationError("External URL exceeded the redirect limit.");
    }

    try {
      currentUrl = new URL(location, target).toString();
    } catch (cause) {
      throw new ExternalDestinationError("Invalid external redirect.", { cause });
    }
  }

  throw new Error("External URL could not be fetched safely.");
}

/**
 * Metadata extractor via Cheerio
 */
function extractMeta($) {
  return {
    title: $("title").text() || $("h1").first().text() || "Untitled",
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "",
    author: $('meta[name="author"]').attr("content") || "Unknown",
  };
}

/** Extract one content region so nested main/article/body nodes are not duplicated. */
export function extractHtmlContent(html, { isReddit = false } = {}) {
  const $ = cheerio.load(html);
  const meta = extractMeta($);
  const pageHeading = $("h1").first().text().trim();
  $("script, style, iframe, noscript, header, footer, nav, aside, [role='navigation'], .ad, .ads, #header, #footer, .mw-editsection, .mw-portlet, .vector-header-container, .vector-page-toolbar, .vector-toc, .mw-jump-link").remove();

  const selectors = isReddit
    ? ["shreddit-post", ".post-content", "#content"]
    : [".mw-parser-output", "article", "main", "[role='main']"];
  let root = $("body");
  for (const selector of selectors) {
    const candidates = $(selector).toArray().filter(el => $(el).text().trim().length >= 50);
    if (candidates.length) {
      candidates.sort((a, b) => $(b).text().length - $(a).text().length);
      root = $(candidates[0]);
      break;
    }
  }
  const hasHeading = root.find("h1").length > 0;
  root.find("h1, h2, h3, h4, h5, h6").each((i, el) => {
    $(el).replaceWith(`\n\n${"#".repeat(Number(el.tagName.substring(1)))} ${$(el).text().trim()}\n\n`);
  });
  root.find("p").each((i, el) => {
    $(el).replaceWith(`\n\n${$(el).text().trim()}\n\n`);
  });
  root.find("li").each((i, el) => {
    $(el).replaceWith(`\n- ${$(el).text().trim()}`);
  });
  root.find("br").replaceWith("\n");
  let content = root.text().replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  if (!hasHeading && pageHeading) content = `# ${pageHeading}\n\n${content}`;
  return { content, title: meta.title, metadata: { ...meta, method: "cheerio-dynamic-porter" } };
}

/**
 * Phase 1: Cheerio. Fast, static HTML extraction.
 */
async function extractWithCheerio(url) {
  const { hostname } = new URL(url);
  const isReddit = hostname === "reddit.com" || hostname.endsWith(".reddit.com");

  // Use a stable identity and broadly compatible response formats.
  const headers = {
    "User-Agent": USER_AGENTS[0],
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  const response = await fetchPublicUrl(url, {
    headers,
    timeout: 15000,
  });

  if (!response.ok) {
    if (isReddit && response.status === 403) {
      throw new Error(
        "Reddit blocked standard extraction. Try Firecrawl fallback.",
      );
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const { content, title, metadata } = extractHtmlContent(html, { isReddit });

  // Only reject failure phrases in suspiciously short responses.
  const isLikelySystemError =
    content.length < 300 &&
    (content.toLowerCase().includes("access denied") ||
      content.toLowerCase().includes("pardon our interruption") ||
      content.toLowerCase().includes("bot detection") ||
      content.toLowerCase().includes("failed to fetch") ||
      content.toLowerCase().includes("403 forbidden"));

  if (isLikelySystemError)
    throw new Error(
      "Systemic extraction failure: Site blocked or denied access.",
    );
  if (content.length < 50) throw new Error("Insufficient content extracted.");

  return {
    content,
    title,
    metadata,
  };
}

/**
 * Phase 2 (ULTRA): Jina Reader. Handles JS/SPA rendering without an API key.
 */
async function extractWithJina(url) {
  const source = new URL(url);
  const jinaUrl = new URL("https://r.jina.ai/");
  jinaUrl.pathname = "/" + source.origin + source.pathname;
  jinaUrl.search = source.search;
  logger.info(
    `[Extraction] Attempting Jina Reader fallback for: ${new URL(url).hostname}`,
  );

  const response = await fetch(jinaUrl, {
    method: "GET",
    redirect: "error",
    headers: {
      Accept: "text/plain",
      "X-No-Cache": "true",
    },
    timeout: 30000, // Jina can take a moment to render
  });

  if (!response.ok) {
    throw new Error(`Jina Reader failed: ${response.status}`);
  }

  const markdown = await response.text();

  if (!markdown || markdown.length < 100) {
    throw new Error("Jina Reader returned insufficient content.");
  }

  // Jina returns "Title: ..." as the first line often
  const firstLine = markdown.split("\n")[0] || "";
  const titleMatch = firstLine.match(/^#?\s*(.+)$/);
  const title = titleMatch ? titleMatch[1].replace("Title: ", "").trim() : url;

  return {
    content: markdown,
    title: title,
    metadata: { method: "jina-reader-high-fidelity", author: "Jina AI" },
  };
}

/**
 * Phase 3: Direct Firecrawl API call.
 */
async function extractWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("Firecrawl API Key missing.");

  const response = await fetch("https://api.firecrawl.dev/v0/scrape", {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url }),
  });

  const json = await response.json();
  if (!json.success) throw new Error(json.error || "Firecrawl failed");

  return {
    content: json.data?.markdown || json.data?.content || "",
    title: json.data?.metadata?.title || url,
    metadata: { method: "firecrawl-api-v0" },
  };
}

function encodedGithubPath(path) {
  const segments = path.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".." || /[\\\x00-\x1f]/.test(segment))) {
    throw new Error("Invalid GitHub path.");
  }
  return segments.map(encodeURIComponent).join("/");
}

function githubApiUrl(owner, repo, branch) {
  const endpoint = new URL("https://api.github.com/");
  endpoint.pathname = `/repos/${owner}/${repo}`;
  if (branch !== undefined) {
    endpoint.pathname += "/git/trees/" + encodedGithubPath(branch);
    endpoint.searchParams.set("recursive", "1");
  }
  return endpoint;
}

/**
 * Deep recursive extraction for GitHub repositories
 */
async function extractGitHubRepo(url) {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2) {
    throw new Error("Invalid GitHub repository URL.");
  }
  const owner = pathParts[0];
  const repo = pathParts[1].replace(/\.git$/, "");

  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || repo === "." || repo === "..") {
    throw new Error("Invalid GitHub repository name.");
  }

  logger.info(`[GitHub Extractor] owner: ${owner}, repo: ${repo}`);

  let branch = "main";
  if (pathParts[2] === "tree" && pathParts[3]) {
    branch = pathParts.slice(3).map(decodeURIComponent).join("/");
  } else {
    try {
      const apiResponse = await fetch(
        githubApiUrl(owner, repo),
        {
          redirect: "error",
          headers: { "User-Agent": "StudyPodLM-Agent" },
          timeout: 5000,
        },
      );
      if (apiResponse.ok) {
        const repoData = await apiResponse.json();
        if (repoData.default_branch) {
          branch = repoData.default_branch;
        }
      }
    } catch (e) {
      logger.warn(
        `[GitHub Extractor] Failed to fetch default branch for ${owner}/${repo}: ${e.message}`,
      );
    }
  }

  logger.info(`[GitHub Extractor] Using branch: ${branch}`);

  let treeData;
  try {
    const treeResponse = await fetch(
      githubApiUrl(owner, repo, branch),
      {
        redirect: "error",
        headers: { "User-Agent": "StudyPodLM-Agent" },
        timeout: 10000,
      },
    );
    if (!treeResponse.ok) {
      if (branch === "main" && pathParts[2] !== "tree") {
        logger.info(
          `[GitHub Extractor] Failed with branch 'main', trying 'master'...`,
        );
        const altTreeResponse = await fetch(
          githubApiUrl(owner, repo, "master"),
          {
            redirect: "error",
            headers: { "User-Agent": "StudyPodLM-Agent" },
            timeout: 10000,
          },
        );
        if (altTreeResponse.ok) {
          branch = "master";
          treeData = await altTreeResponse.json();
        }
      }
      if (!treeData) {
        throw new Error(
          `Failed to fetch tree from GitHub API: status ${treeResponse.status}`,
        );
      }
    } else {
      treeData = await treeResponse.json();
    }
  } catch (e) {
    logger.warn(
      `[GitHub Extractor] API tree fetch failed: ${e.message}. Using fallback direct files.`,
    );
    treeData = {
      tree: [
        { path: "README.md", type: "blob" },
        { path: "package.json", type: "blob" },
      ],
    };
  }

  const excludedDirs = [
    "node_modules",
    "dist",
    "build",
    ".git",
    ".github",
    ".vercel",
    ".next",
    "bin",
    "obj",
    "out",
  ];
  const excludedFiles = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
  ];
  const allowedExtensions = [
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".json",
    ".md",
    ".txt",
    ".py",
    ".go",
    ".java",
    ".cpp",
    ".c",
    ".h",
    ".cs",
    ".rs",
    ".css",
    ".html",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
  ];

  const filesToFetch = [];
  if (treeData && treeData.tree) {
    for (const item of treeData.tree) {
      if (item.type !== "blob") continue;

      const pathLower = item.path.toLowerCase();
      if (excludedDirs.some((dir) => item.path.split("/").includes(dir)))
        continue;
      if (excludedFiles.some((file) => pathLower.endsWith(file))) continue;

      const ext = item.path.substring(item.path.lastIndexOf("."));
      if (
        !allowedExtensions.includes(ext.toLowerCase()) &&
        !pathLower.endsWith("readme")
      ) {
        continue;
      }

      if (item.size && item.size > 200000) {
        continue;
      }

      filesToFetch.push(item.path);
    }
  }

  filesToFetch.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower.includes("readme")) return -1;
    if (bLower.includes("readme")) return 1;
    if (aLower.includes("package.json")) return -1;
    if (bLower.includes("package.json")) return 1;
    if (aLower.startsWith("src/") && !bLower.startsWith("src/")) return -1;
    if (bLower.startsWith("src/") && !aLower.startsWith("src/")) return 1;
    return a.localeCompare(b);
  });

  const selectedFiles = filesToFetch.slice(0, 40);

  if (selectedFiles.length === 0) {
    throw new Error("No readable text files found in the repository.");
  }

  logger.info(
    `[GitHub Extractor] Fetching contents of ${selectedFiles.length} files...`,
  );

  let consolidatedContent = `# GitHub Repository: ${owner}/${repo}\n`;
  consolidatedContent += `Branch: ${branch}\n`;
  consolidatedContent += `Total Files Extracted: ${selectedFiles.length}\n\n`;

  const fetchPromises = selectedFiles.map(async (filePath) => {
    try {
      const rawUrl = new URL("https://raw.githubusercontent.com/");
      rawUrl.pathname = `/${owner}/${repo}/${encodedGithubPath(branch)}/${encodedGithubPath(filePath)}`;
      const fileRes = await fetch(rawUrl, { timeout: 8000, redirect: "error" });
      if (fileRes.ok) {
        const text = await fileRes.text();
        const extension = filePath.substring(filePath.lastIndexOf(".") + 1);
        let codeBlockType = extension;
        if (["ts", "tsx", "js", "jsx"].includes(extension))
          codeBlockType = "typescript";
        else if (extension === "md") codeBlockType = "markdown";

        return `\n## File: ${filePath}\n\n\`\`\`${codeBlockType}\n${text}\n\`\`\`\n`;
      } else {
        return `\n## File: ${filePath} (Failed to fetch, status: ${fileRes.status})\n`;
      }
    } catch (err) {
      return `\n## File: ${filePath} (Error: ${err.message})\n`;
    }
  });

  const fileContents = await Promise.all(fetchPromises);
  consolidatedContent += fileContents.join("\n");

  return {
    content: consolidatedContent,
    title: `${owner}/${repo}`,
    metadata: {
      method: "github-repo-extractor",
      author: owner,
      description: `Extracted repository: ${owner}/${repo} containing ${selectedFiles.length} files.`,
      branch,
    },
  };
}

export async function extractWebSource(url) {
  url = await assertSafeExternalHttpsUrl(url);
  const { hostname: logHost, pathname } = new URL(url);
  const route = pathname.split("/").filter(Boolean);
  const isGitHubRepo =
    (logHost === "github.com" || logHost === "www.github.com") &&
    (route.length === 2 || (route[2] === "tree" && route.length >= 4));
  if (isGitHubRepo) {
    logger.info(
      `[Extraction] GitHub repository detected on ${logHost}. Initiating deep extraction...`,
    );
    try {
      return await extractGitHubRepo(url);
    } catch (err) {
      logger.error(
        `[Extraction] GitHub deep extraction failed: ${err.message}. Falling back to standard extraction.`,
      );
    }
  }

  try {
    return await extractWithCheerio(url);
  } catch (err) {
    if (err instanceof ExternalDestinationError) throw err;
    logger.warn(
      `[Extraction] Cheerio failed for ${logHost}, trying Jina Reader...`,
    );
    try {
      return await extractWithJina(url);
    } catch (err2) {
      logger.warn(`[Extraction] Jina Reader failed, checking Firecrawl...`);
      try {
        return await extractWithFirecrawl(url);
      } catch (err3) {
        throw new Error("Extraction exhausted across all layers.");
      }
    }
  }
}

export default { extractWebSource };

