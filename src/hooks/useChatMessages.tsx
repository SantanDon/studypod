import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getModelForTask, OllamaTask } from "../config/ollamaModels";
import { OLLAMA_ENABLED } from "@/config/ollamaConfig";
import { useAuth } from "@/contexts/AuthContext";
import { EnhancedChatMessage, Citation, MessageSegment } from "@/types/message";
import { useToast } from "@/hooks/use-toast";
import {
  localStorageService,
  LocalChatMessage,
  LocalSource,
  LocalUser,
} from "@/services/localStorageService";
import { getContextualPrompt, formatPrompt } from "@/config/prompts";
import { search } from "@/lib/search/semanticSearch";
import { generateTextToString } from "@/lib/ai/ollamaClient";
import { coordinatedQuery } from "@/lib/ai/ollamaCoordinator";
import { validateCitations, validateAIResponse } from "@/lib/extraction/contentValidator";
import { parseJsonResponse } from "@/utils/jsonParser";

// Type for chat roles
type ChatRole = "system" | "user" | "assistant";

/**
 * Build recent chat history messages for context retention
 * This allows the AI to understand follow-up questions like "tell me more"
 */
function buildChatHistoryMessages(
  notebookId: string,
  maxTurns: number = 6,        // 6 user/assistant pairs max
  maxChars: number = 4000,     // hard cap for safety
): Array<{ role: ChatRole; content: string }> {
  const rawMessages = localStorageService.getChatMessages(notebookId);
  if (!rawMessages.length) return [];

  // Sort by time to ensure chronological order
  const sorted = [...rawMessages].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Take last N pairs
  const lastPairs = sorted.slice(-maxTurns);

  const history: Array<{ role: ChatRole; content: string }> = [];
  let charCount = 0;

  for (const pair of lastPairs) {
    // User side
    let userText =
      typeof pair.message === "string"
        ? pair.message
        : pair.message?.content ?? "";

    userText = userText?.trim();
    if (userText) {
      if (charCount + userText.length > maxChars) break;
      history.push({ role: "user", content: userText });
      charCount += userText.length;
    }

    // Assistant side
    const aiText = (pair.response || "").trim();
    if (aiText) {
      if (charCount + aiText.length > maxChars) break;
      history.push({ role: "assistant", content: aiText });
      charCount += aiText.length;
    }
  }

  console.log(`📜 Built ${history.length} history messages (${charCount} chars)`);
  return history;
}

