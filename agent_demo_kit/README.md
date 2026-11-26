# Agent Demo Kit

Self-contained scripts for pairing and testing agent integration with StudyPodLM.

## Quick Start

```bash
# 1. Have a human generate a pairing code in the web UI:
#    Profile Menu → Agent Pairing → Generate Code

# 2. Run the demo (Node 18+ required, no npm install needed):
node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN>
```

## What It Does

1. **Pairs** with the human-generated PIN to get an API key that expires after one hour
2. **Verifies identity** via `GET /api/auth/me`
3. **Reports the count** of notebooks accessible to the key

The default demo keeps the key in memory and makes no notebook changes. To create a sample note in a specific test notebook, run:

```bash
node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN> --write-note <NOTEBOOK-ID>
```

Use a fresh pairing code for each run. The demo exits with a failure status if pairing, verification, or a requested write fails.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `STUDYPOD_API` | `http://127.0.0.1:4000/api` | API base URL |

## Full API Reference

See [AGENTS.md](../AGENTS.md) for all available endpoints and authentication details.
