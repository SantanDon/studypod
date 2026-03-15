import { localStorageService } from "@/services/localStorageService";
import { ChatRole } from "@/types/message";

/**
 * Build recent chat history messages for context retention
 * This allows the AI to understand follow-up questions like "tell me more"
 */
export function buildChatHistoryMessages(
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

  return history;
}