// Function to generate AI response using Ollama with ultra-fast processing and semantic search
// IMPORTANT: This function should NEVER throw - it must always return a response
async function generateAIResponse(
  userMessage: string,
  user: LocalUser,
  notebookId: string,
  task: OllamaTask = "chat",
  onChunk?: (chunk: string) => void,
): Promise<string> {
  try {
    console.log(
      "🤖 Generating AI response for:",
      userMessage.substring(0, 50) + "...",
    );

    // Check if sources exist in the notebook
    const sources = localStorageService.getSources(notebookId);
    const hasSourcesInNotebook = sources.length > 0;

    console.log(`📚 Notebook has ${sources.length} source(s)`);

  // Get recent chat history for context retention
  // Get recent chat history for context retention
  const historyMessages = buildChatHistoryMessages(notebookId);

  const recentUserMessages = historyMessages
    .filter((m) => m.role === "user")
    .slice(-3) // last few user turns
    .map((m) => m.content)
    .join("\n\n");

  let semanticQuery = userMessage;

  // If there's previous user content, include it in the search query
  // This helps semantic search find relevant content for follow-up questions
  if (recentUserMessages && recentUserMessages.length > 0) {
    const combined = `${recentUserMessages}\n\nFollow-up question: ${userMessage}`;
    // Hard cap so we don't pass absurdly long search queries
    semanticQuery = combined.slice(0, 800);
    console.log(`🔗 Using conversation-aware search query`);
  }

  // Use semantic search to find most relevant content
  let relevantContext = "";
  interface SearchResult {
    title: string;
    excerpt?: string;
    content: string;
    type: string;
    score?: number;
  }

  let searchResults: SearchResult[] = [];

  try {
    // Search across sources, notes, and chat history
    console.log(`🔍 Searching for context with query: "${userMessage}"`);
    searchResults = await search(semanticQuery, {
      notebookId,
      types: ["source", "note"], // Exclude "chat" to prevent system conversation context from leaking
      limit: 5,
      useSemanticSearch: true,
      minScore: 0.05, // Lowered threshold to find more matches
    });

    console.log(
      `📊 Found ${searchResults.length} relevant results via semantic search`,
    );
    if (searchResults.length > 0) {
      console.log(
        "📋 Search results:",
        searchResults.map((r) => ({
          title: r.title,
          score: r.score,
          type: r.type,
          contentLength: r.content?.length || 0,
        })),
      );
    }

    if (searchResults.length > 0) {
      // Build context with more details to improve response accuracy
      relevantContext = searchResults
        .map((result, idx) => {
          const excerpt = result.excerpt || result.content.substring(0, 300);
          return `[${idx + 1}] Source: "${result.title}" (${result.type})\nContent: ${excerpt}\nRelevance Score: ${(result.score || 0).toFixed(3)}\n---`;
        })
        .join("\n\n");

      console.log(
        `✅ Built context from search results (${relevantContext.length} chars)`,
      );
      console.log(
        `📝 Context preview: ${relevantContext.substring(0, 200)}...`,
      );
    } else {
      console.log("⚠️ No relevant results found via semantic search");
    }
  } catch (searchError) {
    console.warn(
      "❌ Semantic search failed, using basic source retrieval:",
      searchError,
    );

    // Fallback to basic source retrieval
    if (hasSourcesInNotebook) {
      // Include content from source chunks if available in metadata
      relevantContext = sources
        .slice(0, 5)
        .map((source) => {
          let content = source.content || "No content available";
          
          // Include chunks from metadata if available
          if (source.metadata && typeof source.metadata === 'object' && 'chunks' in source.metadata) {
            const chunks = source.metadata.chunks as string[];
            if (Array.isArray(chunks) && chunks.length > 0) {
              content = chunks.join(' ') + ' ' + content;
            }
          }
          
          return `Source: ${source.title} (${source.type})\nContent: ${content.substring(0, 500)}`;
        })
        .join("\n\n");

      console.log(
        `📄 Fallback: Using ${sources.length} source(s) as context (${relevantContext.length} chars)`,
      );
      console.log(
        `📝 Fallback context preview: ${relevantContext.substring(0, 200)}...`,
      );
    }
  }

  // Get appropriate prompt based on context
  const hasContext = relevantContext.length > 0;
  const promptConfig = getContextualPrompt(hasContext, false);

  // Log what mode we're using
  if (hasContext) {
    console.log(
      `💡 Using document-aware mode with ${searchResults.length} relevant results`,
    );
  } else if (hasSourcesInNotebook) {
    console.log(
      `💡 Sources available but not relevant to query - using general mode`,
    );
  } else {
    console.log(`💡 No sources in notebook - using general knowledge mode`);
  }

  // Try to use the enhanced Ollama service with model coordination
  if (OLLAMA_ENABLED) {
    try {
      const { chatCompletion, checkOllamaHealth } = await import(
        "@/lib/ai/ollamaService"
      );

      console.log("🔍 Checking Ollama availability...");

      // Quick health check
      const isHealthy = await checkOllamaHealth();
      if (!isHealthy) {
        console.warn("⚠️ Ollama health check failed - service not available");
        throw new Error("Ollama not available");
      }

      console.log("✅ Ollama is available");
      console.log("⚡ Using coordinated Ollama models for enhanced response");

      // Use coordinated query for complex questions with sources
      if (hasContext && searchResults.length > 0) {
        const sources = searchResults.map((r) => ({
          title: r.title,
          content: r.content.substring(0, 1000),
        }));

        const coordinated = await coordinatedQuery({
          query: semanticQuery,
          sources,
          includeAnalysis: false, // Keep it fast
          includeSummary: false,
        });

        console.log(
          `✅ Coordinated response generated using ${coordinated.metadata.models.length} models in ${coordinated.metadata.totalDuration}ms`,
        );

        return coordinated.answer;
      }

      // For simple queries or no context, use direct chat
      let userContent;
      if (hasContext) {
        // If we have context, separate it from the question to avoid AI seeing it directly
        // Use a more specific prompt to prevent the AI from echoing the context
        userContent = `Question: ${userMessage}\n\nBased on the following sources, please provide a helpful and accurate answer. Do not repeat the source content verbatim. Only use information from these sources and cite them where relevant using the format [1], [2], etc.\n\nSources:\n${relevantContext}`;
      } else {
        userContent = userMessage;
      }

      // Build a strict system prompt that emphasizes using sources only and understanding conversation context
      const strictSourceSystemPrompt = hasContext 
        ? `You are a helpful notebook assistant that answers questions based ONLY on the provided document sources.

CRITICAL RULES:
1. Use ONLY information from the provided sources to answer questions. Do not use any outside knowledge.
2. Use the conversation history to understand follow-up questions like "tell me more", "what about...", "explain further", etc.
3. When the user refers to "it", "this", "that", or similar pronouns, use the conversation history to understand what they're referring to.
4. If the sources don't contain the answer, explicitly say: "I don't have enough information in the provided sources to answer this question."
5. Do not mention system commands, shell commands, technical processes, or internal operations.
6. Cite sources using [1], [2], etc. when providing information.
7. Be direct, concise, and synthesize information rather than repeating source content verbatim.
8. Stay strictly grounded in the provided source content - do not drift to other topics.`
        : `You are a helpful notebook assistant.

IMPORTANT RULES:
1. Use the conversation history to understand follow-up questions and context.
2. When the user refers to "it", "this", "that", or similar pronouns, use the conversation history to understand what they're referring to.
3. This notebook currently has no sources loaded. Suggest the user add sources (YouTube videos, websites, PDFs, or text) for more specific answers.
4. Keep your answers conservative and acknowledge when you don't have information from notebook sources.`;

      // Build the messages array with history for context retention
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: strictSourceSystemPrompt },
        ...historyMessages, // Include conversation history
        { role: "user", content: userContent },
      ];

      console.log(`📨 Sending ${messages.length} messages to LLM (1 system + ${historyMessages.length} history + 1 current)`);

      console.log("⚡ Using single model with optimized prompts");
      console.log(`📤 Prompt config: ${promptConfig.purpose}`);
      console.log(
        `📤 Has context: ${hasContext}, Context length: ${relevantContext.length} chars`,
      );
      console.log(`📤 User content length: ${userContent.length} chars`);
      console.log(`📤 History length: ${messages.length - 2} messages`); // -2 for system and current user

      // Use ultra-fast chat completion with configured prompts
      const result = await chatCompletion({
        messages,
        stream: !!onChunk,
        onChunk,
        temperature: promptConfig.temperature,
      });

      if (result && result.trim().length > 0) {
        console.log("✅ AI response generated successfully");
        return result;
      }
    } catch (ollamaErr) {
      console.error(
        "❌ generateAIResponse: Ollama failed, falling back to simulated response:",
        ollamaErr,
      );
      console.error(
        "Error details:",
        ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr),
      );
    }
  } else {
    console.info(
      "ℹ️ Ollama disabled via environment flag (VITE_ENABLE_OLLAMA). Skipping Ollama health check.",
    );
  }

  // Fallback simulated response for environments without Ollama
  console.log("⚠️ Using fallback response (Ollama unavailable)");
  console.log("💡 To fix this:");
  console.log("   1. Make sure Ollama is installed and running");
  console.log("   2. Check http://localhost:11434 in your browser");
  console.log("   3. Verify the required models are installed");

  if (hasContext) {
    return `I apologize, but I'm having trouble connecting to the AI service (Ollama).

**What I found in your documents:**
Based on the sources in your notebook, there is relevant information about "${userMessage}".

**To get AI-powered responses:**
1. Make sure Ollama is running (visit http://localhost:11434 to check)
2. Verify the required models are installed
3. Check the browser console (F12) for detailed error messages

**Your sources contain information about:** ${searchResults
      .slice(0, 3)
      .map((r) => r.title)
      .join(", ")}

Would you like me to try again once Ollama is running?`;
  }

  // Allow general questions even without sources
  return `I'm here to help! However, I'm having trouble connecting to the AI service (Ollama).

**To fix this:**

1. **Check if Ollama is running:**
   - Visit http://localhost:11434 in your browser
   - You should see "Ollama is running"

2. **Verify the model is available:**
   \`\`\`bash
   ollama list
   \`\`\`
   Should show required models

3. **Check the browser console (F12)** for detailed error messages

4. **Restart Ollama** if needed

Once Ollama is running, I'll be able to provide intelligent responses to your questions!

**Need help?** Check the documentation in QUICK_START_OLLAMA.md`;
  } catch (outerError) {
    // CRITICAL: Catch any unhandled errors and return a safe fallback response
    // This ensures the chat never appears to fail silently
    console.error("❌ Critical error in generateAIResponse:", outerError);
    return `I encountered an error while processing your question. Please try again.

If this continues, please check:
1. Is Ollama running? Visit http://localhost:11434
2. Check the browser console (F12) for details
3. Try refreshing the page

Your question was: "${userMessage}"`;
  }
}

