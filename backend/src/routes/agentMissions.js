import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbHelpers } from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { agentPulse } from '../services/agentPulse.js';
import { WebhookDispatcher } from '../services/webhookDispatcher.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.use(authenticateToken);

// ─── Agent Missions ───────────────────────────────────────────

router.post('/missions', async (req, res) => {
  try {
    const { notebookId, goal, cron = null, maxNotes = 5 } = req.body;
    if (!notebookId || !goal) {
      return res.status(400).json({ error: 'notebookId and goal are required' });
    }

    const id = uuidv4();
    await dbHelpers.createAgentMission(id, req.user.userId, notebookId, goal, cron, maxNotes);

    await agentPulse.startMission(req.user.userId, notebookId, goal);
    WebhookDispatcher.recordActivityAndNotify(notebookId, req.user.userId, req.user.displayName || 'agent', 'mission.started', goal.substring(0, 100));

    res.status(201).json({ id, notebookId, goal, cron, maxNotes, status: 'active' });
  } catch (error) {
    logger.error('Create mission error:', error);
    res.status(500).json({ error: 'Failed to create mission' });
  }
});

router.get('/missions', async (req, res) => {
  try {
    const { notebookId } = req.query;
    let missions;
    if (notebookId) {
      missions = await dbHelpers.getAgentMissionsByNotebookId(notebookId);
    } else {
      missions = await dbHelpers.getAgentMissionsByUserId(req.user.userId);
    }
    res.json({ missions });
  } catch (error) {
    logger.error('List missions error:', error);
    res.status(500).json({ error: 'Failed to list missions' });
  }
});

router.get('/missions/:id', async (req, res) => {
  try {
    const mission = await dbHelpers.getAgentMissionById(req.params.id);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });
    res.json(mission);
  } catch (error) {
    logger.error('Get mission error:', error);
    res.status(500).json({ error: 'Failed to get mission' });
  }
});

router.put('/missions/:id', async (req, res) => {
  try {
    const { status, goal, cron, maxNotes } = req.body;
    const updates = {};
    if (status) updates.status = status;
    if (goal) updates.goal = goal;
    if (cron !== undefined) updates.cron = cron;
    if (maxNotes) updates.maxNotes = maxNotes;

    const mission = await dbHelpers.getAgentMissionById(req.params.id);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    if (status === 'completed') {
      await agentPulse.endMission(mission.userId, mission.notebookId);
      WebhookDispatcher.recordActivityAndNotify(mission.notebookId, mission.userId, req.user.displayName || 'agent', 'mission.ended', mission.goal.substring(0, 100));
    }

    await dbHelpers.updateAgentMission(req.params.id, updates);
    res.json({ message: 'Mission updated' });
  } catch (error) {
    logger.error('Update mission error:', error);
    res.status(500).json({ error: 'Failed to update mission' });
  }
});

router.delete('/missions/:id', async (req, res) => {
  try {
    const mission = await dbHelpers.getAgentMissionById(req.params.id);
    if (mission) {
      await agentPulse.endMission(mission.userId, mission.notebookId);
    }
    await dbHelpers.deleteAgentMission(req.params.id);
    res.json({ message: 'Mission deleted' });
  } catch (error) {
    logger.error('Delete mission error:', error);
    res.status(500).json({ error: 'Failed to delete mission' });
  }
});

// ─── Agent-to-Agent Messaging ─────────────────────────────────

router.post('/messages', async (req, res) => {
  try {
    const { notebookId, content, toAgentId = null, messageType = 'thought', subject = null } = req.body;
    if (!notebookId || !content) {
      return res.status(400).json({ error: 'notebookId and content are required' });
    }

    const id = uuidv4();
    await dbHelpers.createAgentMessage(id, notebookId, req.user.userId, content, toAgentId, messageType, subject);

    WebhookDispatcher.recordActivityAndNotify(notebookId, req.user.userId, req.user.displayName || 'agent', `${messageType}.sent`, content.substring(0, 100));

    res.status(201).json({ id, messageType, subject, toAgentId });
  } catch (error) {
    logger.error('Send agent message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.get('/messages', async (req, res) => {
  try {
    const { notebookId } = req.query;
    if (!notebookId) return res.status(400).json({ error: 'notebookId query param is required' });

    const messages = await dbHelpers.getAgentMessages(notebookId, req.user.userId);
    res.json({ messages });
  } catch (error) {
    logger.error('List agent messages error:', error);
    res.status(500).json({ error: 'Failed to list messages' });
  }
});

router.put('/messages/:id/read', async (req, res) => {
  try {
    await dbHelpers.markAgentMessageRead(req.params.id);
    res.json({ message: 'Message marked as read' });
  } catch (error) {
    logger.error('Mark message read error:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

// ─── Agent Dashboard ──────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.user.userId;
    const [missions, apiKeys, unreadMessages] = await Promise.all([
      dbHelpers.getAgentMissionsByUserId(userId),
      dbHelpers.listApiKeys(userId),
      dbHelpers.getUnreadAgentMessageCount(userId)
    ]);

    const user = await dbHelpers.getUserById(userId);
    let byok = null;
    if (user?.apiKeys) {
      try { byok = typeof user.apiKeys === 'string' ? JSON.parse(user.apiKeys) : user.apiKeys; } catch {}
    }

    res.json({
      activeMissions: missions.filter(m => m.status === 'active').length,
      totalMissions: missions.length,
      apiKeyCount: apiKeys.length,
      unreadMessages,
      byokConfigured: byok ? Object.keys(byok).filter(k => byok[k]).length : 0,
      missions: missions.map(m => ({
        id: m.id,
        notebookId: m.notebookId,
        goal: m.goal,
        status: m.status,
        lastRunAt: m.lastRunAt,
        nextRunAt: m.nextRunAt,
        createdAt: m.createdAt
      })),
      apiKeys: apiKeys.map(k => ({
        id: k.id,
        prefix: k.prefix,
        label: k.label,
        scopes: k.scopes,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt
      }))
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to build dashboard' });
  }
});

// ─── SSE Thought Stream ───────────────────────────────────────

const sseClients = new Map();

router.get('/stream', (req, res) => {
  const userId = req.user.userId;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`);

  if (!sseClients.has(userId)) {
    sseClients.set(userId, []);
  }
  sseClients.get(userId).push(res);

  req.on('close', () => {
    const clients = sseClients.get(userId) || [];
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
    if (clients.length === 0) sseClients.delete(userId);
  });
});

export function broadcastToUser(userId, event) {
  const clients = sseClients.get(userId) || [];
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try { client.write(data); } catch {}
  }
}

export default router;
