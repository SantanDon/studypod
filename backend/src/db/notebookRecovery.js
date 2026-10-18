import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

// Recovery must never replace or claim a notebook already owned by someone.
// The preflight avoids unnecessary writes; the targeted conflict clause closes
// the race between this read and concurrent notebook creation/recovery.
export async function recoverNotebookIfAbsent(db, id, userId, title, description, joinCode) {
  const existing = await db.select({ id: schema.notebooks.id })
    .from(schema.notebooks).where(eq(schema.notebooks.id, id)).limit(1);
  if (existing.length) return;
  await db.insert(schema.notebooks).values({ id, userId, title, description, joinCode })
    .onConflictDoNothing({ target: schema.notebooks.id });
}
