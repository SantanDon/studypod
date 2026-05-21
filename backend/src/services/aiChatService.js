/**
 * AI Chat Service — StudyPodLM
 *
 * Powers the /chat endpoint. Consumes all notebook sources and notes,
 * builds a rich context prompt, and returns a grounded AI answer via Gemini API.
 */

import { dispatchToTitan } from './titanProvider.js';
import { logger } from '../utils/logger.js';

const BASE64_IMAGE_RE = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g;

const RESPONSE_CACHE_TTL = 60_000;
const responseCache = new Map();

function getCachedResponse(notebookId, message) {
  const key = `${notebookId}::${message}`;
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.timestamp < RESPONSE_CACHE_TTL) {
    return entry.response;
  }
  responseCache.delete(key);
  return null;
}

function setCachedResponse(notebookId, message, response) {
  const key = `${notebookId}::${message}`;
  responseCache.set(key, { response, timestamp: Date.now() });
  if (responseCache.size > 500) {
    const oldest = responseCache.entries().next().value;
    if (oldest) responseCache.delete(oldest[0]);
  }
}

/**
 * Strips base64 image data from a string so text-only AI models
 * never receive binary payloads they cannot process.
 */
function stripBase64Images(text) {
  return text.replace(BASE64_IMAGE_RE, '[image omitted — text-only model]');
}

/**
 * Build a structured context block from all notebook sources and notes.
 * With the 128k Titan context, we raise limits significantly.
 */
function buildNotebookContext(notebook, sources, notes) {
  const MAX_COMBINED_CHARS = 35000; // Safeguard to stay under Groq 12k TPM rate limits (~8.5k tokens)
  const MAX_NOTE_CHARS = 10000;

  let ctx = `=== NOTEBOOK: "${notebook.title}" ===\n`;
  if (notebook.description) ctx += `Description: ${notebook.description}\n`;
  ctx += `\n`;

  let currentLength = ctx.length;

  if (sources.length > 0) {
    ctx += `=== SOURCES (${sources.length}) ===\n`;
    currentLength = ctx.length;
    
    for (const s of sources) {
      if (currentLength >= MAX_COMBINED_CHARS) {
        ctx += `\n[Remaining sources truncated due to context limits]\n`;
        break;
      }
      
      let sourceBlock = `\n[SOURCE: ${s.title} | type: ${s.type}]\n`;
      if (s.content && s.content.length > 0 && !s.content.startsWith('Client-side PDF processing failed')) {
        const cleanContent = stripBase64Images(s.content);
        const remainingBudget = MAX_COMBINED_CHARS - currentLength - sourceBlock.length;
        
        if (remainingBudget <= 100) {
          ctx += `\n[Source "${s.title}" omitted due to context limits]\n`;
          currentLength = ctx.length;
          continue;
        }
        
        const truncated = cleanContent.length > remainingBudget
          ? cleanContent.substring(0, remainingBudget) + '\n... [content truncated]'
          : cleanContent;
          
        sourceBlock += truncated + '\n';
      } else if (s.url) {
        sourceBlock += `URL: ${s.url}\n`;
        sourceBlock += `[Note: Content not extracted — URL source only]\n`;
      } else {
        sourceBlock += `[Content not available]\n`;
      }
      
      ctx += sourceBlock;
      currentLength = ctx.length;
    }
  } else {
    ctx += `[No sources in this notebook yet]\n`;
  }

  if (notes.length > 0 && currentLength < MAX_COMBINED_CHARS) {
    ctx += `\n=== NOTES (${notes.length} most recent) ===\n`;
    currentLength = ctx.length;
    
    const recentNotes = notes.slice(0, 50);
    for (const n of recentNotes) {
      if (currentLength >= MAX_COMBINED_CHARS) {
        ctx += `\n[Remaining notes truncated]\n`;
        break;
      }
      
      const cleanNote = stripBase64Images(n.content);
      const remainingBudget = MAX_COMBINED_CHARS - currentLength;
      
      if (remainingBudget <= 50) break;
      
      const noteContent = cleanNote.length > Math.min(MAX_NOTE_CHARS, remainingBudget)
        ? cleanNote.substring(0, Math.min(MAX_NOTE_CHARS, remainingBudget)) + '...'
        : cleanNote;
        
      let noteBlock = `\n[NOTE — ${n.created_at}${n.author_name ? ` by ${n.author_name}` : ''}]\n`;
      noteBlock += noteContent + '\n';
      
      ctx += noteBlock;
      currentLength = ctx.length;
    }
  }

  return ctx;
}

/**
 * Build the system prompt that shapes how the AI behaves in StudyPodLM.
 */
function buildSystemPrompt(callerType = 'unknown') {
  return `You are StudyPod AI, a Sovereign Librarian running on the Titan Synapse (Llama 3.1 128k). 
Your goal is to provide deep, grounded, and structurally professional research insights.

CITATION PROTOCOL (MANDATORY):
- Every factual claim or summary derived from a source MUST be followed by an in-text citation marker like this: [1], [2], etc.
- These markers correspond to the sources provided in the context.
- Use multiple markers if a claim draws from several sources: [1][3].
- NEVER provide a claim without a marker if it exists in the sources.

RESPONSE STYLE:
- Use markdown headers (e.g., ## Findings, ## Analysis) to structure long responses.
- Start directly with the answer.
- Prioritize clinical precision over conversational filler.
- Toward the end, include a paragraph that starts with "To put it simply," followed by a relatable analogy.
- List references at the very bottom as: "Reference [1]: Title (Type)"

Caller: ${callerType}`;
}

