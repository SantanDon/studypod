#!/usr/bin/env node
/**
 * StudyPodLM MCP Server
 * Natural language access to notebooks, sources, notes, and chat.
 *
 * This local stdio bridge accepts a revocable StudyPod agent key through
 * STUDYPODLM_API_KEY. It never asks an agent for the user's password.
 */

import { readArxivMetadata } from "./arxiv.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env
const __dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dir, ".env") });

const API_URL = process.env.STUDYPODLM_API_URL || "http://localhost:4000";

let sessionToken = process.env.STUDYPODLM_API_KEY || "";

// ─── helpers ────────────────────────────────────────────────────────────────

async function api(path, { method = "GET", body, token } = {}) {
  const tok = token || sessionToken;
  if (!tok) {
    throw new Error("Connect StudyPod using the pair tool or configure STUDYPODLM_API_KEY.");
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tok}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) throw new Error(`StudyPod returned HTTP ${res.status}.`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function text(obj) {
  return [{ type: "text", text: JSON.stringify(obj, null, 2) }];
}

// ─── tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "whoami",
    description: "Show who is currently logged in.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_notebooks",
    description:
      'List all notebooks. Use when asked: "what notebooks do I have?", "show my notebooks".',
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_notebook",
    description: "Get details about a specific notebook.",
    inputSchema: {
      type: "object",
      properties: { notebook_id: { type: "string" } },
      required: ["notebook_id"],
    },
  },
  {
    name: "create_notebook",
    description: "Create a new notebook.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_sources",
    description: "List all sources in a notebook.",
    inputSchema: {
      type: "object",
      properties: { notebook_id: { type: "string" } },
      required: ["notebook_id"],
    },
  },
  {
    name: "list_notes",
    description: "List all notes in a notebook.",
    inputSchema: {
      type: "object",
      properties: { notebook_id: { type: "string" } },
      required: ["notebook_id"],
    },
  },
  {
    name: "get_note",
    description: "Read the full content of a specific note.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_id: { type: "string" },
        note_id: { type: "string" },
      },
      required: ["notebook_id", "note_id"],
    },
  },
  {
    name: "create_note",
    description: "Create a new note in a notebook.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_id: { type: "string" },
        content: { type: "string", description: "Markdown content" },
      },
      required: ["notebook_id", "content"],
    },
  },
  {
    name: "update_note",
    description: "Update the content of an existing note.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_id: { type: "string" },
        note_id: { type: "string" },
        content: { type: "string" },
      },
      required: ["notebook_id", "note_id", "content"],
    },
  },
  {
    name: "delete_note",
    description: "Delete a note.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_id: { type: "string" },
        note_id: { type: "string" },
      },
      required: ["notebook_id", "note_id"],
    },
  },
  {
    name: "list_chat_history",
    description: "Get chat history for a notebook.",
    inputSchema: {
      type: "object",
      properties: { notebook_id: { type: "string" } },
      required: ["notebook_id"],
    },
  },
  {
    name: "pair",
    description:
      "Authorize this agent using a 6-digit pairing code from the StudyPod UI. Keeps a one-hour key in this running connector.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The 6-digit numeric PIN" },
        label: { type: "string", description: "Friendly name for this agent" },
        notebook_ids: {
          type: "array", maxItems: 50, items: { type: "string" },
          description: "Limit this session to the listed notebook IDs. Omit for all owned notebooks.",
        },
        scopes: {
          type: "array", items: { type: "string" },
          description: "Limit permissions, for example notebooks:read and sources:read. Omit for the standard agent permissions.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "notebook_context",
    description:
      "Get the full AI-optimized context for a notebook (sources, notes, metadata). Agents should call this when first loading a notebook.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_id: { type: "string" },
      },
      required: ["notebook_id"],
    },
  },
  {
    name: "chat",
    description:
      "Send a message to the notebook AI and get a grounded response based on notebook sources.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_id: { type: "string" },
        message: { type: "string", description: "Your question or message" },
        save_as_note: {
          type: "boolean",
          description: "Save the Q&A as a persistent note (default: false)",
        },
      },
      required: ["notebook_id", "message"],
    },
  },
  {
    name: "memory_search",
    description:
      "Search the notebook memory using semantic similarity. Finds relevant context from past research.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_id: { type: "string" },
        query: { type: "string", description: "The search query" },
        limit: { type: "number", description: "Max results (default: 5)" },
      },
      required: ["notebook_id", "query"],
    },
  },
  {
    name: "add_source_from_url",
    description:
      "Fetch a URL via the StudyPodLM web extractor and add it as a source to a notebook. Returns { sourceId, success } or { error }.",
    inputSchema: {
      type: "object",
      properties: {
        notebookId: {
          type: "string",
          description: "The notebook ID to add the source to",
        },
        url: { type: "string", description: "The URL to extract content from" },
        title: {
          type: "string",
          description:
            "Optional title; derived from the URL hostname if omitted",
        },
      },
      required: ["notebookId", "url"],
    },
  },
  {
    name: "add_source_from_arxiv",
    description:
      "Fetch an arXiv paper abstract page, extract title + abstract, and add it as a source to a notebook. Returns { sourceId, success } or { error }.",
    inputSchema: {
      type: "object",
      properties: {
        notebookId: {
          type: "string",
          description: "The notebook ID to add the source to",
        },
        arxivId: {
          type: "string",
          description: "The arXiv paper ID (e.g. 2401.12345 or 2401.12345v1)",
        },
      },
      required: ["notebookId", "arxivId"],
    },
  },
  {
    name: "add_source_from_github",
    description:
      "Fetch a GitHub repo README (main branch, falls back to master) and add it as a source to a notebook. Returns { sourceId, success } or { error }.",
    inputSchema: {
      type: "object",
      properties: {
        notebookId: {
          type: "string",
          description: "The notebook ID to add the source to",
        },
        repoUrl: {
          type: "string",
          description:
            "The GitHub repository URL (e.g. https://github.com/owner/repo)",
        },
      },
      required: ["notebookId", "repoUrl"],
    },
  },
  {
    name: "add_source_from_text",
    description:
      "Add a source to a notebook from raw text content. Use when the agent already has the content. Returns { sourceId, success } or { error }.",
    inputSchema: {
      type: "object",
      properties: {
        notebookId: {
          type: "string",
          description: "The notebook ID to add the source to",
        },
        title: { type: "string", description: "Title for the source" },
        content: {
          type: "string",
          description: "The full text content of the source",
        },
        type: { type: "string", description: 'Source type (default: "text")' },
      },
      required: ["notebookId", "title", "content"],
    },
  },
];

