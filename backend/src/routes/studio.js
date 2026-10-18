import express from 'express';
import { authenticateToken, requireSessionCredential } from '../middleware/auth.js';
import { studioRepository } from '../services/studioRepository.js';
import { logger } from '../utils/logger.js';

export function createStudioRouter(repository = studioRepository) {
  const router = express.Router();
  router.use(authenticateToken, requireSessionCredential);
  const run = (operation, key, status = 200) => async (req, res) => {
    try {
      const value = await operation(req);
      res.status(status).json(key ? { [key]: value } : value);
    } catch (error) {
      const status = { STUDIO_NOT_FOUND: 404, STUDIO_INVALID_PAYLOAD: 422, STUDIO_VERSION_CONFLICT: 409, STUDIO_ATTEMPT_CONFLICT: 409 }[error.code] || 500;
      if (status === 500) logger.error('[Studio] Operation failed:', error);
      res.status(status).json({ error: status === 500 ? 'Studio operation failed.' : error.message, code: status === 500 ? 'STUDIO_OPERATION_FAILED' : error.code, ...(error.currentVersion ? { currentVersion: error.currentVersion } : {}) });
    }
  };
  const args = req => [req.params.id, req.user.userId || req.user.id];
  router.get('/:id/studio/maps', run(req => repository.listMaps(...args(req)), 'maps'));
  router.post('/:id/studio/maps', run(req => repository.createMap(...args(req), req.body ?? {}), 'map', 201));
  router.get('/:id/studio/maps/:mapId', run(req => repository.getMap(...args(req), req.params.mapId), 'map'));
  router.delete('/:id/studio/maps/:mapId', run(req => repository.deleteMap(...args(req), req.params.mapId)));
  router.get('/:id/studio/decks', run(req => repository.listDecks(...args(req)), 'decks'));
  router.post('/:id/studio/decks', run(req => repository.createDeck(...args(req), req.body ?? {}), 'deck', 201));
  router.get('/:id/studio/decks/:deckId', run(req => repository.getDeck(...args(req), req.params.deckId), 'deck'));
  router.put('/:id/studio/decks/:deckId', run(req => repository.updateDeck(...args(req), req.params.deckId, req.body ?? {}), 'deck'));
  router.delete('/:id/studio/decks/:deckId', run(req => repository.deleteDeck(...args(req), req.params.deckId)));
  router.get('/:id/studio/quizzes', run(req => repository.listQuizzes(...args(req)), 'quizzes'));
  router.post('/:id/studio/quizzes', run(req => repository.createQuiz(...args(req), req.body ?? {}), 'quiz', 201));
  router.get('/:id/studio/quizzes/:quizId', run(req => repository.getQuiz(...args(req), req.params.quizId), 'quiz'));
  router.get('/:id/studio/attempts', run(req => repository.listAttempts(...args(req)), 'attempts'));
  router.post('/:id/studio/quizzes/:quizId/attempts', run(req => repository.completeAttempt(...args(req), req.params.quizId, req.body ?? {}), 'attempt'));
  return router;
}
export default createStudioRouter();
