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

const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    account_type TEXT DEFAULT 'human',
    webhook_url TEXT,
    owner_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name);
`);

// Migrations for existing databases
try {
  db.exec(`ALTER TABLE users ADD COLUMN account_type TEXT DEFAULT 'human'`);
} catch (e) {
  // Ignore error if column already exists
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN webhook_url TEXT`);
} catch (e) {
  // Ignore error if column already exists
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN owner_id TEXT`);
} catch (e) {
  // Ignore error if column already exists
}

// Deduplicate display_names before enforcing uniqueness
try {
  const duplicates = db.prepare(`
    SELECT display_name, COUNT(*) as count 
    FROM users 
    WHERE display_name IS NOT NULL 
    GROUP BY display_name 
    HAVING count > 1
  `).all();

  for (const dup of duplicates) {
    const users = db.prepare(`SELECT id, created_at FROM users WHERE display_name = ? ORDER BY created_at ASC`).all(dup.display_name);
    // Keep the first user, rename others
    for (let i = 1; i < users.length; i++) {
        const newName = `${dup.display_name}_dup_${i}`;
        db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(newName, users[i].id);
        console.log(`[Migration] Renamed duplicate user ${users[i].id} to ${newName}`);
    }
  }

  // Create the unique index if it doesn't exist (above CREATE TABLE covers new DBs, this covers existing)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name)`);
} catch (e) {
  console.error('[Migration] Error deduplicating display names:', e.message);
}

// Create user_preferences table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    theme TEXT DEFAULT 'light',
    accent_color TEXT DEFAULT 'blue',
    compact_mode INTEGER DEFAULT 0,
    default_model TEXT DEFAULT 'llama2',
    ai_temperature REAL DEFAULT 0.7,
    auto_title_generation INTEGER DEFAULT 1,
    show_example_questions INTEGER DEFAULT 1,
    email_notifications INTEGER DEFAULT 1,
    browser_notifications INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id)
  );
`);

// Create user_stats table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_stats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    total_notebooks INTEGER DEFAULT 0,
    total_sources INTEGER DEFAULT 0,
    total_notes INTEGER DEFAULT 0,
    storage_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id)
  );
`);

// Create notebooks table
db.exec(`
  CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Create sources table
db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT,
    url TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Create notes table
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    author_id TEXT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
  );
`);

// Migration for existing notes table
try {
  db.exec(`ALTER TABLE notes ADD COLUMN author_id TEXT`);
} catch (e) {
  // Ignore error if column already exists
}


// Create chat_messages table
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Create sync_data table for encrypted cloud sync
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_data (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    checksum TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Create indexes for better performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_notebooks_user_id ON notebooks(user_id);
  CREATE INDEX IF NOT EXISTS idx_sources_notebook_id ON sources(notebook_id);
  CREATE INDEX IF NOT EXISTS idx_sources_user_id ON sources(user_id);
  CREATE INDEX IF NOT EXISTS idx_notes_notebook_id ON notes(notebook_id);
  CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_notebook_id ON chat_messages(notebook_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_sync_data_user_id ON sync_data(user_id);
  CREATE INDEX IF NOT EXISTS idx_sync_data_type ON sync_data(type);
  CREATE INDEX IF NOT EXISTS idx_sync_data_updated_at ON sync_data(updated_at);
`);

console.log('✅ Database initialized successfully at:', DB_PATH);
console.log('📊 Tables created:');
console.log('   - users');
console.log('   - user_preferences');
console.log('   - user_stats');
console.log('   - notebooks');
console.log('   - sources');
console.log('   - notes');
console.log('   - chat_messages');
console.log('   - sync_data');

db.close();
