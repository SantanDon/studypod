import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as schema from './schema.js';

// Existing installations use runtime compatibility bootstraps, including remote Turso.
export async function ensureSuggestedGoalSchema(db) {
  const columns = await db.all(sql`PRAGMA table_info(signal_queue_suggestions)`);
  if (!columns.some(column => column.name === 'accepted_goal_id')) {
    await db.run(sql`ALTER TABLE signal_queue_suggestions ADD COLUMN accepted_goal_id text REFERENCES research_goals(id) ON DELETE SET NULL`);
  }
}

export function createSuggestedGoalsRepository(getDatabase) {
  const scope = (sourceId, notebookId, userId) => and(
    eq(schema.signalQueueSuggestions.sourceId, sourceId),
    eq(schema.signalQueueSuggestions.notebookId, notebookId),
    eq(schema.signalQueueSuggestions.userId, userId),
  );
  return {
    async upsertSignalQueueSuggestion({ id, sourceId, notebookId, userId, title, rationale, sourceChunkIndices = [], confidence = 0.5, status = 'pending' }) {
      const db = await getDatabase();
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(schema.signalQueueSuggestions)
          .where(and(scope(sourceId, notebookId, userId), eq(schema.signalQueueSuggestions.title, title))).limit(1);
        const values = { rationale, sourceChunkIndices: JSON.stringify(sourceChunkIndices), confidence };
        if (existing) {
          await tx.update(schema.signalQueueSuggestions).set({ ...values, status: existing.status === 'accepted' || existing.status === 'dismissed' ? existing.status : status })
            .where(eq(schema.signalQueueSuggestions.id, existing.id));
          return existing.id;
        }
        const suggestionId = id || `sug-${randomUUID()}`;
        await tx.insert(schema.signalQueueSuggestions).values({ id: suggestionId, sourceId, notebookId, userId, title, ...values, status });
        return suggestionId;
      });
    },
    async getSignalQueueSuggestionsBySource(sourceId, notebookId, userId) {
      if (!sourceId || !notebookId || !userId) return [];
      const db = await getDatabase();
      return db.select().from(schema.signalQueueSuggestions).where(scope(sourceId, notebookId, userId))
        .orderBy(desc(schema.signalQueueSuggestions.confidence), desc(schema.signalQueueSuggestions.createdAt));
    },
    async acceptSignalQueueSuggestion(sourceId, notebookId, userId, suggestionId) {
      const db = await getDatabase();
      return db.transaction(async tx => {
        const [source] = await tx.select({ id: schema.sources.id }).from(schema.sources).where(and(
          eq(schema.sources.id, sourceId), eq(schema.sources.notebookId, notebookId), eq(schema.sources.userId, userId),
        )).limit(1);
        if (!source) return null;
        const [suggestion] = await tx.select().from(schema.signalQueueSuggestions)
          .where(and(scope(sourceId, notebookId, userId), eq(schema.signalQueueSuggestions.id, suggestionId))).limit(1);
        if (!suggestion || suggestion.status === 'dismissed') return null;
        if (suggestion.acceptedGoalId) {
          const [goal] = await tx.select().from(schema.researchGoals).where(and(
            eq(schema.researchGoals.id, suggestion.acceptedGoalId), eq(schema.researchGoals.notebookId, notebookId), eq(schema.researchGoals.userId, userId),
          )).limit(1);
          if (goal) return { goal, created: false };
        }
        let indices = [];
        try { indices = typeof suggestion.sourceChunkIndices === 'string' ? JSON.parse(suggestion.sourceChunkIndices) : suggestion.sourceChunkIndices; } catch { /* malformed legacy JSON has no usable citation */ }
        const firstIndex = Array.isArray(indices) ? indices.find(value => Number.isInteger(value) && value >= 0) : undefined;
        const goalId = `goal-${randomUUID()}`;
        await tx.insert(schema.researchGoals).values({ id: goalId, notebookId, userId, title: suggestion.title,
          description: suggestion.rationale, sourceId, sourceChunkId: firstIndex === undefined ? null : String(firstIndex), status: 'active', priority: 'medium' });
        await tx.update(schema.signalQueueSuggestions).set({ status: 'accepted', acceptedGoalId: goalId })
          .where(and(scope(sourceId, notebookId, userId), eq(schema.signalQueueSuggestions.id, suggestionId)));
        const [goal] = await tx.select().from(schema.researchGoals).where(eq(schema.researchGoals.id, goalId));
        return { goal, created: true };
      });
    },
  };
}
