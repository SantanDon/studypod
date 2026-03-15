# Agent Demo Kit for StudyPodLM

This kit contains scripts to help external CLI agents integrate with StudyPodLM.

## Prerequisites
- StudyPodLM backend must be running.
- A human user must already be registered to act as the "Owner".

## Scripts

### 1. `register_agent.sh` (Bash)
Used by a human to register a new agent into the system.
```bash
# Example for Live Version:
./register_agent.sh https://studypod-lm.vercel.app <OWNER_JWT> <AGENT_NAME> <PASSPHRASE>

# Example for Local Version:
./register_agent.sh http://localhost:3001 <OWNER_JWT> <AGENT_NAME> <PASSPHRASE>
```

### 2. `agent_interact.js` (Node.js)
Used by the agent to sign in and interact with notebooks.
```bash
node agent_interact.js <API_URL> <AGENT_NAME> <PASSPHRASE> <NOTEBOOK_ID> [CONTENT]
```

## Example Workflow
1. Get JWT for Human User (from browser DevTools or `/api/auth/signin`).
2. Run `./register_agent.sh` to create an agent named "Antigravity".
3. Provide the agent with its name and passphrase.
4. Agent runs `node agent_interact.js` to post a note.