// Type for the expected message structure from n8n_chat_histories
interface N8nMessageFormat {
  type: "human" | "ai";
  content:
    | string
    | {
        segments: Array<{ text: string; citation_id?: number }>;
        citations: Array<{
          citation_id: number;
          source_id: string;
          source_title: string;
          source_type: string;
          page_number?: number;
          chunk_index?: number;
          excerpt?: string;
        }>;
      };
  additional_kwargs?: unknown;
  response_metadata?: unknown;
  tool_calls?: unknown[];
  invalid_tool_calls?: unknown[];
}

// Type for the AI response structure from n8n
interface N8nAiResponseContent {
  output: Array<{
    text: string;
    citations?: Array<{
      chunk_index: number;
      chunk_source_id: string;
      chunk_lines_from: number;
      chunk_lines_to: number;
    }>;
  }>;
}

const transformMessage = (
  item: LocalChatMessage,
  sourceMap: Map<string, LocalSource>,
): EnhancedChatMessage => {
  console.log("Processing item:", item);

  // Handle the message format based on your JSON examples
  let transformedMessage: EnhancedChatMessage["message"];

  // Check if message is an object and has the expected structure
  if (
    item.message &&
    typeof item.message === "object" &&
    !Array.isArray(item.message) &&
    "type" in item.message &&
    "content" in item.message
  ) {
    // Type assertion with proper checking
    const messageObj = item.message as unknown as N8nMessageFormat;

    // Check if this is an AI message with JSON content that needs parsing
    if (messageObj.type === "ai" && typeof messageObj.content === "string") {
      try {
        const parsedContent = parseJsonResponse<N8nAiResponseContent>(
          messageObj.content,
          (obj): obj is N8nAiResponseContent => {
            if (typeof obj !== 'object' || obj === null) return false;
            return Array.isArray((obj as Record<string, unknown>).output);
          }
        );

        if (parsedContent && parsedContent.output && Array.isArray(parsedContent.output)) {
          // Transform the parsed content into segments and citations
          const segments: MessageSegment[] = [];
          const citations: Citation[] = [];
          let citationIdCounter = 1;

          parsedContent.output.forEach((outputItem) => {
            // Add the text segment
            segments.push({
              text: outputItem.text,
              citation_id:
                outputItem.citations && outputItem.citations.length > 0
                  ? citationIdCounter
                  : undefined,
            });

            // Process citations if they exist
            if (outputItem.citations && outputItem.citations.length > 0) {
              outputItem.citations.forEach((citation) => {
                const sourceInfo = sourceMap.get(citation.chunk_source_id);
                citations.push({
                  citation_id: citationIdCounter,
                  source_id: citation.chunk_source_id,
                  source_title: sourceInfo?.title || "Unknown Source",
                  source_type: sourceInfo?.type || "pdf",
                  chunk_lines_from: citation.chunk_lines_from,
                  chunk_lines_to: citation.chunk_lines_to,
                  chunk_index: citation.chunk_index,
                  excerpt: `Lines ${citation.chunk_lines_from}-${citation.chunk_lines_to}`,
                });
              });
              citationIdCounter++;
            }
          });

          transformedMessage = {
            type: "ai",
            content: {
              segments,
              citations,
            },
            additional_kwargs: messageObj.additional_kwargs,
            response_metadata: messageObj.response_metadata,
            tool_calls: messageObj.tool_calls,
            invalid_tool_calls: messageObj.invalid_tool_calls,
          };
        } else {
          // Fallback for AI messages that don't match expected format
          transformedMessage = {
            type: "ai",
            content: messageObj.content,
            additional_kwargs: messageObj.additional_kwargs,
            response_metadata: messageObj.response_metadata,
            tool_calls: messageObj.tool_calls,
            invalid_tool_calls: messageObj.invalid_tool_calls,
          };
        }
      } catch (parseError) {
        console.log(
          "Failed to parse AI content as JSON, treating as plain text:",
          parseError,
        );
        // If parsing fails, treat as regular string content
        transformedMessage = {
          type: "ai",
          content: messageObj.content,
          additional_kwargs: messageObj.additional_kwargs,
          response_metadata: messageObj.response_metadata,
          tool_calls: messageObj.tool_calls,
          invalid_tool_calls: messageObj.invalid_tool_calls,
        };
      }
    } else {
      // Handle non-AI messages or AI messages that don't need parsing
      transformedMessage = {
        type: messageObj.type === "human" ? "human" : "ai",
        content: messageObj.content || "Empty message",
        additional_kwargs: messageObj.additional_kwargs,
        response_metadata: messageObj.response_metadata,
        tool_calls: messageObj.tool_calls,
        invalid_tool_calls: messageObj.invalid_tool_calls,
      };
    }
  } else if (typeof item.message === "string") {
    // Handle case where message is just a string
    transformedMessage = {
      type: "human",
      content: item.message,
    };
  } else {
    // Fallback for any other cases
    transformedMessage = {
      type: "human",
      content: "Unable to parse message",
    };
  }

  console.log("Transformed message:", transformedMessage);

  return {
    id: item.id,
    notebook_id: item.notebook_id,
    // session_id is not present on the LocalChatMessage shape in localStorage,
    // include created_at so callers can access the timestamp stored locally.
    message: transformedMessage,
    created_at: item.created_at,
  };
};

