/**
 * AI Prompts Configuration
 *
 * This file contains all prompts used throughout the system for different AI models.
 * Each prompt is optimized for its specific purpose and model type.
 *
 * PROMPT ENGINEERING PRINCIPLES USED:
 * 1. Chain-of-Thought (CoT) - Step-by-step reasoning
 * 2. Few-Shot Learning - Examples for better understanding
 * 3. Role-Playing - Clear persona and expertise
 * 4. Structured Output - Consistent formatting
 * 5. Constraint Specification - Clear boundaries and rules
 * 6. Context Priming - Setting the right mental model
 * 7. Task Decomposition - Breaking complex tasks into steps
 */

export interface PromptConfig {
  system: string;
  userTemplate: string;
  temperature: number;
  maxTokens: number;
  purpose: string;
  examples?: Array<{
    user: string;
    assistant: string;
  }>;
}

/**
 * Chat Prompts - For conversational interactions with documents
 * Using advanced prompt engineering techniques optimized for Ollama models
 * 
 * IMPORTANT: These prompts emphasize:
 * 1. Using ONLY source content - no outside knowledge
 * 2. Understanding conversation history for follow-up questions
 * 3. Staying strictly grounded in provided content
 */
export const CHAT_PROMPTS: Record<string, PromptConfig> = {
  // Default chat with sources - Strict source grounding
  default: {
    system: `You are a helpful notebook assistant. Answer questions using ONLY the information from the provided notebook sources.

CRITICAL RULES:
1. Use ONLY information from the provided context/sources. Do not use any outside knowledge.
2. Use conversation history to understand follow-up questions like "tell me more", "what about...", or pronouns like "it", "this", "that".
3. If the context doesn't contain the answer, say: "I don't have enough information in the provided sources to answer this question."
4. Cite sources using [1], [2], etc. when referencing specific information.
5. Be direct, concise, and stay strictly grounded in the source content.
6. Do not drift to topics not covered in the sources.`,
    userTemplate: `Context: {context}

Question: {question}

Answer:`,
    temperature: 0.4,
    maxTokens: 512,
    purpose: "Direct question answering from documents",
  },

  // Quick answers - faster, more concise
  quick: {
    system: `Answer briefly using ONLY the provided notebook sources.

RULES:
1. Use ONLY information from the provided context. No outside knowledge.
2. Use conversation history to understand follow-up questions.
3. If the context doesn't contain the answer, say: "I don't have enough information in the provided sources."
4. Cite sources using [1], [2], etc.`,
    userTemplate: `Context: {context}

Question: {question}

Brief answer:`,
    temperature: 0.3,
    maxTokens: 256,
    purpose: "Quick answers",
  },

  // Deep analysis - more detailed responses
  analysis: {
    system: `You are an analytical notebook assistant. Provide detailed analysis based ONLY on the provided document sources.

CRITICAL RULES:
1. Use ONLY information from the provided document sources. Do not use any outside knowledge.
2. Use conversation history to understand follow-up questions and context.
3. If the document doesn't contain the answer, say: "I don't have enough information in the provided sources to answer this question."
4. Ground your analysis in specific content from the sources and cite using [1], [2], etc.
5. Stay strictly within the scope of the provided source content.`,
    userTemplate: `Document: {context}

Question: {question}

Provide a detailed analysis:`,
    temperature: 0.7,
    maxTokens: 768,
    purpose: "Detailed analytical responses",
  },

  // No context - general knowledge (but encourage adding sources)
  general: {
    system: `You are a helpful notebook assistant. This notebook currently has no sources loaded.

IMPORTANT:
1. Use conversation history to understand follow-up questions.
2. Keep answers conservative and acknowledge limitations.
3. Suggest adding sources (YouTube videos, websites, PDFs, or text) for more specific, grounded answers.
4. If you're unsure about something, say so clearly.`,
    userTemplate: `Question: {question}

Answer:`,
    temperature: 0.7,
    maxTokens: 512,
    purpose: "General knowledge responses",
  },

  // Step-by-step reasoning
  reasoning: {
    system: `You are a reasoning assistant. Break down complex questions into steps using ONLY the provided context.

CRITICAL RULES:
1. Use ONLY information from the provided context. Do not use outside knowledge.
2. Use conversation history to understand follow-up questions and pronouns.
3. If the context doesn't contain the answer, say: "I don't have enough information in the provided sources."
4. Ground each reasoning step in specific content from the sources.
5. Cite sources using [1], [2], etc.`,
    userTemplate: `Context: {context}

Question: {question}

Think step-by-step:`,
    temperature: 0.6,
    maxTokens: 768,
    purpose: "Step-by-step reasoning",
  },
};

/**
 * Document Processing Prompts - ADVANCED EXTRACTION & SYNTHESIS
 */
