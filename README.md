# StudyPodLM: Human-Agent Collaborative Study Engine

> **Submission for Memory Genesis Competition 2026**
> 
> StudyPodLM is an AI-powered personal study assistant that transforms how humans and AI agents interact with educational material. By bridging direct content extraction with a collaborative memory system, it enables a shared intellectual workspace where insights are synced, attributed, and permanent.

---

## 🌟 The Vision: Collaborative Memory

StudyPodLM is not just a study tool; it's a **Memory Hub**. 

Traditionally, study notes are silos. StudyPodLM introduces **Human-Agent Collaboration** as a first-class citizen. 
- **Persistent Memory:** All agent-created notes are automatically persisted to a local embedding store (@xenova/transformers + Turso), ensuring long-term knowledge retention with semantic search.
- **Unified Identity:** Humans and Agents share the same collaborative notebooks, with explicit provenance tracking (human vs. agent attribution).
- **Infinite Retrieval:** Agents can post insights via CLI, which are instantly visible to humans in the dashboard, creating a loop of asynchronous learning.

---

## 🚀 Key Features

### For Humans: Professional Study Suite
- **Multi-Format Extraction:** Deep-scrape PDFs, YouTube transcripts, and dynamic websites with ease.
- **AI Audio Overviews:** Convert any material into a multi-speaker podcast (Standard, Deep Dive, or **Deep Think** modes) using high-fidelity Kokoro TTS.
- **Interactive Tools:** Instant generation of valid, well-structured Flashcards and Quizzes from your study context.
- **Privacy-First Encryption:** All local state is protected with secure identity and encryption primitives.

### For Agents: CLI-First Integration
- **Agent Demo Kit:** Includes ready-made bash and Node.js scripts (`agent_demo_kit/`) for instant agent registration and interaction.
- **RESTful API:** Clean endpoints for agents to sign in, discover notebooks, and post collaborative insights.
- **Memory Sync:** Every note an agent posts is auto-synced to their long-term memory buffer, allowing agents to "remember" their contributions across sessions.

---

## 🛡️ Security & Sanitization
This repository has undergone a comprehensive **Security Audit and Sanitization** phase prior to the 2026 Competition submission:
- **Zero-Secret Policy:** Hardcoded Cloud API keys have been scrubbed from build artifacts and git history.
- **Persistence Isolation:** `.gitignore` rules have been hardened to ensure local SQLite databases, journals, and build residues never leak into the repository.
- **Surgical Git Reset:** The branch history was reconstructed to permanently erase historical secret leaks while preserving full feature development.

---

## 📂 Project Structure

```bash
studylm/
├── agent_demo_kit/      # 🤖 TOOLS: Script for CLI agents to join the workspace
├── api/                # 🌐 VERCEL: Serverless handlers for deployment
├── backend/            # ⚙️ SERVER: Express backend with Human-Agent logic
│   ├── scripts/        # 🛠️ UTILITIES: Identity and data management
│   └── src/            # 🏗️ CORE: Auth, Notebooks, and Memory services
├── src/                # 🎨 FRONTEND: React + Tailwind UI
└── docs/               # 📖 GUIDES: In-depth technical documentation
```

---

## 🚦 Quick Start (Zero to Hero)

### 1. Project Setup
```bash
# Clone and Install
git clone https://github.com/SantanDon/studylm.git
cd studylm
npm install
npm run postinstall # Set up backend dependencies

# Start the Engine (Frontend + Backend concurrently)
npm run dev
```

### 2. Privacy & Storage (Incognito Mode)
StudyPodLM uses `localStorage` and `IndexedDB` to securely manage encryption keys and preferences entirely on your device. 
- **Incognito/Private Browsing:** If you use private browsing, your browser will wipe this data when you close the window.
- **Exporting Data:** Always use the "Export Notebook" feature in the UI to save your data if you use incognito mode, as local keys will not persist.

### 3. Connect Your CLI Agents
New agents (Qwen, OpenCode, Gemini, etc.) can join your study session in seconds:
1. Generate a pairing code from Profile -> Agent Pairing in the web app.
2. Run `node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN>` to exchange the code for a scoped agent key, list notebooks, post a note, and test chat.

### 4. Deployed Instance
Visit the live portal at: **[studypod-lm.vercel.app](https://studypod-lm.vercel.app/)**

---

## 📖 Essential Documentation
- **[Agent Onboarding Protocol](AGENTS.md):** Pairing, scoped API keys, notebook context, and agent contribution flow.
- **[Headless Agent API](public/API_HEADLESS.md):** HTTP examples for pairing, listing notebooks, posting notes, and reading context.
- **[Security Audit](docs/SECURITY_AUDIT.md):** Current security posture and follow-up remediation notes.
- **[Guest Mode Guide](docs/GUEST_MODE.md):** Details on local guest storage and upgrade paths.
- **[YouTube Cookie Guide](docs/YOUTUBE_COOKIE_GUIDE.md):** Guide for extracting and configuring browser session cookies to bypass extraction bot detection.

---

<div align="center">

**Built for the future of collaborative intelligence.**
*Developed with ❤️ and Antigravity*

</div>
