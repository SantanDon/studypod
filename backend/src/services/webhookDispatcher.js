import { dbHelpers } from '../db/database.js';
import { logger } from '../utils/logger.js';

const EVENT_TYPES = [
  'note.created',
  'source.added',
  'chat.message',
  'agent.thought',
  'mission.started',
  'mission.ended',
  'task.created',
  'task.completed'
];

async function dispatchWebhook(notebookId, eventType, payload) {
  try {
    const webhooks = await dbHelpers.getWebhooksByNotebookId(notebookId);
    const matching = webhooks.filter(w => {
      try {
        const events = JSON.parse(w.eventsJson || '[]');
        return events.includes('*') || events.includes(eventType);
      } catch {
        return false;
      }
    });

    if (matching.length === 0) return { dispatched: 0 };

    const body = JSON.stringify({
      event: eventType,
      notebookId,
      timestamp: new Date().toISOString(),
      payload
    });

    const results = await Promise.allSettled(
      matching.map(async (wh) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(wh.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'StudyPodLM-Webhook/1.0' },
            body,
            signal: controller.signal
          });
          clearTimeout(timeout);
          if (!res.ok) {
            logger.warn(`Webhook ${wh.id} returned ${res.status} for ${eventType}`);
          }
          return { webhookId: wh.id, status: res.status };
        } catch (err) {
          logger.warn(`Webhook ${wh.id} failed for ${eventType}: ${err.message}`);
          return { webhookId: wh.id, error: err.message };
        }
      })
    );

    return { dispatched: matching.length, results };
  } catch (error) {
    logger.error(`Webhook dispatch error for ${eventType}:`, error.message);
    return { dispatched: 0, error: error.message };
  }
}

function recordActivityAndNotify(notebookId, userId, actor, actionType, contentPreview) {
  dbHelpers.createActivityLog(notebookId, userId, actor, actionType, contentPreview).catch(() => {});
  dispatchWebhook(notebookId, actionType.replace(/_/g, '.'), {
    actor,
    contentPreview,
    userId
  }).catch(() => {});
}

export const WebhookDispatcher = {
  EVENT_TYPES,
  dispatchWebhook,
  recordActivityAndNotify
};

export default WebhookDispatcher;
