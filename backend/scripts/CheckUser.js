
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'insights.db');
const db = new Database(dbPath);

async function checkUser(displayName, passphrase) {
  console.log(`Checking for user: ${displayName}`);
  const user = db.prepare('SELECT * FROM users WHERE display_name = ?').get(displayName);
  
  if (!user) {
    console.log('User not found.');
    // Check all users
    const allUsers = db.prepare('SELECT display_name FROM users').all();
    console.log('Existing users:', allUsers.map(u => u.display_name).join(', '));
    return;
  }

  console.log('User found:', user.display_name);
  console.log('Account type:', user.account_type);

  const match = await bcrypt.compare(passphrase, user.password_hash);
  if (match) {
    console.log('Passphrase MATCHED!');
  } else {
    console.log('Passphrase did NOT match.');
  }
}

const args = process.argv.slice(2);
const displayName = args[0] || 'SantanDon';
const passphrase = args[1] || 'SantanDon';

checkUser(displayName, passphrase).catch(console.error);
