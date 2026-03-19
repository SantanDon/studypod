#!/usr/bin/env node
/**
 * StudyPodLM MCP Server
 * Gives CLI agents (Kilo, Claude Code, etc.) natural language access to notebooks,
 * sources, notes, and chat in StudyPodLM.
 *
 * Setup:
 *   1. cp .env.example .env  (fill in your token)
 *   2. npm install
 *   3. Add to your agent's MCP config (see README)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from the mcp-server directory
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(join(__dir, '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    process.env[key.trim()] = rest.join('=').trim();
  }
} catch (_) {
  // .env not required if env vars are already set
}

const API_URL = process.env.STUDYPODLM_API_URL || 'http://localhost:3001';
const TOKEN   = process.env.STUDYPODLM_TOKEN || '';

// ─── helpers ────────────────────────────────────────────────────────────────

async function api(path, { method = 'GET', body } = {}) {
  if (!TOKEN) {
    return { error: 'STUDYPODLM_TOKEN is not set. Add it to mcp-server/.env' };
  }
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch (err) {
    return { error: err.message };
  }
}

function text(obj) {
  return [{ type: 'text', text: JSON.stringify(obj, null, 2) }];
}

// ─── tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_notebooks',
    description: 'List all notebooks in the user\'s account. Use when asked: "what notebooks do I have?", "show my notebooks", "list notebooks".',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_notebook',
    description: 'Get details about a specific notebook by its ID or title. Use when asked about a specific notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string', description: 'The notebook UUID' }
      },
      required: ['notebook_id']
    }
  },
  {
    name: 'list_sources',
    description: 'List all sources (PDFs, URLs, text files) in a notebook. Use when asked: "what sources are in X?", "show files in notebook X".',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string', description: 'The notebook UUID' }
      },
      required: ['notebook_id']
    }
  },
  {
    name: 'list_notes',
    description: 'List all saved notes in a notebook. Use when asked: "show notes in X", "what notes do I have in X?".',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string', description: 'The notebook UUID' }
      },
      required: ['notebook_id']
    }
  },
  {
    name: 'create_note',
    description: 'Create a new note in a notebook. Use when asked: "add a note to X about Y", "save this as a note in X", "write a note in X".',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string', description: 'The notebook UUID' },
        title:       { type: 'string', description: 'Title of the note' },
        content:     { type: 'string', description: 'Markdown content of the note' }
      },
      required: ['notebook_id', 'title', 'content']
    }
  },
  {
    name: 'get_note',
    description: 'Read the full content of a specific note.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string', description: 'The notebook UUID' },
        note_id:     { type: 'string', description: 'The note UUID' }
      },
      required: ['notebook_id', 'note_id']
    }
  },
  {
    name: 'delete_note',
    description: 'Delete a note from a notebook. Use when explicitly asked to delete or remove a note.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string', description: 'The notebook UUID' },
        note_id:     { type: 'string', description: 'The note UUID' }
      },
      required: ['notebook_id', 'note_id']
    }
  },
  {
    name: 'list_chat_history',
    description: 'Get the chat history for a notebook. Use when asked: "show chat in X", "what did we discuss in X?".',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string', description: 'The notebook UUID' }
      },
      required: ['notebook_id']
    }
  },
  {
    name: 'create_notebook',
    description: 'Create a new notebook. Use when asked: "create a new notebook called X", "make a notebook for Y".',
    inputSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Name for the new notebook' },
        description: { type: 'string', description: 'Optional description' }
      },
      required: ['title']
    }
  }
];

// ─── MCP server setup ────────────────────────────────────────────────────────

const server = new Server(
  { name: 'studypodlm', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case 'list_notebooks':
      return { content: text(await api('/api/notebooks')) };

    case 'get_notebook':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}`)) };

    case 'list_sources':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/sources`)) };

    case 'list_notes':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/notes`)) };

    case 'create_note':
      return {
        content: text(
          await api(`/api/notebooks/${args.notebook_id}/notes`, {
            method: 'POST',
            body: { title: args.title, content: args.content }
          })
        )
      };

    case 'get_note':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/notes/${args.note_id}`)) };

    case 'delete_note':
      return {
        content: text(
          await api(`/api/notebooks/${args.notebook_id}/notes/${args.note_id}`, { method: 'DELETE' })
        )
      };

    case 'list_chat_history':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/messages`)) };

    case 'create_notebook':
      return {
        content: text(
          await api('/api/notebooks', {
            method: 'POST',
            body: { title: args.title, description: args.description || '' }
          })
        )
      };

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
});

// ─── start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
