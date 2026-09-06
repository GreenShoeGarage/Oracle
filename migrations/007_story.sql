-- Additive authored story and private investigation state. Existing journals,
-- accounts and format-1 adventure/setup documents are left unchanged.
CREATE TABLE story_groups (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
  character_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(character_ids)='array'),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,id)
);
CREATE TABLE story_entries (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('rumor','bulletin')),
  document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','published','withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  published jsonb CHECK(published IS NULL OR jsonb_typeof(published)='object'),
  published_version integer CHECK(published_version IS NULL OR published_version>0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,id), CHECK((published IS NULL)=(published_version IS NULL))
);
CREATE INDEX story_entries_event ON story_entries(event_id,kind,created_at,id);
CREATE TABLE story_readings (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL, owner_user_id uuid NOT NULL REFERENCES users(id), character_id uuid NOT NULL,
  publication_version integer NOT NULL CHECK(publication_version>0),
  journal_id uuid NOT NULL UNIQUE REFERENCES adventure_journal(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,owner_user_id,character_id,entry_id,publication_version),
  FOREIGN KEY(event_id,entry_id) REFERENCES story_entries(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE TABLE story_requests (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, actor_user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL, payload_hash text NOT NULL, target_id uuid, action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(event_id,actor_user_id,request_id)
);
CREATE TABLE story_activity (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entry_id uuid, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, version integer NOT NULL CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(event_id,entry_id) REFERENCES story_entries(event_id,id) ON DELETE CASCADE
);
CREATE INDEX story_activity_event ON story_activity(event_id,created_at,id);
CREATE TABLE trace_records (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id), character_id uuid NOT NULL,
  document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,id), FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX trace_records_event_character ON trace_records(event_id,character_id,archived,updated_at,id);
CREATE TABLE trace_requests (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, actor_user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL, payload_hash text NOT NULL, record_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(event_id,actor_user_id,request_id),
  FOREIGN KEY(event_id,record_id) REFERENCES trace_records(event_id,id) ON DELETE CASCADE
);

-- Account-bound receipt grants are checked when projecting received WHISPER.
CREATE INDEX exchange_receipts_owner_character ON exchange_receipts(event_id,owner_user_id,owner_character_id);
