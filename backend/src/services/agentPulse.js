import { dbHelpers } from '../db/database.js';
import { logger } from '../utils/logger.js';

class AgentPulse {
  constructor() {
    this.activeMissions = new Map();
  }

  async broadcastThought(userId, notebookId, thought) {
    if (!userId || !notebookId || !thought) return;

    logger.debug(`[Pulse] Broadcasting thought for Notebook ${notebookId}: "${thought.slice(0, 60)}..."`);

    try {
      await dbHelpers.createActivityLog(
        notebookId,
        userId,
        'agent',
        'agent_thought',
        thought.slice(0, 200)
      );
    } catch (error) {
      logger.error('[Pulse] Failed to broadcast thought:', error.message);
    }
  }

  async startMission(userId, notebookId, mission) {
    const missionKey = `${userId}:${notebookId}`;
    this.activeMissions.set(missionKey, {
      mission,
      startedAt: new Date(),
      thoughtCount: 0,
    });
    await this.broadcastThought(userId, notebookId, `🧠 Beginning mission: ${mission}`);
  }

  async endMission(userId, notebookId) {
    const missionKey = `${userId}:${notebookId}`;
    const mission = this.activeMissions.get(missionKey);
    if (mission) {
      await this.broadcastThought(
        userId,
        notebookId,
        `✅ Mission complete: "${mission.mission}" — ${mission.thoughtCount} insights shared`
      );
      this.activeMissions.delete(missionKey);
    }
  }

  getActiveMissions(userId) {
    const missions = [];
    for (const [key, value] of this.activeMissions) {
      if (key.startsWith(`${userId}:`)) {
        missions.push({
          notebookId: key.split(':')[1],
          ...value,
        });
      }
    }
    return missions;
  }
}

export const agentPulse = new AgentPulse();
