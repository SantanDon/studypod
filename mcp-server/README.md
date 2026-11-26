# StudyPodLM MCP Server

Exposes StudyPod notebooks to local CLI agents over MCP stdio. For ChatGPT, use StudyPod's authenticated remote connector at `https://studypod-lm.vercel.app/mcp` instead.

## Quick Setup

### 1. Install dependencies

```bash
cd mcp-server
npm ci
```

### 2. Choose your StudyPod workspace

Local development uses `http://localhost:4000` by default. To connect a hosted workspace, copy `.env.example` to `.env` in this directory and set `STUDYPODLM_API_URL` to the workspace's HTTPS origin. Leave `STUDYPODLM_API_KEY` blank for one-hour pairing.

### 3. Connect a desktop client

**For Kilo** — add to your Kilo MCP config (usually `~/.kilo/mcp_servers.json` or via Kilo settings):

```json
{
  "mcpServers": {
    "studypodlm": {
      "command": "node",
      "args": ["C:/path/to/studypod/mcp-server/index.js"]
    }
  }
}
```

**For Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "studypodlm": {
      "command": "node",
      "args": ["C:/path/to/studylm/mcp-server/index.js"]
    }
  }
}
```

## Natural Language Examples

Once connected, just say:

| What you type                                          | What the agent does       |
| ------------------------------------------------------ | ------------------------- |
| _"What notebooks do I have?"_                          | Calls `list_notebooks`    |
| _"Show sources in my LLM notebook"_                    | Calls `list_sources`      |
| _"Add a note about backpropagation to my ML notebook"_ | Calls `create_note`       |
| _"What notes do I have in my Biology notebook?"_       | Calls `list_notes`        |
| _"Create a new notebook called Quantum Computing"_     | Calls `create_notebook`   |
| _"Show chat history in notebook XYZ"_                  | Calls `list_chat_history` |

## Available Tools

| What you want to do | Tools |
| --- | --- |
| Connect and confirm the account | `pair`, `whoami` |
| Find or create a notebook | `list_notebooks`, `get_notebook`, `create_notebook` |
| Inspect a notebook and its sources | `notebook_context`, `list_sources` |
| Ask about sources or read past questions | `chat`, `list_chat_history` |
| Search notebook memory | `memory_search` |
| Import study material | `add_source_from_text`, `add_source_from_url`, `add_source_from_arxiv`, `add_source_from_github` |
| Read or edit notes | `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note` |

## First notebook question

1. Sign in to that StudyPod workspace, open **Profile → Agent Pairing**, and select **Generate Pairing Code**. In your MCP client, call `pair` with the six-digit code and then call `whoami` to confirm the account. Pair again after an hour or a connector restart.
2. Call `list_notebooks`, choose a notebook ID, then call `notebook_context` to see its sources.
3. Call `chat` with the notebook ID and a question about those sources. Use the returned citations when explaining the answer.

To let an agent read sources from just one notebook, copy its ID from the notebook URL and pass it when pairing. For example, use `{"code":"123456","notebook_ids":["your-notebook-id"],"scopes":["notebooks:read","sources:read"]}` with your own code and ID. Include `chat:all` if the agent needs to ask questions.

The connector also exposes `update_note`, `memory_search`, and source imports from text, a URL, GitHub, or arXiv. Use your MCP client's tool list for their current arguments.
