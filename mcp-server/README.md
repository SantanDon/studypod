# StudyPodLM MCP Server

Exposes StudyPod notebooks to local CLI agents over MCP stdio. For ChatGPT, use StudyPod's authenticated remote connector at `https://studypod-lm.vercel.app/mcp` instead.

## Quick Setup

### 1. Install dependencies

```bash
cd mcp-server
npm ci
```

### 2. Configure a revocable agent key

```bash
cp .env.example .env
```

Open `.env` and set:

- `STUDYPODLM_API_URL` — `http://localhost:4000` locally or your deployed StudyPod URL.
- `STUDYPODLM_API_KEY` — a revocable StudyPod agent key created from the signed-in StudyPod account.

Never paste a StudyPod password, browser session credential, or ChatGPT credential into an agent conversation.

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

| Tool                | Description                |
| ------------------- | -------------------------- |
| `list_notebooks`    | List all notebooks         |
| `get_notebook`      | Get notebook details by ID |
| `list_sources`      | List sources in a notebook |
| `list_notes`        | List notes in a notebook   |
| `create_note`       | Create a new note          |
| `get_note`          | Read a specific note       |
| `delete_note`       | Delete a note              |
| `list_chat_history` | Get chat messages          |
| `create_notebook`   | Create a new notebook      |


## First notebook question

1. Call `whoami` to confirm your account. Alternatively, open **Agent Pairing** in StudyPod, generate a code, and call `pair`. The connector holds the resulting one-hour key in memory.
2. Call `list_notebooks`, choose a notebook ID, then call `notebook_context` to see its sources.
3. Call `chat` with the notebook ID and a question about those sources. Use the returned citations when explaining the answer.

The connector also exposes `update_note`, `memory_search`, and source imports from text, a URL, GitHub, or arXiv. Use your MCP client's tool list for their current arguments.
