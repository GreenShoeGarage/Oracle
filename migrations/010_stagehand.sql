-- Additive live operations. Existing adventure nodes and attendance remain intact.
CREATE TABLE stagehand_encounters (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 state text NOT NULL DEFAULT 'planning' CHECK(state IN('planning','open','paused','cancelled','ended')),
 checks jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(checks)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,id)
);
CREATE UNIQUE INDEX stagehand_one_node ON stagehand_encounters(event_id,(document->>'nodeId')) WHERE document->>'nodeId' IS NOT NULL;
CREATE TABLE stagehand_parties (
 id uuid PRIMARY KEY, event_id uuid NOT NULL, encounter_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'waiting' CHECK(status IN('waiting','dispatched','returned','cancelled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), terms_version integer NOT NULL DEFAULT 1 CHECK(terms_version>0),
 return_minutes integer NOT NULL CHECK(return_minutes BETWEEN 1 AND 480),
 members jsonb NOT NULL CHECK(jsonb_typeof(members)='array' AND jsonb_array_length(members) BETWEEN 1 AND 20),
 dispatched_at timestamptz, return_by timestamptz, dispatched_node_id text,
 release_receipt jsonb CHECK(release_receipt IS NULL OR jsonb_typeof(release_receipt)='object'), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,id), FOREIGN KEY(event_id,encounter_id) REFERENCES stagehand_encounters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX stagehand_party_state ON stagehand_parties(event_id,encounter_id,status,updated_at,id);
CREATE TABLE stagehand_requests (
 event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, actor_user_id uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL, payload_hash text NOT NULL, action text NOT NULL, target_id uuid,
 character_id uuid, manage boolean NOT NULL,
 outcome jsonb NOT NULL CHECK(jsonb_typeof(outcome)='object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(event_id,actor_user_id,request_id)
);
CREATE TABLE stagehand_history (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 encounter_id uuid NOT NULL, party_id uuid, actor_user_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(event_id,encounter_id) REFERENCES stagehand_encounters(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,party_id) REFERENCES stagehand_parties(event_id,id) ON DELETE CASCADE
);
CREATE INDEX stagehand_history_scope ON stagehand_history(event_id,encounter_id,created_at,id);
CREATE TABLE stagehand_announcements (
 id uuid PRIMARY KEY, event_id uuid NOT NULL, encounter_id uuid NOT NULL,
 encounter_version integer NOT NULL CHECK(encounter_version>0), story_entry_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,story_entry_id),
 FOREIGN KEY(event_id,encounter_id) REFERENCES stagehand_encounters(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,story_entry_id) REFERENCES story_entries(event_id,id) ON DELETE CASCADE
);
