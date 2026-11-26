# StudyPodLM Headless API Guide

This guide provides information on how to integrate autonomous agents and external tools with StudyPodLM.

## Authentication

StudyPodLM uses two types of authentication for headless access:

### 1. Temporary Session Tokens (JWT)
Found in the "Manual Integration" section of Developer Tools.
- **Prefix:** `Bearer `
- **Duration:** 1 hour
- **Use Case:** Quick testing or one-off tasks.

### 2. Persistent Agent Keys
Generated via the **Agent Pairing Wizard**.
- **Prefix:** `spm_`
- **Duration:** Can be time-limited when issued and revoked in Developer Settings.
- **Use Case:** Long-running agents, IDE extensions, or scheduled tasks.

## Connecting an Agent via Pairing

1. Open **Profile Menu** -> **Agent Pairing**.
2. Click **Generate Pairing Code**.
3. In your agent's terminal, run:
   ```bash
   node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN>
   ```
4. The demo uses a one-hour key in memory, verifies identity, and reports the number of accessible notebooks. To create a sample note in a specific test notebook, pass `--write-note <NOTEBOOK-ID>`. The default demo makes no notebook changes.

For an integration that needs to retain a key across runs, generate a new PIN and run `node backend/scripts/kilo_pair.js <6-DIGIT-PIN>`. The pairing utility saves the key to the local `.env.agent` file.

To pair directly, send `POST /api/auth/pair/complete` with `Content-Type: application/json` and a fresh code. This example requests read access for one hour.

```json
{"code":"123456","scopes":["notebooks:read"],"expiresInHours":1}
```

A successful response returns HTTP `201`. Selected fields are shown below. Use the returned `key` as the bearer credential and keep it private.

```json
{"key":"spm_<redacted>","scopes":["notebooks:read"],"expiresAt":"2026-11-26T12:00:00.000Z"}
```

An unknown or consumed code returns HTTP `401` with `{"error":"Invalid or expired pairing code"}`. Generate a fresh code from the web app before retrying.

## API Endpoints for Agents

### Listing Notebooks

Send `GET /api/notebooks` with `Authorization: Bearer spm_your_agent_key`. A key with `notebooks:read` receives HTTP `200` and an array of accessible notebooks. Use each notebook's `id` in later requests. An empty array means the key has no accessible notebooks.

```json
[{"id":"notebook-id","title":"Study notes"}]
```

The example shows selected fields. A key missing the read scope receives HTTP `403` with an error and its current scopes.

```json
{"error":"API key lacks required scope: notebooks:read","keyScopes":["notes:create"]}
```

### Uploading to Dropbox
Agents can push files to a specific "Dropbox" route without needing your encryption passphrase. These files are queued and will be encrypted locally the next time you open the corresponding notebook.

`POST /api/agent/upload`
- **Headers:** `Authorization: Bearer spm_your_agent_key`
- **Body:** Multipart/form-data containing the file and `notebookId`.

### Checking for Commands
Agents can poll for user-assigned tasks or study goals.

`GET /api/agent/missions`
- **Headers:** `Authorization: Bearer spm_your_agent_key`

### Reading Notebook Context
Agents can load a compact context snapshot before deciding what to do.

`GET /api/notebooks/:id/context`
- **Headers:** `Authorization: Bearer spm_your_agent_key`

### Posting Notes
Agents can contribute findings directly to a notebook when their key has `notes:create`.

`POST /api/notebooks/:id/notes`
- **Headers:** `Authorization: Bearer spm_your_agent_key`
- **Body:** `{ "content": "Your note" }`