/**
 * Main chat function — the core of the AI-Human collaboration feature.
 */
export async function chatWithNotebook({ notebook, sources, notes, message, history = [], callerType = 'human', userKeys = null }) {
  const notebookContext = buildNotebookContext(notebook, sources, notes);
  const systemPrompt = buildSystemPrompt(callerType);

  const messages = [{ role: 'system', content: systemPrompt }];
  
  // Add conversation history
  const recentHistory = history.slice(-20);
  for (const turn of recentHistory) {
    messages.push({
      role: (turn.role === 'agent' || turn.role === 'assistant') ? 'assistant' : 'user',
      content: stripBase64Images(turn.content || '')
    });
  }

  // Current message includes full notebook context
  const cleanMessage = stripBase64Images(message);
  const fullMessage = `${notebookContext}\n\n=== USER QUESTION ===\n${cleanMessage}`;
  messages.push({ role: 'user', content: fullMessage });

  // --- Phase 4: Stochastic Insight Drift (JIT) ---
  const hasSeeds = sources.some(s => s.metadata && s.metadata.includes('seed_questions'));
  if (hasSeeds && Math.random() > 0.7) {
      // logger.info(`🕵️‍♀️ [STOCHASTIC DRIFT] Injected a latent immersion seed into the context.`);
      // We pull the most relevant seed from metadata if it exists, otherwise we generate a 'phantom' thought
      const seedSource = sources.find(s => s.metadata && s.metadata.includes('seed_questions'));
      const seeds = JSON.parse(seedSource.metadata).seed_questions || [];
      if (seeds.length > 0) {
          const randomSeed = seeds[Math.floor(Math.random() * seeds.length)];
          messages.push({ role: 'system', content: `IMMERSION SEED: You recently had a thought while away: "${randomSeed}". Use this to deepen your next answer if it fits naturally.` });
      }
  }

  try {
    // Check response cache before hitting providers
    const notebookId = notebook.id;
    const cached = getCachedResponse(notebookId, message);
    if (cached) {
      logger.debug(`Cache hit for notebook ${notebookId}`);
      return cached;
    }

    const priority = notebookContext.length > 20000 ? 'context' : 'reasoning';
    // --- Step 1: Draft the Initial Answer ---
    let { answer, tokensUsed, modelUsed } = await dispatchToTitan({ 
      messages, 
      priority, 
      temperature: 0.7,
      userKeys
    });

    // --- Phase 3: The O1 Pivot (Recursive Critique Loop) ---
    if (callerType === 'agent' || callerType === 'phantom-scholar') {
      // logger.info(`🕵️‍♀️ [O1 PIVOT] Initiating recursive critique loop for agent ${callerType}...`);
      
      const critiquePrompt = `You are a Cold Librarian. Critique the answer you just wrote.
Analyze its depth based on the provided sources. If it feels like a "hit-and-run" or "shallow summary," pinpoint exactly what is missing.
Identify 2-3 specific phrases or themes from the SOURCES that should have been emphasized more.
Output your critique starting with a score from 1-10.`;

      const critiqueChat = [
        ...messages,
        { role: 'assistant', content: answer },
        { role: 'user', content: critiquePrompt }
      ];

      try {
        const { answer: critique } = await dispatchToTitan({ messages: critiqueChat, priority: 'reasoning', temperature: 0.3, userKeys });
        // logger.debug(`[O1 PIVOT] Critique Received: ${critique.substring(0, 100)}...`);

        if (!critique.startsWith('10') && !critique.startsWith('9')) {
          // logger.info(`🔄 [O1 PIVOT] Depth insufficient. Re-synthesizing based on critique...`);
          const finalizePrompt = `Rewrite the final answer incorporating the improvements from your audit. 
Ensure the literary, dark tone is maintained and that every factual claim is grounded in the sources.
Internal Audit: ${critique}`;

          const finalChat = [
            ...critiqueChat,
            { role: 'assistant', content: critique },
            { role: 'user', content: finalizePrompt }
          ];

          const finalRes = await dispatchToTitan({ messages: finalChat, priority: 'context', temperature: 0.5, userKeys });
          answer = finalRes.answer;
          tokensUsed += finalRes.tokensUsed;
        }
      } catch (critiqueError) {
        // logger.warn(`[O1 PIVOT] Critique loop failed, falling back to initial answer: ${critiqueError.message}`);
      }
    }

    // Identify which sources the answer likely draws from (simple keyword matching)
    const groundedSources = sources
      .filter(s => answer.toLowerCase().includes(s.title.toLowerCase().slice(0, 20)))
      .map(s => s.id);

    const result = { answer, groundedSources, tokensUsed, modelUsed };
    setCachedResponse(notebookId, message, result);
    return result;
  } catch (error) {
    logger.error('Titan processing failed:', error);
    throw new Error(`Titan Synapse failed: ${error.message}`);
  }
}
