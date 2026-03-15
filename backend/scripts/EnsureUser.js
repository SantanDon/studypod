
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs'); // Using bcryptjs to match the backend
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, 'data', 'insights.db');
const db = new Database(dbPath, { readonly: false });

async function ensureUser(displayName, passphrase) {
  console.log(`Ensuring user: ${displayName}`);
  
  // Try to find by display name
  const user = db.prepare('SELECT * FROM users WHERE display_name = ?').get(displayName);
  
  if (user) {
    console.log('User already exists:', user.display_name);
    const match = await bcrypt.compare(passphrase, user.password_hash);
    if (match) {
      console.log('Passphrase already matches!');
    } else {
      console.log('Updating passphrase...');
      const newHash = await bcrypt.hash(passphrase, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
      console.log('Passphrase updated.');
    }
    return;
  }

  // Create new human user
  console.log('Creating new user...');
  const userId = uuidv4();
  const email = `${displayName}@user.local`;
  const passwordHash = await bcrypt.hash(passphrase, 10);
  
  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, account_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, email, passwordHash, displayName, 'human');
  
  // Create prefs and stats
  db.prepare('INSERT INTO user_preferences (id, user_id) VALUES (?, ?)').run(uuidv4(), userId);
  db.prepare('INSERT INTO user_stats (id, user_id) VALUES (?, ?)').run(uuidv4(), userId);
  
  console.log('User created successfully!');
}

const displayName = 'SantanDon';
const passphrase = 'SantanDon';

ensureUser(displayName, passphrase).catch(console.error);
