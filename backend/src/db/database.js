import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '..', '..', 'data', 'insights.db');

// Ensure data directory exists
const dataDir = join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

export function getDatabase() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

// Helper functions for common database operations
export const dbHelpers = {
  // User operations
  getUserByEmail(email) {
    const db = getDatabase();
    return db.prepare('SELECT id, email, password_hash, display_name, account_type, bio, avatar_url, created_at, updated_at FROM users WHERE email = ?').get(email);
  },

  getUserByDisplayName(displayName) {
    const db = getDatabase();
    return db.prepare('SELECT id, email, password_hash, display_name, account_type, bio, avatar_url, created_at, updated_at FROM users WHERE display_name = ?').get(displayName);
  },

  getUserById(id) {
    const db = getDatabase();
    return db.prepare('SELECT id, email, display_name, account_type, bio, avatar_url, created_at, updated_at FROM users WHERE id = ?').get(id);
  },

  createUser(id, email, passwordHash, displayName = null, accountType = 'human', webhookUrl = null, ownerId = null) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, account_type, webhook_url, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(id, email, passwordHash, displayName, accountType, webhookUrl, ownerId);
  },

  updateUser(id, updates) {
    const db = getDatabase();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id];
    const stmt = db.prepare(`
      UPDATE users
      SET ${fields}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(...values);
  },

  // User preferences
  getUserPreferences(userId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
  },

  createUserPreferences(id, userId) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO user_preferences (id, user_id)
      VALUES (?, ?)
    `);
    return stmt.run(id, userId);
  },

  updateUserPreferences(userId, updates) {
    const db = getDatabase();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    const stmt = db.prepare(`
      UPDATE user_preferences
      SET ${fields}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `);
    return stmt.run(...values);
  },

  // User stats
  getUserStats(userId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
  },

  createUserStats(id, userId) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO user_stats (id, user_id)
      VALUES (?, ?)
    `);
    return stmt.run(id, userId);
  },

  updateUserStats(userId, updates) {
    const db = getDatabase();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    const stmt = db.prepare(`
      UPDATE user_stats
      SET ${fields}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `);
    return stmt.run(...values);
  },

  // Notebooks
  getNotebooksByUserId(userId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM notebooks 
      WHERE user_id = ? 
      OR user_id IN (SELECT id FROM users WHERE owner_id = ?)
      ORDER BY updated_at DESC
    `).all(userId, userId);
  },

  getNotebookById(id, userId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM notebooks 
      WHERE id = ? 
      AND (user_id = ? OR user_id IN (SELECT id FROM users WHERE owner_id = ?))
    `).get(id, userId, userId);
  },

  createNotebook(id, userId, title, description = null) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO notebooks (id, user_id, title, description)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(id, userId, title, description);
  },

  updateNotebook(id, userId, updates) {
    const db = getDatabase();
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), id, userId];
    const stmt = db.prepare(`
      UPDATE notebooks
      SET ${fields}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `);
    return stmt.run(...values);
  },

  deleteNotebook(id, userId) {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?');
    return stmt.run(id, userId);
  },

  // Sources
  getSourcesByNotebookId(notebookId, userId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT s.*, u.display_name as author_name 
      FROM sources s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.notebook_id = ? 
      AND (s.user_id = ? OR s.user_id IN (SELECT id FROM users WHERE owner_id = ?))
      ORDER BY s.created_at DESC
    `).all(notebookId, userId, userId);
  },

  createSource(id, notebookId, userId, title, type, content = null, url = null, metadata = null) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO sources (id, notebook_id, user_id, title, type, content, url, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(id, notebookId, userId, title, type, content, url, metadata);
  },

  deleteSource(id, userId) {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM sources WHERE id = ? AND user_id = ?');
    return stmt.run(id, userId);
  },

  getAgentsByOwnerId(ownerId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM users WHERE owner_id = ?').all(ownerId);
  },

  // Notes
  getNotesByNotebookId(notebookId, userId) {
    const db = getDatabase();
    return db.prepare(`
      SELECT n.*, u.display_name as author_name
      FROM notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.notebook_id = ? 
      AND (n.user_id = ? OR n.user_id IN (SELECT id FROM users WHERE owner_id = ?))
      ORDER BY n.updated_at DESC
    `).all(notebookId, userId, userId);
  },

  createNote(id, notebookId, userId, content, authorId = null) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO notes (id, notebook_id, user_id, content, author_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(id, notebookId, userId, content, authorId || userId);
  },

  updateNote(id, userId, content) {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE notes
      SET content = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `);
    return stmt.run(content, id, userId);
  },

  deleteNote(id, userId) {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?');
    return stmt.run(id, userId);
  },

  // Chat messages
  getChatMessagesByNotebookId(notebookId, userId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM chat_messages WHERE notebook_id = ? AND user_id = ? ORDER BY created_at ASC').all(notebookId, userId);
  },

  createChatMessage(id, notebookId, userId, role, content, sources = null) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO chat_messages (id, notebook_id, user_id, role, content, sources)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(id, notebookId, userId, role, content, sources);
  }
};

export default { getDatabase, closeDatabase, dbHelpers };
