-- Batches 20–23: authored packs and self-reported acceptance. No player state.
CREATE TABLE experience_pack_drafts (
 id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,id)
);
CREATE INDEX experience_pack_drafts_event ON experience_pack_drafts(event_id,updated_at);
CREATE TABLE experience_pack_installs (
 id uuid PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 pack_key text NOT NULL CHECK(char_length(pack_key) BETWEEN 1 AND 40),
 pack_version integer NOT NULL CHECK(pack_version BETWEEN 1 AND 1000000),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='object'),
 installed_by uuid NOT NULL REFERENCES users(id),
 installed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,pack_key,pack_version), UNIQUE(event_id,id)
);
CREATE TABLE field_acceptance_reports (
 event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 report jsonb NOT NULL CHECK(jsonb_typeof(report)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