export const useChatMessages = (notebookId?: string) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: messages = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["chat-messages", notebookId],
    queryFn: async () => {
      if (!notebookId) return [];

      // Fetch chat messages from local storage
      const storedMessages = localStorageService.getChatMessages(notebookId);

      // Fetch sources to get proper source titles
      const sources = localStorageService.getSources(notebookId);
      const sourceMap = new Map(sources.map((s) => [s.id, s]));

      console.log("Messages from local storage:", storedMessages);
      console.log("Sources map:", sourceMap);

      // Each stored message contains both user question and AI response
      // We need to expand them into separate messages for display
      const expandedMessages: EnhancedChatMessage[] = [];

      storedMessages.forEach((item) => {
        // Create user message if there's a message field
        if (
          item.message &&
          typeof item.message === "string" &&
          item.message.trim()
        ) {
          expandedMessages.push({
            id: `${item.id}-user`,
            notebook_id: item.notebook_id,
            message: {
              type: "human",
              content: item.message,
            },
            created_at: item.created_at,
          });
        }

        // Create AI message if there's a response field
        if (item.response && item.response.trim()) {
          expandedMessages.push({
            id: `${item.id}-ai`,
            notebook_id: item.notebook_id,
            message: {
              type: "ai",
              content: item.response,
            },
            created_at: item.created_at,
          });
        }
      });

      console.log("Expanded messages:", expandedMessages);

      return expandedMessages;
    },
    enabled: !!notebookId && !!user,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });

  // Refresh messages when notebook or user changes
  useEffect(() => {
    if (!notebookId || !user) return;

    console.log("Refreshing messages for notebook:", notebookId);

    // Invalidate queries to refetch messages
    queryClient.invalidateQueries({ queryKey: ["chat-messages", notebookId] });
  }, [notebookId, user, queryClient]);

  const sendMessage = useMutation({
    mutationFn: async (messageData: {
      notebookId: string;
      role: "user" | "assistant";
      content: string;
    }) => {
      if (!user) throw new Error("User not authenticated");

      console.log("💬 Sending message to AI...");

      // Generate AI response first
      let aiResponse = await generateAIResponse(
        messageData.content,
        user,
        messageData.notebookId,
      );

      console.log("✅ AI response received, saving conversation pair...");

      // Validate the AI response for citations and hallucinations before storing
      // First, get the sources for this notebook to validate citations
      const sources = localStorageService.getSources(messageData.notebookId);
      const sourcesForValidation = sources.map(s => ({
        id: s.id,
        title: s.title,
        content: s.content || ""
      }));

      try {
        // Validate citations
        const citationValidation = await validateCitations(aiResponse, sourcesForValidation, false);

        // Validate overall AI response for hallucinations
        const sourceContents = sourcesForValidation.map(s => s.content);
        const aiValidation = await validateAIResponse(aiResponse, sourceContents, messageData.content);

        // Combine validations to make the response more reliable
        if (!citationValidation.isValid && citationValidation.issues.length > 0) {
          console.warn("Citation validation issues:", citationValidation.issues);

          // Add citation-related warnings to the response
          if (citationValidation.issues.some(issue => issue.includes("does not match any available source"))) {
            const warningMessage = "\n\n⚠️ Note: Some citations in this response may not correspond to available sources in your notebook.";
            aiResponse += warningMessage;
          }
        }

        if (aiValidation.hallucinationRisk !== 'low') {
          console.warn(`AI response validation issues - Risk: ${aiValidation.hallucinationRisk}`, aiValidation.issues);

          // Add hallucination risk warning to the response
          if (aiValidation.issues.length > 0) {
            const hallucinationWarning = `\n\n⚠️ Note: This response has a ${aiValidation.hallucinationRisk} hallucination risk. Please verify important information directly from your sources.`;
            aiResponse += hallucinationWarning;
          }
        }
      } catch (validationError) {
        console.error("Response validation failed:", validationError);
        // Continue without validation if it fails
      }

      // Create ONE message pair with both user question and AI response
      // This creates a conversation pair that will be split into two messages by transformMessage
      const conversationPair = localStorageService.createChatMessage({
        notebook_id: messageData.notebookId,
        message: messageData.content, // User's question as string
        response: aiResponse, // AI's response as string
      });

      // Invalidate queries to refresh messages
      queryClient.invalidateQueries({
        queryKey: ["chat-messages", messageData.notebookId],
      });

      console.log("✅ Conversation pair saved successfully");

      return { conversationPair };
    },
    onSuccess: () => {
      console.log("✅ Chat message flow completed successfully");
    },
    onError: (error) => {
      console.error("❌ Chat message error:", error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteChatHistory = useMutation({
    mutationFn: async (notebookId: string) => {
      if (!user) throw new Error("User not authenticated");

      console.log("Deleting chat history for notebook:", notebookId);

      // Get all messages for this notebook and delete them
      const messages = localStorageService.getChatMessages(notebookId);

      // Delete each message
      for (const message of messages) {
        localStorageService.deleteChatMessage(message.id);
      }

      console.log("Chat history deleted successfully");
      return notebookId;
    },
    onSuccess: (notebookId) => {
      console.log("Chat history cleared for notebook:", notebookId);
      toast({
        title: "Chat history cleared",
        description: "All messages have been deleted successfully.",
      });

      // Clear the query data and refetch to confirm
      queryClient.setQueryData(["chat-messages", notebookId], []);
      queryClient.invalidateQueries({
        queryKey: ["chat-messages", notebookId],
      });
    },
    onError: (error) => {
      console.error("Failed to delete chat history:", error);
      toast({
        title: "Error",
        description: "Failed to clear chat history. Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    messages,
    isLoading,
    error,
    sendMessage: sendMessage.mutate,
    sendMessageAsync: sendMessage.mutateAsync,
    isSending: sendMessage.isPending,
    deleteChatHistory: deleteChatHistory.mutate,
    isDeletingChatHistory: deleteChatHistory.isPending,
  };
};
