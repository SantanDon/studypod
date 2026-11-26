import { sql } from "drizzle-orm";
import { chatMessages } from "./schema.js";

export function insertChatTurn(db, notebookId, userId, turn) {
  // Older rows use whole Unix seconds. Reserve two consecutive milliseconds after
  // the previous turn inside the write, so simultaneous turns reopen in pairs.
  const firstMillisecond = sql`(SELECT MAX(${Date.now()}, COALESCE(ROUND(MAX(created_at) * 1000), 0) + 1)
    FROM chat_messages WHERE notebook_id = ${notebookId})`;
  return db.insert(chatMessages).values([
    {
      id: turn.questionId, notebookId, userId, role: turn.role, content: turn.question,
      createdAt: sql`${firstMillisecond} / 1000.0`,
    },
    {
      id: turn.answerId, notebookId, userId, role: "assistant", content: turn.answer,
      groundedSources: turn.groundedSources == null ? null : JSON.stringify(turn.groundedSources),
      createdAt: sql`(${firstMillisecond} + 1) / 1000.0`,
    },
  ]);
}