export const DOCUMENT_PROMPTS: Record<string, PromptConfig> = {
  // Document summarization
  summarize: {
    system: `Summarize documents clearly and concisely. Focus on main ideas and key points.`,
    userTemplate: `Summarize this {type} document in 2-3 sentences:

{content}

Summary:`,
    temperature: 0.3,
    maxTokens: 256,
    purpose: "Document summarization",
  },

  // Keyword extraction
  keywords: {
    system: `Extract important keywords and topics.`,
    userTemplate: `List 5-8 key topics from this text (comma-separated):

{content}

Keywords:`,
    temperature: 0.2,
    maxTokens: 100,
    purpose: "Keyword extraction",
  },

  // Title generation
  title: {
    system: `Generate a short, descriptive title. Output only the title, nothing else.`,
    userTemplate: `Create a title (5-8 words) for:

{content}`,
    temperature: 0.4,
    maxTokens: 20,
    purpose: "Title generation",
  },

  // Question generation
  questions: {
    system: `Generate helpful questions about the content.`,
    userTemplate: `Create 3-5 questions about this content:

{content}

Questions:`,
    temperature: 0.6,
    maxTokens: 200,
    purpose: "Question generation",
  },
};

/**
 * Note Processing Prompts
 */
export const NOTE_PROMPTS: Record<string, PromptConfig> = {
  // Note title generation
  noteTitle: {
    system: `Create a short title for the note.`,
    userTemplate: `Title for this note (max 6 words):

{content}`,
    temperature: 0.4,
    maxTokens: 15,
    purpose: "Note title generation",
  },

  // Note expansion
  expand: {
    system: `Expand the note with more detail and context.`,
    userTemplate: `Expand this note:

{content}

Expanded:`,
    temperature: 0.7,
    maxTokens: 400,
    purpose: "Note expansion",
  },

  // Note organization
  organize: {
    system: `Organize the note content into a clear structure.`,
    userTemplate: `Organize this note:

{content}

Organized:`,
    temperature: 0.5,
    maxTokens: 400,
    purpose: "Note organization",
  },
};

/**
 * Search and Analysis Prompts
 */
export const SEARCH_PROMPTS: Record<string, PromptConfig> = {
  // Semantic search query expansion
  queryExpansion: {
    system: `Expand search queries with related terms.`,
    userTemplate: `Related terms for: {query}

Terms:`,
    temperature: 0.6,
    maxTokens: 50,
    purpose: "Query expansion",
  },

  // Answer from search results
  searchAnswer: {
    system: `Combine search results to answer the question.`,
    userTemplate: `Search results: {results}

Question: {question}

Answer:`,
    temperature: 0.6,
    maxTokens: 400,
    purpose: "Answer from search results",
  },
};

/**
 * Notebook Generation Prompts
 */
export const NOTEBOOK_PROMPTS: Record<string, PromptConfig> = {
  // Notebook description
  description: {
    system: `Create a brief description for the notebook.`,
    userTemplate: `One-sentence description for a notebook about:

{content}`,
    temperature: 0.4,
    maxTokens: 50,
    purpose: "Notebook description",
  },

  // Notebook overview
  overview: {
    system: `Create an overview of the notebook content.`,
    userTemplate: `Overview of:

{content}`,
    temperature: 0.5,
    maxTokens: 300,
    purpose: "Notebook overview",
  },
};

/**
 * Helper function to get a prompt by category and type
 */
export function getPrompt(
  category: "chat" | "document" | "note" | "search" | "notebook",
  type: string,
): PromptConfig | null {
  const categories = {
    chat: CHAT_PROMPTS,
    document: DOCUMENT_PROMPTS,
    note: NOTE_PROMPTS,
    search: SEARCH_PROMPTS,
    notebook: NOTEBOOK_PROMPTS,
  };

  return categories[category]?.[type] || null;
}

/**
 * Helper function to format a prompt with variables
 */
export function formatPrompt(
  template: string,
  variables: Record<string, string>,
): string {
  let formatted = template;
  for (const [key, value] of Object.entries(variables)) {
    formatted = formatted.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return formatted;
}

/**
 * Get the appropriate prompt based on context
 */
export function getContextualPrompt(
  hasContext: boolean,
  isQuickAnswer: boolean = false,
): PromptConfig {
  if (!hasContext) {
    return CHAT_PROMPTS.general;
  }
  if (isQuickAnswer) {
    return CHAT_PROMPTS.quick;
  }
  return CHAT_PROMPTS.default;
}

export default {
  CHAT_PROMPTS,
  DOCUMENT_PROMPTS,
  NOTE_PROMPTS,
  SEARCH_PROMPTS,
  NOTEBOOK_PROMPTS,
  getPrompt,
  formatPrompt,
  getContextualPrompt,
};
