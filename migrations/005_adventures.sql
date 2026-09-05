-- Additive instrument state. Every gameplay record is tied to the character's
-- event; journal entries are immutable snapshots of authorized discoveries.
CREATE TABLE event_adventures (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_rehearsal boolean NOT NULL DEFAULT false,
  source_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE adventure_runs (
  event_id uuid NOT NULL,
  character_id uuid NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(progress)='object'),
  flags jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(flags)='object'),
  PRIMARY KEY(event_id,character_id),
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE TABLE adventure_journal (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  character_id uuid NOT NULL,
  node_id text NOT NULL,
  entry_key text NOT NULL,
  title text NOT NULL,
  text text NOT NULL,
  audio text,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,character_id,entry_key),
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE TABLE adventure_requests (
  event_id uuid NOT NULL,
  character_id uuid NOT NULL,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,character_id,request_id),
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE TABLE adventure_attendance (
  event_id uuid NOT NULL,
  node_id text NOT NULL,
  character_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,node_id,character_id),
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX adventure_journal_character ON adventure_journal(event_id,character_id,created_at,id);
CREATE INDEX adventure_attendance_scene ON adventure_attendance(event_id,node_id);
