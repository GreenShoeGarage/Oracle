-- Batch 17: versioned complete starter-experience installation metadata.
-- The install record references authored event content only. Player responses,
-- arc states, project contributions, donations, effects, and receipts remain in
-- their existing tables and are never copied into the bundle record.
CREATE TABLE starter_experience_installs (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  starter_key text NOT NULL CHECK (starter_key IN ('lantern-gathering','neighborhood-relay','water-watch')),
  starter_version integer NOT NULL DEFAULT 1 CHECK (starter_version > 0),
  theme_id text NOT NULL CHECK (theme_id IN ('fantasy','cyberpunk','wasteland')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  installed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  installed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,starter_key,starter_version)
);
CREATE INDEX starter_experience_installs_event ON starter_experience_installs(event_id,installed_at DESC);
