import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbHelpers } from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';
import bcrypt from 'bcrypt';
import { AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get current user profile
router.get('/profile', async (req, res, next) => {
  try {
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return next(new AppError(404, 'NOT_FOUND', 'User not found'));
    }

    const preferences = await dbHelpers.getUserPreferences(user.id);
    const stats = await dbHelpers.getUserStats(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      },
      preferences,
      stats
    });
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.put('/profile', async (req, res, next) => {
  try {
    const { displayName, bio, avatarUrl } = req.body;
    const updates = {};

    if (displayName !== undefined) updates.display_name = displayName;
    if (bio !== undefined) updates.bio = bio;
    if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;

    if (Object.keys(updates).length === 0) {
      return next(new AppError(400, 'BAD_REQUEST', 'No updates provided'));
    }

    await dbHelpers.updateUser(req.user.userId, updates);

    const user = await dbHelpers.getUserById(req.user.userId);
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        updatedAt: user.updated_at
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user preferences
router.get('/preferences', async (req, res, next) => {
  try {
    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    if (!preferences) {
      return next(new AppError(404, 'NOT_FOUND', 'Preferences not found'));
    }
    res.json(preferences);
  } catch (error) {
    next(error);
  }
});

// Update user preferences
router.put('/preferences', async (req, res, next) => {
  try {
    const {
      theme,
      accentColor,
      compactMode,
      defaultModel,
      aiTemperature,
      autoTitleGeneration,
      showExampleQuestions,
      emailNotifications,
      browserNotifications
    } = req.body;

    const updates = {};

    if (theme !== undefined) updates.theme = theme;
    if (accentColor !== undefined) updates.accent_color = accentColor;
    if (compactMode !== undefined) updates.compact_mode = compactMode ? 1 : 0;
    if (defaultModel !== undefined) updates.default_model = defaultModel;
    if (aiTemperature !== undefined) updates.ai_temperature = aiTemperature;
    if (autoTitleGeneration !== undefined) updates.auto_title_generation = autoTitleGeneration ? 1 : 0;
    if (showExampleQuestions !== undefined) updates.show_example_questions = showExampleQuestions ? 1 : 0;
    if (emailNotifications !== undefined) updates.email_notifications = emailNotifications ? 1 : 0;
    if (browserNotifications !== undefined) updates.browser_notifications = browserNotifications ? 1 : 0;

    if (Object.keys(updates).length === 0) {
      return next(new AppError(400, 'BAD_REQUEST', 'No updates provided'));
    }

    await dbHelpers.updateUserPreferences(req.user.userId, updates);

    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    res.json({
      message: 'Preferences updated successfully',
      preferences
    });
  } catch (error) {
    next(error);
  }
});

// Get user stats
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await dbHelpers.getUserStats(req.user.userId);
    if (!stats) {
      return next(new AppError(404, 'NOT_FOUND', 'Stats not found'));
    }
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Update password
router.put('/password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return next(new AppError(400, 'BAD_REQUEST', 'Current password and new password are required'));
    }

    if (newPassword.length < 6) {
      return next(new AppError(400, 'BAD_REQUEST', 'New password must be at least 6 characters'));
    }

    // Get user
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return next(new AppError(404, 'NOT_FOUND', 'User not found'));
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Current password is incorrect'));
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await dbHelpers.updateUser(req.user.userId, { password_hash: newPasswordHash });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});

// Export user data (for privacy/GDPR compliance)
router.get('/export', async (req, res, next) => {
  try {
    const user = await dbHelpers.getUserById(req.user.userId);
    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    const stats = await dbHelpers.getUserStats(req.user.userId);
    const notebooks = await dbHelpers.getNotebooksByUserId(req.user.userId);

    const exportData = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      },
      preferences,
      stats,
      notebooks: await Promise.all(notebooks.map(async (notebook) => {
        const sources = await dbHelpers.getSourcesByNotebookId(notebook.id, req.user.userId);
        const notes = await dbHelpers.getNotesByNotebookId(notebook.id, req.user.userId);
        const chatMessages = await dbHelpers.getChatMessagesByNotebookId(notebook.id, req.user.userId);

        return {
          ...notebook,
          sources,
          notes,
          chatMessages
        };
      })),
      exportedAt: new Date().toISOString()
    };

    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

// Delete user account
router.delete('/account', async (req, res, next) => {
  try {
    const { password } = req.body;

    if (!password) {
      return next(new AppError(400, 'BAD_REQUEST', 'Password is required to delete account'));
    }

    // Get user
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return next(new AppError(404, 'NOT_FOUND', 'User not found'));
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Incorrect password'));
    }

    // Delete user (cascade will delete related data)
    const { getDatabase } = await import('../db/database.js');
    const db = await getDatabase();
    await db.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: [req.user.userId]
    });

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