// ─── server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "studypodlm", version: "2.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

async function handleToolCall({ params: { name, arguments: args } }) {
  try {
    switch (name) {
      case "whoami":
        return { content: text(await api("/api/auth/me")) };
      case "list_notebooks":
        return { content: text(await api("/api/notebooks")) };

      case "get_notebook":
        return {
          content: text(await api(`/api/notebooks/${args.notebook_id}`)),
        };

      case "create_notebook":
        return {
          content: text(
            await api("/api/notebooks", {
              method: "POST",
              body: { title: args.title, description: args.description },
            }),
          ),
        };

      case "list_sources":
        return {
          content: text(
            await api(`/api/notebooks/${args.notebook_id}/sources`),
          ),
        };

      case "list_notes":
        return {
          content: text(await api(`/api/notebooks/${args.notebook_id}/notes`)),
        };

      case "get_note":
        return {
          content: text(
            await api(
              `/api/notebooks/${args.notebook_id}/notes/${args.note_id}`,
            ),
          ),
        };

      case "create_note":
        return {
          content: text(
            await api(`/api/notebooks/${args.notebook_id}/notes`, {
              method: "POST",
              body: { content: args.content },
            }),
          ),
        };

      case "update_note":
        return {
          content: text(
            await api(
              `/api/notebooks/${args.notebook_id}/notes/${args.note_id}`,
              { method: "PUT", body: { content: args.content } },
            ),
          ),
        };

      case "delete_note":
        return {
          content: text(
            await api(
              `/api/notebooks/${args.notebook_id}/notes/${args.note_id}`,
              { method: "DELETE" },
            ),
          ),
        };

      case "list_chat_history":
        return {
          content: text(
            await api(`/api/notebooks/${args.notebook_id}/messages`),
          ),
        };

      case "pair": {
        const res = await fetch(`${API_URL}/api/auth/pair/complete`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: args.code,
            label: args.label || "MCP Agent",
            expiresInHours: 1,
            notebookIds: args.notebook_ids,
            scopes: args.scopes,
          }),
        });
        const data = await res.json();
        if (res.ok && typeof data.key === "string" && data.key.startsWith("spm_")) {
          sessionToken = data.key;
          return {
            content: text({
              success: true,
              expiresAt: data.expiresAt,
              message:
                "Paired for this connector session. Use whoami to confirm your account.",
            }),
          };
        }
        return { isError: true, content: text({ error: `Pairing failed (HTTP ${res.status}). Request a fresh code in StudyPod and try again.` }) };
      }

      case "notebook_context":
        return {
          content: text(
            await api(`/api/notebooks/${args.notebook_id}/context`),
          ),
        };

      case "chat": {
        const res = await api(`/api/notebooks/${args.notebook_id}/chat`, {
          method: "POST",
          body: {
            message: args.message,
            saveAsNote: args.save_as_note || false,
          },
        });
        return { content: text(res) };
      }

      case "memory_search": {
        const res = await api(
          `/api/notebooks/${args.notebook_id}/memory/search`,
          {
            method: "POST",
            body: { query: args.query, limit: args.limit || 5 },
          },
        );
        return { content: text(res) };
      }

      case "add_source_from_url": {
        const extract = await api(
          `/api/proxy/extract-web?url=${encodeURIComponent(args.url)}`,
        );
        if (extract.error) return { isError: true, content: text({ error: extract.error }) };
        if (!extract.content)
          return {
            isError: true,
            content: text({ error: "Web extraction returned no content" }),
          };
        let title = args.title || extract.title;
        if (!title) {
          try {
            title = new URL(args.url).hostname;
          } catch {
            title = args.url;
          }
        }
        const res = await api(`/api/notebooks/${args.notebookId}/sources`, {
          method: "POST",
          body: {
            title,
            type: "website",
            content: extract.content,
            url: args.url,
            metadata: {
              description: extract.description,
              ...(extract.metadata || {}),
            },
          },
        });
        if (res.id)
          return { content: text({ sourceId: res.id, success: true }) };
        return { isError: true, content: text({ error: res.error || res }) };
      }

      case "add_source_from_arxiv": {
        const absUrl = `https://arxiv.org/abs/${args.arxivId}`;
        let pageRes;
        try {
          pageRes = await fetch(absUrl, {
            signal: AbortSignal.timeout(15_000),
            headers: { "User-Agent": "StudyPodLM-MCP/2.0 (research agent)" },
          });
        } catch (e) {
          return {
            isError: true,
            content: text({
              error: `Failed to fetch arXiv page: ${e.message}`,
            }),
          };
        }
        if (!pageRes.ok)
          return {
            isError: true,
            content: text({
              error: `arXiv returned status ${pageRes.status} for ${absUrl}`,
            }),
          };
        const html = await pageRes.text();
        const { title, abstract } = readArxivMetadata(html, args.arxivId);
        const content = abstract
          ? `# ${title}\n\nSource: ${absUrl}\n\n## Abstract\n\n${abstract}`
          : `# ${title}\n\nSource: ${absUrl}`;
        const res = await api(`/api/notebooks/${args.notebookId}/sources`, {
          method: "POST",
          body: {
            title,
            type: "website",
            content,
            url: absUrl,
            metadata: { arxivId: args.arxivId, source: "arxiv" },
          },
        });
        if (res.id)
          return { content: text({ sourceId: res.id, success: true }) };
        return { isError: true, content: text({ error: res.error || res }) };
      }

      case "add_source_from_github": {
        let owner, repo;
        try {
          const u = new URL(args.repoUrl);
          if (
            u.protocol !== "https:" ||
            !["github.com", "www.github.com"].includes(u.hostname)
          ) {
            return {
              isError: true,
              content: text({ error: "URL is not a github.com repository" }),
            };
          }
          const parts = u.pathname.split("/").filter(Boolean);
          owner = parts[0];
          repo = parts[1];
        } catch {
          return { isError: true, content: text({ error: "Invalid GitHub repo URL" }) };
        }
        if (!owner || !repo)
          return {
            isError: true,
            content: text({ error: "Could not parse owner/repo from URL" }),
          };
        repo = repo.replace(/\.git$/, "");
        let readme = null;
        let usedBranch = null;
        for (const branch of ["main", "master"]) {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
          try {
            const r = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
            if (r.ok) {
              readme = await r.text();
              usedBranch = branch;
              break;
            }
          } catch {
            // try next branch
          }
        }
        if (!readme)
          return {
            isError: true,
            content: text({
              error: `README.md not found on main or master branch for ${owner}/${repo}`,
            }),
          };
        const title = `${owner}/${repo}`;
        const res = await api(`/api/notebooks/${args.notebookId}/sources`, {
          method: "POST",
          body: {
            title,
            type: "website",
            content: readme,
            url: args.repoUrl,
            metadata: {
              owner,
              repo,
              branch: usedBranch,
              source: "github-readme",
            },
          },
        });
        if (res.id)
          return { content: text({ sourceId: res.id, success: true }) };
        return { isError: true, content: text({ error: res.error || res }) };
      }

      case "add_source_from_text": {
        const res = await api(`/api/notebooks/${args.notebookId}/sources`, {
          method: "POST",
          body: {
            title: args.title,
            type: args.type || "text",
            content: args.content,
          },
        });
        if (res.id)
          return { content: text({ sourceId: res.id, success: true }) };
        return { isError: true, content: text({ error: res.error || res }) };
      }

      default:
        return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: `Tool execution failed: ${err.message}` },
            null,
            2,
          ),
        },
      ],
    };
  }
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  return handleToolCall(req);
});

const transport = new StdioServerTransport();
await server.connect(transport);
