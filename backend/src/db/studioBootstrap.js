import { sql } from 'drizzle-orm';

// Also used for existing local and remote databases which skip the migration journal.
export const studioSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS studio_maps (
    id text PRIMARY KEY NOT NULL, notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text NOT NULL, nodes text NOT NULL,
    edges text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS studio_maps_owner_notebook ON studio_maps(user_id, notebook_id)',
  `CREATE TABLE IF NOT EXISTS studio_decks (
    id text PRIMARY KEY NOT NULL, notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL, cards text NOT NULL,
    version integer NOT NULL DEFAULT 1, created_at text NOT NULL, updated_at text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS studio_quizzes (
    id text PRIMARY KEY NOT NULL, notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text NOT NULL, difficulty text NOT NULL,
    questions text NOT NULL, created_at text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS studio_attempts (
    id text PRIMARY KEY NOT NULL, notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_id text NOT NULL REFERENCES studio_quizzes(id) ON DELETE CASCADE, results text NOT NULL,
    score integer NOT NULL, total_questions integer NOT NULL, started_at text, completed_at text NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS studio_decks_owner_notebook ON studio_decks(user_id, notebook_id)',
  'CREATE INDEX IF NOT EXISTS studio_quizzes_owner_notebook ON studio_quizzes(user_id, notebook_id)',
  'CREATE INDEX IF NOT EXISTS studio_attempts_owner_notebook ON studio_attempts(user_id, notebook_id)',
];

export async function ensureStudioSchema(db) {
  for (const statement of studioSchemaStatements) await db.run(sql.raw(statement));
}
