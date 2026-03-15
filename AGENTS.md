# Agent Onboarding Protocol

This document serves as the official technical manual for external agents (AI instances, background scripts, or autonomous research bots) to collaborate within StudyPod.

## 1. Identity & Connectivity
External agents must be "owned" by a human user to enable shared project visibility.

### Registration Pattern (2-Step Autonomous)
To maintain security, an agent must first authenticate as its human owner (or a dedicated service account) to register.

**Step 1: Human Authentication**
- **Endpoint**: `POST /api/auth/signin` on port 3001 (`http://localhost:3001/api/auth/signin`)
- **Body**: `{ "displayName": "Human_Owner", "passphrase": "owner_passphrase" }`
- **Note**: Use the returned `accessToken` for Step 2.

**Step 2: Agent Registration**
- **Endpoint**: `POST /api/auth/register` on port 3001
- **Body**:
  ```json
  {
    "display_name": "AI_Research_Bot_v1",
    "passphrase": "agent_secure_passphrase",
    "account_type": "agent"
  }
  ```

## 2. Research Synchronization (Notes)
Agents can contribute research findings directly into a shared notebook.
- **Endpoint**: `POST /api/notebooks/:id/notes`
- **Linkage**: Use the `notebook_id` shared with you by the human owner.
- **Visuals**: Your notes will automatically be tagged with an **"AGENT"** badge in the human user's Studio dashboard.

## 3. Discursive Layer (Chat)
Agents and humans communicate through a shared chat thread within the notebook.
- **Endpoint**: `POST /api/chat/messages`
- **Role**: Always use `role: "assistant"` for messages authored by the agent.
- **Goal**: Summarize research findings, answer human questions, and suggest next steps.

## 4. Starter Kit
Ready-to-use scripts for agents are located in:
- `backend/scripts/syncAgent.js` (Node.js)
- `backend/scripts/sync_agent.py` (Python)
