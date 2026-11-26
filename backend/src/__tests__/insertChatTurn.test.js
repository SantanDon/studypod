// @vitest-environment node
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, expect, it } from "vitest";
import { insertChatTurn } from "../db/insertChatTurn.js";
import { chatMessages } from "../db/schema.js";
import { sortChatMessages } from "../utils/chatMessageOrdering.js";

let client, db;
const turn = { questionId: "question", answerId: "answer", role: "agent", question: "Where?", answer: "Here",
  groundedSources: { version: 1, citations: [], sourceIds: ["source"] } };
beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  db = drizzle(client);
  await client.execute("CREATE TABLE chat_messages (id TEXT PRIMARY KEY, notebook_id TEXT, user_id TEXT, role TEXT, content TEXT NOT NULL, grounded_sources TEXT, created_at INTEGER)");
});
afterEach(() => client.close());

it("rolls back the question when the answer row fails and permits a complete retry", async () => {
  await expect(insertChatTurn(db, "book", "owner", { ...turn, answer: null })).rejects.toThrow();
  expect(await db.select().from(chatMessages)).toEqual([]);
  await insertChatTurn(db, "book", "owner", turn);
  const rows = sortChatMessages(await db.select().from(chatMessages));
  expect(rows.map(row => row.role)).toEqual(["agent", "assistant"]);
  expect(JSON.parse(rows[1].groundedSources)).toEqual(turn.groundedSources);
});

it("keeps concurrent agent and user questions adjacent to their answers", async () => {
  await Promise.all(Array.from({ length: 12 }, (_, index) => insertChatTurn(db, "book", "owner", {
    ...turn, questionId: "q" + index, answerId: "a" + index, role: index % 2 ? "user" : "agent",
  })));
  const rows = sortChatMessages(await db.select().from(chatMessages));
  expect(rows).toHaveLength(24);
  for (let i = 0; i < rows.length; i += 2) {
    expect(rows[i + 1].id).toBe("a" + rows[i].id.slice(1));
    expect(rows[i + 1].createdAt.getTime()).toBeGreaterThan(rows[i].createdAt.getTime());
  }
});
