# StudyPod Agent Onboarding

For code changes in this repository, use Node.js 22 and follow the [local setup and verification steps](README.md#1-initialize-the-workspace). The frontend lives in `src/`, the Express API in `backend/src/`, and browser workflows in `e2e/`. See the [maintainer loop](docs/STUDYPOD_MAINTAINER_LOOP.md) and [quality workflow](.github/workflows/quality.yml) for feature-specific checks.

The following protocol applies to external agents and ChatGPT connectors.

---

## Prerequisites

> **A human user must authenticate first.** The 6-digit pairing code is generated from the StudyPodLM web UI by a logged-in human user. Agents cannot self-register without a human sponsor.

---

## 1. Pairing (Get Your API Key)

**Step 1 — Human generates pairing code:**
- Log into StudyPodLM web app
- Open **Profile Menu** → **Agent Pairing**
- Click **Generate Pairing Code** (6-digit PIN, expires in 5 minutes)

**Step 2 — Agent exchanges PIN for API key:**
```bash
node agent_demo_kit/pair_and_test.js <YOUR-6-DIGIT-PIN>
```
This checks identity and notebook access with a read-only key that expires in one hour. The script holds the key in memory. To reuse a one-hour key across local processes, run `node backend/scripts/kilo_pair.js <YOUR-6-DIGIT-PIN>` with a fresh code. For longer access, the account owner can generate a separate API key under **Profile → Agent Pairing**.

---

## 2. Authentication

Include your API key in all requests:

```
Authorization: Bearer spm_your_key_here
```

**Verify your identity:**
```bash
curl -H "Authorization: Bearer spm_your_key_here" \
  http://localhost:4000/api/auth/me
```
Returns: `{ id, displayName, account_type, email, createdAt }`

---

## 3. Core Capabilities

### Discover Notebooks
```
GET /api/notebooks
```

### Read Notebook Context (AI-optimized)
```
GET /api/notebooks/:id/context
```
Returns structured snapshot: notebook metadata, sources with content previews, all notes.

### Post Research Notes
```
POST /api/notebooks/:id/notes
Body: { "content": "Your insight here" }
```
Notes from agents are tagged with an **AGENT** badge and persisted to the notebook's hybrid semantic and lexical memory store.

### Upload Files
```
POST /api/agent/upload
Content-Type: multipart/form-data
```
Raw files (PDFs, images) are queued for local encryption when the human opens the notebook.

### Chat with Notebook
```
POST /api/notebooks/:id/chat
Body: { "message": "What are the key themes?", "saveAsNote": true }
```

### Search Memories
```
POST /api/notebooks/:id/memory/search
Body: { "query": "machine learning trends" }
```

### Agent API Keys
Agents authenticate with scoped StudyPodLM API keys generated from pairing codes or Developer Settings.
```
Authorization: Bearer spm_your_key_here
```
Provider BYOK storage has been removed. Agents should use their own runtime-side model credentials if they need external reasoning, then send results back to StudyPodLM through the scoped API.

### Social Media Signal Queue (Drafting & Posting)
Agents can poll the Signal Queue to find posts that are approved by the human and ready to be automatically published, or agents can draft new posts to the queue.

#### Poll Approved Posts
```
GET /api/signal-queue?status=approved
```
Returns a list of approved signal items ready to post.

#### Mark Post as Posted
```
PUT /api/signal-queue/:id
Body: { "status": "posted", "posted_at": "2026-06-01T09:00:00Z" }
```

#### Queue a New Post (Draft)
```
POST /api/signal-queue
Body: { 
  "notebookId": "notebook-uuid", 
  "platform": "twitter", 
  "content": "Self-hosted agents can now orchestrate across notebooks. #StudyPod",
  "scheduledFor": "2026-06-01T12:00:00Z" 
}
```
Valid platforms: `linkedin`, `twitter`, `reddit`, `threads`.

---

## 4. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Expired or missing API key | Re-pair with a fresh 6-digit code |
| `404 Notebook not found` | Wrong notebook ID or no access | Call `GET /api/notebooks` to list accessible notebooks |
| `CORS error` | Frontend origin not allowed | Set `CORS_ORIGIN` env var on server |
| Pairing code rejected | Code expired (>5 min) | Generate a new code from the UI |

### Manual Human Auth (for testing)
If you need a human JWT for the pairing flow outside the UI:
```bash
curl -X POST http://localhost:4000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"displayName":"testuser","passphrase":"your_passphrase"}'
```

---

## 5. Starter Kit

| Script | Purpose |
|--------|---------|
| `backend/scripts/kilo_pair.js` | Official pairing utility |
| `backend/scripts/syncAgent.js` | Base template for autonomous research bots |
| `agent_demo_kit/pair_and_test.js` | Pair with a one-hour in-memory key, verify identity, and count accessible notebooks |

Run `node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN>` for a pairing check without notebook changes. Add `--write-note <NOTEBOOK-ID>` to create a test note in a specific notebook. Both pairing scripts accept `STUDYPOD_API` to override the local API base URL.

---

## 6. ChatGPT connector

StudyPod exposes an authenticated Streamable HTTP MCP endpoint at `/mcp`. Connect it from Settings → AI & Connections. Authorization uses OAuth discovery, dynamic client registration, PKCE, short-lived access credentials, rotating refresh credentials, and explicit user consent.

The connector can list notebooks, inspect notebook context, search and read sources, create notes, and create or run grounded agent missions. Every tool enforces the granted scope and notebook ownership. Consumer ChatGPT subscriptions and OpenAI API billing remain separate; the connector lets ChatGPT use its own model capabilities while operating on StudyPod data.
