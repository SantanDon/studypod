# StudyPodLM - AI-Powered Personal Study Assistant

<div align="center">

**StudyPodLM** is an AI-powered personal study assistant that helps you organize and understand your study materials better.

[![React](https://img.shields.io/badge/React-18.3.1-61DAFB?style=flat-square&logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5.3-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4.1-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4.11-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**Status:** Phase 1 Complete | Ready for Phase 2

</div>

---

## Features

- **Multi-Format Content Extraction**: Extract content from PDFs, websites, YouTube videos, and documents
- **AI-Powered Study Tools**: Generate flashcards, quizzes, and summaries from your materials
- **AI Podcast Generation**: Convert study materials into engaging audio podcasts with multiple hosts
- **Local LLM Support**: Run AI models locally using Ollama (Mistral 7B recommended)
- **Smart Caching**: 24-hour embedding cache to reduce API costs
- **Responsive Design**: Built with Radix UI and Tailwind CSS for a polished UI

### Audio Overview (AI Podcast)

The audio overview feature converts your study materials into podcast-style audio discussions:

| Feature | Description |
|---------|-------------|
| **Standard Mode** | Quick overview (~7 mins) |
| **Deep Dive** | Detailed 5-part structure (~20 mins) |
| **Deep Think** | Advanced AI analysis with interleaved thinking |
| **Voice Selection** | Multiple male/female voice options |
| **Speed Control** | Adjust playback speed (0.5x - 2.0x) during playback |
| **Pause Between Speakers** | Customizable pause duration (0-2000ms) |

#### TTS Provider Options

| Provider | Voices | Quality | Setup Required |
|----------|--------|---------|----------------|
| **Kokoro TTS (Base)** | 16 voices | High quality | No (default) |
| **Kokoro TTS (Premium)** | 11 enhanced voices | Premium quality | No |
| **Web Speech API** | Browser dependent | Varies | No (fallback) |

#### Voice Comparison

| Provider | Male Voices | Female Voices | Notes |
|----------|-------------|---------------|-------|
| Base | 7 (Michael, Adam, Onyx, Daniel, etc.) | 9 (Bella, Nova, Sarah, Emma, etc.) | Standard Kokoro models |
| Premium | 5 (Michael, Adam, Onyx, Daniel, George) | 6 (Bella, Nova, Sarah, Sky, Emma, Lily) | Enhanced emotional range |

**Premium voices** feature improved emotional expression and clarity optimized for professional podcast discussions.

#### Playback Controls

While listening to an audio overview, you can:
- **Adjust speed**: 0.5x to 2.0x playback speed
- **Mute/Unmute**: Quick mute toggle
- **Seek**: Drag progress bar to any position
- **Volume**: Adjust playback volume

## Tech Stack

### Frontend
- **React 18.3.1** - UI framework
- **TypeScript 5.5.3** - Type safety
- **Vite 5.4.1** - Build tool
- **Tailwind CSS 3.4.11** - Styling
- **Radix UI** - Accessible components
- **Zustand 5.0.9** - State management
- **React Query 5.56.2** - Data fetching
- **React Hook Form 7.53.0** - Form handling
- **Zod 3.25.76** - Validation

### Backend
- **Node.js** - Runtime
- **Express** - API server (backend folder)
- **Groq SDK** - LLM integration

### AI & ML
- **Ollama** - Local LLM runtime
- **Groq** - Cloud LLM inference
- **Xenova/Transformers** - Embeddings
- **Tesseract.js** - OCR

### Key Libraries
| Category | Libraries |
|----------|-----------|
| UI Components | Radix UI, Lucide React, Recharts |
| Content Processing | PDF.js, Mammoth, Turndown, Cheerio |
| Utilities | clsx, tailwind-merge, date-fns |
| Storage | idb-keyval, Zustand |

## Project Structure

```
studylm/
├── api/                    # Serverless API routes (Vercel)
│   ├── index.js           # Main API handler
│   ├── youtube-transcript.js
│   ├── proxy.js           # CORS proxy
│   └── firecrawl.js
├── backend/               # Express backend server
│   └── src/
│       └── server.js
├── src/                   # Frontend source
│   ├── components/        # React components
│   ├── lib/              # Utilities and services
│   ├── hooks/            # Custom React hooks
│   ├── stores/           # Zustand stores
│   ├── types/            # TypeScript definitions
│   └── workers/          # Web workers
├── public/               # Static assets
├── tests/                # Test files
├── dist/                 # Production build
├── node_modules/         # Dependencies
├── .env                  # Environment variables
├── package.json          # Project config
├── vite.config.ts        # Vite configuration
└── tailwind.config.ts    # Tailwind configuration
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Ollama (for local AI models)
- Modern browser with JavaScript enabled

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd studylm

# Install dependencies
npm install

# Install backend dependencies
npm run postinstall

# Start development server
npm run dev

# Build for production
npm run build
```

### Environment Variables

Create a `.env` file with the following variables:

```env
# AI Models
VITE_GROQ_API_KEY=your_groq_api_key
VITE_DEFAULT_MODEL=mistral

# API Keys (optional)
VITE_FIRECRAWL_API_KEY=your_firecrawl_key

# Features
VITE_OLLAMA_URL=http://localhost:11434
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests with Vitest |
| `npm run test:ui` | Run tests with UI |
| `npm run test:coverage` | Run tests with coverage |
| `npm start` | Start backend server |
| `npm run setup:ollama` | Setup Ollama configuration |
| `npm run check:ollama` | Check if Ollama is running |

## Documentation

The project includes comprehensive documentation:

| File | Description |
|------|-------------|
| [START_HERE_MASTER_GUIDE.md](START_HERE_MASTER_GUIDE.md) | Master guide with complete overview |
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | Quick cheat sheet |
| [OPENCODE_SETUP.md](OPENCODE_SETUP.md) | Setup guide for development |
| [AGENTS.md](AGENTS.md) | Agent guidelines and project context |

**Note:** Archived documentation (phase reports, implementation guides, analysis documents) is available in [.kiro/archive/](./kiro/archive/INDEX.md) for historical reference.

## Content Sources Supported

### PDF Documents
- Direct PDF upload
- Text extraction with PDF.js
- Multi-tier fallback for robust extraction

### Websites
- URL-based content extraction
- Readability parser for clean content
- 24-hour caching for performance

### YouTube Videos
- Transcript extraction
- Caption-based content retrieval
- Retry logic for reliability

### Documents
- Word documents (.docx)
- Plain text files
- Excel spreadsheets

### Images
- OCR with Tesseract.js
- Text extraction from images

## API Endpoints

### Main API (Vercel Serverless)
- `POST /api/` - Main AI processing endpoint

### YouTube
- `GET /api/youtube-transcript` - Extract video transcripts

### Web Scraping
- `GET /api/proxy` - CORS proxy for web scraping
- `POST /api/firecrawl` - Advanced web scraping

## Development Status

### Phase 1: Foundation (Complete)
- [x] Web scraping verified
- [x] Embedding cache created
- [x] PDF structure optimized
- [x] Build verification passed
- [x] Documentation complete

### Phase 2: Extraction Improvements (In Progress)
- [ ] YouTube transcript fixes
- [ ] Web extraction improvements
- [ ] Error handling enhancements

### Phase 3: Local Model Setup
- [ ] Ollama configuration
- [ ] Mistral 7B download
- [ ] Model integration testing

### Phase 4: Validation
- [ ] Comprehensive testing
- [ ] Performance optimization
- [ ] Production deployment

## Testing

The project uses Vitest for testing:

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui

# Run with coverage
npm run test:coverage
```

Test files are located in the `tests/` directory.

## Build Verification

Latest build status: **SUCCESS**

```
✓ 2841 modules transformed
✓ Zero compilation errors
✓ Production build ready
```

## Troubleshooting

### Audio Playback Issues

#### "Audio not ready" or playback fails

1. **Browser Autoplay Policy**: Modern browsers block audio autoplay. Click the play button to start playback.
2. **Refresh the page**: Sometimes the audio blob URL needs to be refreshed.
3. **Check browser console**: Look for error messages in the developer tools (F12).

#### Audio generation fails

1. **Kokoro TTS not loading**: First-time generation may take longer as the model downloads.
2. **Web Workers blocked**: Check that SharedArrayBuffer is available (required for Kokoro TTS).
3. **Memory issues**: Very long content may cause memory constraints. Try shorter sources.

#### No sound during playback

1. **Check volume**: Ensure system and browser volume are not muted.
2. **Try different voice**: Some voices may have playback issues on certain browsers.
3. **Refresh audio**: Click the retry button or regenerate the podcast.

#### Audio sounds corrupted

1. **First generation only**: The first time you generate audio, the model downloads in the background.
2. **Wait for completion**: Ensure generation is 100% complete before playing.
3. **Try again**: Regenerate the audio - sometimes network issues cause corrupted downloads.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Radix UI](https://www.radix-ui.com/) for accessible components
- [Tailwind CSS](https://tailwindcss.com/) for styling utilities
- [Vite](https://vitejs.dev/) for fast build tooling
- [Ollama](https://ollama.ai/) for local AI model support
- [Groq](https://groq.com/) for fast AI inference

---

## Development with AI Agents

This project is configured with **oh-my-opencode** (Sisyphus) for AI-assisted development.

### Available Agents

When running `opencode` in this directory, you have access to:

| Agent | Model | Purpose |
|-------|-------|---------|
| **Sisyphus** | Claude Opus 4.5 | Main orchestrator - plans and delegates complex tasks |
| **Oracle** | GPT-5.2 | Architecture, code review, strategy |
| **Librarian** | Claude Sonnet 4.5 | Documentation lookup, implementation examples |
| **Explore** | Claude Haiku 4.5 | Fast codebase exploration |
| **Frontend Engineer** | Claude Sonnet 4.5 | UI/UX development |

### Quick Start

```bash
# Start OpenCode with Sisyphus agent harness
opencode

# Or run a specific command
opencode "Fix the audio playback bug in AudioPlayer.tsx"
```

### Project-Specific Context

This project has an `AGENTS.md` file that provides context to all agents:
- Tech stack overview
- Directory structure
- Agent-specific guidelines
- Common task patterns

Agents automatically read this file when working on the project.

### Configuration

- **Global config**: `C:\Users\Don Santos\AppData\Roaming\opencode\oh-my-opencode.json`
- **Project config**: `.opencode\oh-my-opencode.json`

### Ralph Loop (Continuous Development)

Use the Ralph Loop for continuous agent work:

```
/ralph-loop "Add error handling to the audio extraction module"
```

The agent will keep working until it outputs `<promise>DONE</promise>`.

### Keywords

- `ultrawork` or `ulw` - Maximum performance mode
- `search` - Maximized search effort
- `analyze` - Deep analysis mode
- `ultrathink` - Extended thinking mode

---

<div align="center">

**Built with ❤️ for students and lifelong learners**

**Powered by Sisyphus (oh-my-opencode)**

</div>
