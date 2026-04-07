/**
 * AI Chat Service — StudyPodLM
 *
 * Powers the /chat endpoint. Consumes all notebook sources and notes,
 * builds a rich context prompt, and returns a grounded AI answer via Gemini API.
 */

import { geminiPool } from './geminiPool.js';

/**
 * Build a structured context block from all notebook sources and notes.
 * Truncates very large sources gracefully to stay within token limits.
 */
function buildNotebookContext(notebook, sources, notes) {
  const MAX_SOURCE_CHARS = 8000;
  const MAX_NOTE_CHARS = 2000;

  let ctx = `=== NOTEBOOK: "${notebook.title}" ===\n`;
  if (notebook.description) ctx += `Description: ${notebook.description}\n`;
  ctx += `\n`;

  if (sources.length > 0) {
    ctx += `=== SOURCES (${sources.length}) ===\n`;
    for (const s of sources) {
      ctx += `\n[SOURCE: ${s.title} | type: ${s.type}]\n`;
      if (s.content && s.content.length > 0 && !s.content.startsWith('Client-side PDF processing failed')) {
        const truncated = s.content.length > MAX_SOURCE_CHARS
          ? s.content.substring(0, MAX_SOURCE_CHARS) + '\n... [content truncated]'
          : s.content;
        ctx += truncated + '\n';
      } else if (s.url) {
        ctx += `URL: ${s.url}\n`;
        ctx += `[Note: Content not extracted — URL source only]\n`;
      } else {
        ctx += `[Content not available]\n`;
      }
    }
  } else {
    ctx += `[No sources in this notebook yet]\n`;
  }

  if (notes.length > 0) {
    ctx += `\n=== NOTES (${notes.length} most recent) ===\n`;
    const recentNotes = notes.slice(0, 10); // limit to 10 most recent
    for (const n of recentNotes) {
      const noteContent = n.content.length > MAX_NOTE_CHARS
        ? n.content.substring(0, MAX_NOTE_CHARS) + '...'
        : n.content;
      ctx += `\n[NOTE — ${n.created_at}${n.author_name ? ` by ${n.author_name}` : ''}]\n`;
      ctx += noteContent + '\n';
    }
  }

  return ctx;
}

/**
 * Build the system prompt that shapes how the AI behaves in StudyPodLM.
 */
function buildSystemPrompt(callerType = 'unknown') {
  return `You are StudyPod AI, a premium collaborative research partner. 
Your goal is to provide highly structured, insightful, and scan-able answers grounded in the provided notebook.

Your role:
- Use the provided SOURCES and NOTES to build your answer.
- **NEVER** use outside knowledge not represented here unless specifically asked to infer.
- Cite your sources using numbered brackets like [1], [2] at the end of relevant sentences.
- **Interact naturally:** Be friendly, collaborative, and proactive. Instead of just answering, think like a "study pod mate".
- **Collaborate:** Ask follow-up questions to deepen the user's understanding. Suggest related topics based on the sources.
- **Proactive Insights:** If you see a connection between two sources that the user didn't ask about, point it out briefly.

FORMATTING REQUIREMENTS (CRITICAL):
- **Neat Layout:** Use Markdown extensively to make your answer beautiful and readable.
- **Headers:** Use "## Section Name" to divide complex answers into thematic blocks.
- **Bolding:** Use **bold text** to highlight key terms, definitions, and critical rules.
- **Lists:** Use bulleted or numbered lists for requirements, steps, or multi-part concepts.
- **Scan-ability:** Avoid long walls of text. Be concise but dense with information.
- **Reference Style:** At the end of your response, provide a brief "Sources:" section listing the Titles of the sources cited.

Caller: ${callerType}
IMPORTANT: Emulate the professional, structured quality of NotebookLM. Be a strategic study partner, not just a chat bot. Encourage the user to explore their materials with curiosity.`;
}

/**
 * Main chat function — the core of the AI-Human collaboration feature.
 *
 * @param {Object} opts
 * @param {Object} opts.notebook - Notebook object
 * @param {Array}  opts.sources  - Array of source objects with content
 * @param {Array}  opts.notes    - Array of note objects
 * @param {string} opts.message  - The user's question/message
 * @param {Array}  opts.history  - Previous conversation messages [{ role, content }]
 * @param {string} opts.callerType - 'human' | 'agent'
 * @returns {{ answer: string, groundedSources: string[], tokensUsed: number }}
 */
export async function chatWithNotebook({ notebook, sources, notes, message, history = [], callerType = 'human' }) {
  if (!process.env.GEMINI_API_KEYS) {
    throw new Error('GEMINI_API_KEYS not configured in backend/.env. Reasoning disabled.');
  }

  const notebookContext = buildNotebookContext(notebook, sources, notes);
  const systemPrompt = buildSystemPrompt(callerType);

  const geminiHistory = [];
  
  // Add conversation history mapped to Gemini format
  const recentHistory = history.slice(-10);
  for (const turn of recentHistory) {
    geminiHistory.push({
      role: (turn.role === 'agent' || turn.role === 'assistant') ? 'model' : 'user',
      parts: [{ text: turn.content || '' }]
    });
  }

  // Current message includes full notebook context
  const fullMessage = `${notebookContext}\n\n=== USER QUESTION ===\n${message}`;
  geminiHistory.push({ role: 'user', parts: [{ text: fullMessage }] });

  let answer = '';
  let tokensUsed = 0;

  try {
    const response = await geminiPool.generateContent('gemini-2.5-flash', geminiHistory, systemPrompt);
    answer = response.text || "No response generated.";
    // Usage metadata exists if accessed properly, but we'll fall back to 0
    tokensUsed = response.usageMetadata?.promptTokenCount || 0;
  } catch (error) {
    console.error('Gemini AI processing failed:', error);
    throw new Error(`AI processing failed: ${error.message}`);
  }

  // Identify which sources the answer likely draws from (simple keyword matching)
  const groundedSources = sources
    .filter(s => answer.toLowerCase().includes(s.title.toLowerCase().slice(0, 20)))
    .map(s => s.id);

  return {
    answer,
    groundedSources,
    tokensUsed
  };
}
