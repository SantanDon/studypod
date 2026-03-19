# StudyPodLM MCP Server

Exposes your StudyPodLM notebooks as tools for CLI agents (Kilo, Claude Code, etc.) so you can interact via **natural language** instead of raw API calls.

## Quick Setup

### 1. Install dependencies
```bash
cd mcp-server
npm install
```

### 2. Configure your token
```bash
cp .env.example .env
```

Open `.env` and set:
- `STUDYPODLM_API_URL` — your backend URL (`http://localhost:3001` for local, or your Vercel URL)
- `STUDYPODLM_TOKEN` — your JWT. Get it from the browser after logging in:
  ```js
  // Open devtools console on studypod-lm.vercel.app
  localStorage.getItem('auth_token')
  ```

### 3. Add to Kilo (or Claude Code)

**For Kilo** — add to your Kilo MCP config (usually `~/.kilo/mcp_servers.json` or via Kilo settings):
```json
{
  "mcpServers": {
    "studypodlm": {
      "command": "node",
      "args": ["C:/Users/Don Santos/Dropbox/PC/Desktop/DocketDive/studylm/mcp-server/index.js"]
    }
  }
}
```

**For Claude Code** — add to `claude_desktop_config.json`:
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

| What you type | What the agent does |
|---|---|
| *"What notebooks do I have?"* | Calls `list_notebooks` |
| *"Show sources in my LLM notebook"* | Calls `list_sources` |
| *"Add a note about backpropagation to my ML notebook"* | Calls `create_note` |
| *"What notes do I have in my Biology notebook?"* | Calls `list_notes` |
| *"Create a new notebook called Quantum Computing"* | Calls `create_notebook` |
| *"Show chat history in notebook XYZ"* | Calls `list_chat_history` |

## Available Tools

| Tool | Description |
|---|---|
| `list_notebooks` | List all notebooks |
| `get_notebook` | Get notebook details by ID |
| `list_sources` | List sources in a notebook |
| `list_notes` | List notes in a notebook |
| `create_note` | Create a new note |
| `get_note` | Read a specific note |
| `delete_note` | Delete a note |
| `list_chat_history` | Get chat messages |
| `create_notebook` | Create a new notebook |
