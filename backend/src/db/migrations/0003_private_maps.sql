CREATE TABLE IF NOT EXISTS studio_maps (
  id text PRIMARY KEY NOT NULL,
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL, nodes text NOT NULL, edges text NOT NULL,
  created_at text NOT NULL, updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS studio_maps_owner_notebook ON studio_maps(user_id, notebook_id);
