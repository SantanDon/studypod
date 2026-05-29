/**
 * Signal Queue Routes
 *
 * REST API for managing the social post staging queue.
 * Agents poll this to find approved posts ready to fire.
 * Users review drafts, approve or edit, and track posted content.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbHelpers } from '../db/database.js';
import { authenticateToken, requireScope } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.use(authenticateToken);

/**
 * GET /api/signal-queue
 * List signal queue items for the authenticated user.
 * Query params: status, platform, notebookId, limit
 */
router.get('/', requireScope('notebooks:read'), async (req, res) => {
  try {
    const { status, platform, notebookId, limit } = req.query;
    const items = await dbHelpers.getSignalQueueByUserId(req.user.userId, {
      status,
      platform,
      notebookId,
      limit: limit ? parseInt(limit, 10) : 50
    });
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Signal queue list error:', error);
    res.status(500).json({ error: 'Failed to list signal queue' });
  }
});

/**
 * GET /api/signal-queue/stats
 * Get a breakdown of queue items by status and platform.
 * Useful for the dashboard widget.
 */
router.get('/stats', requireScope('notebooks:read'), async (req, res) => {
  try {
    const stats = await dbHelpers.getSignalQueueStats(req.user.userId);
    res.json({ stats });
  } catch (error) {
    logger.error('Signal queue stats error:', error);
    res.status(500).json({ error: 'Failed to get signal queue stats' });
  }
});

/**
 * POST /api/signal-queue
 * Manually create a signal queue entry (draft).
 * Body: { notebookId, platform, content, sourceId?, scheduledFor?, noteId? }
 */
router.post('/', requireScope('notes:create'), async (req, res) => {
  try {
    const { notebookId, platform, content, sourceId, tweetSourceId, scheduledFor, noteId } = req.body;

    if (!platform || !content) {
      return res.status(400).json({ error: 'platform and content are required' });
    }

    const validPlatforms = ['linkedin', 'twitter', 'reddit', 'threads'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${validPlatforms.join(', ')}` });
    }

    const id = uuidv4();
    await dbHelpers.createSignalQueueItem(
      id, req.user.userId, notebookId || null, platform, content,
      sourceId || null, tweetSourceId || null, scheduledFor || null, noteId || null
    );

    res.status(201).json({ id, platform, content, status: 'draft', notebookId });
  } catch (error) {
    logger.error('Signal queue create error:', error);
    res.status(500).json({ error: 'Failed to create signal queue item' });
  }
});

/**
 * GET /api/signal-queue/:id
 * Get a single signal queue item by ID.
 */
router.get('/:id', requireScope('notebooks:read'), async (req, res) => {
  try {
    const item = await dbHelpers.getSignalQueueItemById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Signal queue item not found' });
    if (item.user_id !== req.user.userId) return res.status(403).json({ error: 'Access denied' });
    res.json(item);
  } catch (error) {
    logger.error('Signal queue get error:', error);
    res.status(500).json({ error: 'Failed to get signal queue item' });
  }
});

/**
 * PUT /api/signal-queue/:id
 * Update a signal queue item (edit content, change status, set schedule).
 *
 * Agent workflow:
 *   - Approve: { status: 'approved' }
 *   - Mark posted: { status: 'posted', posted_at: '2026-06-01T09:00:00Z' }
 *   - Archive: { status: 'archived' }
 *   - Edit + schedule: { content: '...', scheduled_for: '2026-06-01T09:00:00Z', status: 'approved' }
 */
router.put('/:id', requireScope('notes:create'), async (req, res) => {
  try {
    const item = await dbHelpers.getSignalQueueItemById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Signal queue item not found' });
    if (item.user_id !== req.user.userId) return res.status(403).json({ error: 'Access denied' });

    const validStatuses = ['draft', 'approved', 'posted', 'archived'];
    if (req.body.status && !validStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    await dbHelpers.updateSignalQueueItem(req.params.id, req.user.userId, req.body);
    const updated = await dbHelpers.getSignalQueueItemById(req.params.id);
    res.json(updated);
  } catch (error) {
    logger.error('Signal queue update error:', error);
    res.status(500).json({ error: 'Failed to update signal queue item' });
  }
});

/**
 * DELETE /api/signal-queue/:id
 * Permanently remove a signal queue item.
 */
router.delete('/:id', requireScope('notes:create'), async (req, res) => {
  try {
    const item = await dbHelpers.getSignalQueueItemById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Signal queue item not found' });
    if (item.user_id !== req.user.userId) return res.status(403).json({ error: 'Access denied' });

    const result = await dbHelpers.deleteSignalQueueItem(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Item not found or already deleted' });
    res.json({ message: 'Signal queue item deleted' });
  } catch (error) {
    logger.error('Signal queue delete error:', error);
    res.status(500).json({ error: 'Failed to delete signal queue item' });
  }
});

export default router;
