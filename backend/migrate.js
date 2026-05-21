import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: '../.env' });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./studypod.db",
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function migrate() {
  try {
    // Modify tasks table
    await client.execute("ALTER TABLE tasks ADD COLUMN assignee text DEFAULT 'human'");
    await client.execute("ALTER TABLE tasks ADD COLUMN result text");
    await client.execute("ALTER TABLE tasks ADD COLUMN completed_at integer");
  } catch (e) {
    console.log("Tasks columns may already exist. Skipping error: " + e.message);
  }

  const alterUsers = [
    "ALTER TABLE users ADD COLUMN account_type text DEFAULT 'human'",
    "ALTER TABLE users ADD COLUMN webhook_url text",
    "ALTER TABLE users ADD COLUMN owner_id text",
    "ALTER TABLE users ADD COLUMN is_verified integer DEFAULT 0",
    "ALTER TABLE users ADD COLUMN verification_token text",
    "ALTER TABLE users ADD COLUMN token_expires_at integer",
    "ALTER TABLE users ADD COLUMN email_consent integer DEFAULT 0",
    "ALTER TABLE users ADD COLUMN email_consent_at integer",
    "ALTER TABLE users ADD COLUMN recovery_hash text",
    "ALTER TABLE users ADD COLUMN api_keys text",
    "ALTER TABLE users ADD COLUMN two_factor_secret text",
    "ALTER TABLE users ADD COLUMN two_factor_enabled integer DEFAULT 0",
    "ALTER TABLE users ADD COLUMN youtube_extractions_today integer DEFAULT 0",
    "ALTER TABLE users ADD COLUMN last_extraction_reset integer"
  ];

  for (const q of alterUsers) {
    try {
      await client.execute(q);
    } catch (e) {
      console.log("Skipping existing column for users");
    }
  }
  
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id text PRIMARY KEY,
        notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor text NOT NULL,
        action_type text NOT NULL,
        content_preview text,
        created_at integer
      )
    `);

    // Create Scratchpad
    await client.execute(`
      CREATE TABLE IF NOT EXISTS scratchpad (
        id text PRIMARY KEY,
        notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content text NOT NULL,
        ttl_expires_at integer,
        created_at integer
      )
    `);

    // Create Webhooks
    await client.execute(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id text PRIMARY KEY,
        notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url text NOT NULL,
        events_json text NOT NULL,
        created_at integer
      )
    `);
    console.log("Migration successful!");
  } catch (error) {
    console.error("Migration failed:", error);
  }
}

migrate();
