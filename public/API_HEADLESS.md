# StudyPodLM Headless API Guide

This guide provides information on how to integrate autonomous agents and external tools with StudyPodLM.

## Authentication

For a short session, choose **Generate Pairing Code** in **Profile > Agent Pairing**. Your connected agent exchanges the six-digit code for an agent key. The MCP connector and demo below request a one-hour key and keep it in memory.

For a connector that needs to reconnect after a restart, **Generate New API Key** displays a key once. Store it in the connector's private settings. Use the `Authorization: Bearer` header for API requests.

## Connecting an Agent via Pairing

1. Open **Profile Menu** -> **Agent Pairing**.
2. Click **Generate Pairing Code**.
3. From the StudyPod repository, run the command below. It connects to the local server by default. For a hosted workspace, first set `STUDYPOD_API` to that workspace's HTTPS URL followed by `/api`.
   ```bash
   node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN>
   ```
4. The demo uses a one-hour key in memory, verifies identity, and reports the number of accessible notebooks. To create a sample note in a specific test notebook, pass `--write-note <NOTEBOOK-ID>`. The default demo makes no notebook changes.

For multiple runs within an hour, `node backend/scripts/kilo_pair.js <6-DIGIT-PIN>` saves the paired key in the local `.env.agent` file. For longer access, the account owner can generate a separate API key under **Profile → Agent Pairing**.

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
Agent Dropbox queues the original file on the server. When the owner opens the notebook, the browser downloads the file, runs the normal notebook import, and requests deletion of the queued copy. The agent does not need the owner's passphrase.

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
