import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { agentPulse } from '../services/agentPulse.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

let currentPulse = {
  status: 'idle', // idle, coding, building, verifying
  thought: 'Antigravity 2.0 connected. Awaiting tasks...',
  activeTask: 'No active task',
  lastTool: 'none',
  checklist: [], // Array of { text: string, status: 'todo' | 'doing' | 'done' }
  timestamp: new Date().toISOString()
};

router.post('/pulse', async (req, res) => {
  try {
    const { status, thought, activeTask, lastTool, checklist } = req.body;
    
    currentPulse = {
      status: status || currentPulse.status,
      thought: thought || currentPulse.thought,
      activeTask: activeTask || currentPulse.activeTask,
      lastTool: lastTool || currentPulse.lastTool,
      checklist: checklist || currentPulse.checklist,
      timestamp: new Date().toISOString()
    };
    
    // Broadcast thought to the main notebook activity log if notebookId is provided
    if (thought && req.user) {
      const userId = req.user.userId || req.user.id;
      const { notebookId } = req.body;
      if (notebookId) {
        await agentPulse.broadcastThought(userId, notebookId, `💻 [Antigravity 2.0] ${thought}`);
      }
    }
    
    res.json({ success: true, pulse: currentPulse });
  } catch (error) {
    logger.error('Failed to update Antigravity pulse:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/pulse', (req, res) => {
  res.json({ success: true, pulse: currentPulse });
});

export default router;
