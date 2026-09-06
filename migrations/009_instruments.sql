-- Shared-device challenges: immutable publications, captured hosts and exact-once outcomes.
CREATE TABLE sigil_entries (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 code text NOT NULL CHECK(code ~ '^[A-HJ-NP-Z2-9]{20}$'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'), published jsonb CHECK(published IS NULL OR jsonb_typeof(published)='object'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','withdrawn')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), published_version integer NOT NULL DEFAULT 0 CHECK(published_version>=0),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,id), UNIQUE(event_id,code)
);
CREATE TABLE sigil_runs (
 id uuid PRIMARY KEY, event_id uuid NOT NULL, entry_id uuid NOT NULL,
 owner_user_id uuid NOT NULL REFERENCES users(id), character_id uuid NOT NULL, character_name text NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), published_version integer NOT NULL CHECK(published_version>0),
 roles jsonb NOT NULL CHECK(jsonb_typeof(roles)='array'), bindings jsonb NOT NULL CHECK(jsonb_typeof(bindings)='array'),
 status text NOT NULL DEFAULT 'running' CHECK(status IN('running','paused','succeeded','failed','cancelled')),
 pause_reason text, version integer NOT NULL DEFAULT 1 CHECK(version>0), checkpoint_index integer NOT NULL DEFAULT 0 CHECK(checkpoint_index BETWEEN 0 AND 12),
 remaining_ms integer NOT NULL CHECK(remaining_ms BETWEEN 0 AND 3600000), deadline_at timestamptz, lease_expires_at timestamptz,
 checkpoint_elapsed_ms integer NOT NULL DEFAULT 0 CHECK(checkpoint_elapsed_ms>=0), checkpoint_started_at timestamptz,
 heartbeat_sequence integer NOT NULL DEFAULT 0 CHECK(heartbeat_sequence>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,id), FOREIGN KEY(event_id,entry_id) REFERENCES sigil_entries(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX sigil_one_active_entry ON sigil_runs(event_id,entry_id,character_id) WHERE status IN('running','paused');
CREATE INDEX sigil_runs_owner ON sigil_runs(event_id,owner_user_id,character_id,updated_at,id);
CREATE TABLE sigil_outcomes (
 id uuid PRIMARY KEY, event_id uuid NOT NULL, run_id uuid NOT NULL, entry_id uuid NOT NULL,
 owner_user_id uuid NOT NULL REFERENCES users(id), character_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN('succeeded','failed')), text text NOT NULL, flags jsonb NOT NULL CHECK(jsonb_typeof(flags)='array'),
 consumption jsonb NOT NULL CHECK(jsonb_typeof(consumption)='object'), journal_id uuid NOT NULL REFERENCES adventure_journal(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(event_id,run_id),
 FOREIGN KEY(event_id,run_id) REFERENCES sigil_runs(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,entry_id) REFERENCES sigil_entries(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX sigil_one_success ON sigil_outcomes(event_id,entry_id,character_id) WHERE status='succeeded';
CREATE TABLE sigil_requests (
 event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, actor_user_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
 payload_hash text NOT NULL, action text NOT NULL, entry_id uuid, run_id uuid,
 outcome jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(outcome)='object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(event_id,actor_user_id,request_id),
 FOREIGN KEY(event_id,entry_id) REFERENCES sigil_entries(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,run_id) REFERENCES sigil_runs(event_id,id) ON DELETE CASCADE
);
CREATE TABLE sigil_history (
 id uuid PRIMARY KEY, event_id uuid NOT NULL, run_id uuid NOT NULL, actor_user_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(event_id,run_id) REFERENCES sigil_runs(event_id,id) ON DELETE CASCADE
);
CREATE INDEX sigil_history_run ON sigil_history(event_id,run_id,created_at,id);

-- STATIC keeps authored worlds separate from captured fictional readings.
CREATE TABLE static_entries (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code text NOT NULL CHECK(code ~ '^[A-HJ-NP-Z2-9]{20}$'),
  document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  published jsonb CHECK(published IS NULL OR jsonb_typeof(published)='object'),
  published_version integer CHECK(published_version IS NULL OR published_version>0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,id), UNIQUE(event_id,code), CHECK((published IS NULL)=(published_version IS NULL))
);
CREATE INDEX static_entries_event ON static_entries(event_id,created_at,id);
CREATE TABLE static_overrides (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, entry_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0), state_id text, reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 2000),
  actor_user_id uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(event_id,entry_id), FOREIGN KEY(event_id,entry_id) REFERENCES static_entries(event_id,id) ON DELETE CASCADE
);
CREATE TABLE static_readings (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL, owner_user_id uuid NOT NULL REFERENCES users(id), character_id uuid NOT NULL,
  publication_version integer NOT NULL CHECK(publication_version>0), reading_key text NOT NULL CHECK(reading_key ~ '^[0-9a-f]{64}$'),
  state_id text NOT NULL, source text NOT NULL CHECK(source IN('prepared','conditions','organizer')),
  journal_id uuid NOT NULL UNIQUE REFERENCES adventure_journal(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,owner_user_id,character_id,entry_id,reading_key),
  FOREIGN KEY(event_id,entry_id) REFERENCES static_entries(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX static_readings_owner ON static_readings(event_id,owner_user_id,character_id,created_at,id);
CREATE TABLE static_requests (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, actor_user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL, payload_hash text NOT NULL, action text NOT NULL, target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(event_id,actor_user_id,request_id),
  FOREIGN KEY(event_id,target_id) REFERENCES static_entries(event_id,id) ON DELETE CASCADE
);
CREATE TABLE static_history (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, entry_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
  version integer NOT NULL CHECK(version>0), reason text NOT NULL DEFAULT '' CHECK(char_length(reason)<=2000),
  details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(event_id,entry_id) REFERENCES static_entries(event_id,id) ON DELETE CASCADE
);
CREATE INDEX static_history_entry ON static_history(event_id,entry_id,created_at,id);
