import { and, eq } from 'drizzle-orm';
import * as schema from './schema.js';

// Artifact IDs currently represent saved notes or completed mission results.
// Keep lookup and linking in one transaction so deleted/foreign artifacts cannot be linked.
export function createGoalArtifactRepository(getDatabase) {
  return {
    async linkArtifactToGoal(goalId, artifactId, notebookId, userId) {
      if (![goalId, artifactId, notebookId, userId].every(value => typeof value === 'string' && value.trim())) return null;
      const db = await getDatabase();
      return db.transaction(async tx => {
        const goalScope = and(eq(schema.researchGoals.id, goalId), eq(schema.researchGoals.notebookId, notebookId), eq(schema.researchGoals.userId, userId));
        const [goal] = await tx.select().from(schema.researchGoals).where(goalScope).limit(1);
        if (!goal) return null;
        const [note] = await tx.select({ id: schema.notes.id }).from(schema.notes).where(and(
          eq(schema.notes.id, artifactId), eq(schema.notes.notebookId, notebookId), eq(schema.notes.userId, userId),
        )).limit(1);
        if (!note) {
          const [mission] = await tx.select({ result: schema.agentMissions.result }).from(schema.agentMissions).where(and(
            eq(schema.agentMissions.id, artifactId), eq(schema.agentMissions.notebookId, notebookId), eq(schema.agentMissions.userId, userId), eq(schema.agentMissions.status, 'completed'),
          )).limit(1);
          if (!mission || typeof mission.result !== 'string' || !mission.result.trim()) return null;
        }
        const linkedArtifactIds = JSON.parse(goal.linkedArtifactIds || '[]');
        if (!Array.isArray(linkedArtifactIds)) throw new Error('Invalid goal artifact list');
        const ids = [...new Set([...linkedArtifactIds, artifactId])];
        await tx.update(schema.researchGoals).set({ linkedArtifactIds: JSON.stringify(ids), lastActivityAt: new Date(), updatedAt: new Date() }).where(goalScope);
        const [updated] = await tx.select().from(schema.researchGoals).where(goalScope).limit(1);
        return { ...updated, linkedTaskIds: JSON.parse(updated.linkedTaskIds || '[]'), linkedArtifactIds: JSON.parse(updated.linkedArtifactIds || '[]') };
      });
    },
  };
}
