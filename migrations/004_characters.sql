-- Character and faction records are scoped to an event. Existing accounts,
-- events and setup data remain intact. Inventory is separate from authored
-- starting equipment so character revisions cannot refill consumed items.
CREATE TABLE event_character_settings (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  allow_player_creation boolean NOT NULL DEFAULT true,
  require_approval boolean NOT NULL DEFAULT true,
  max_per_player integer NOT NULL DEFAULT 1 CHECK (max_per_player BETWEEN 1 AND 10),
  public_fields jsonb NOT NULL DEFAULT '["portrait","pronouns","faction"]',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (jsonb_typeof(public_fields) = 'array')
);
CREATE TABLE factions (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (event_id, id)
);
CREATE UNIQUE INDEX factions_event_name ON factions(event_id, lower(name));
CREATE TABLE characters (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','changes_requested','retired')),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  badge_code text NOT NULL UNIQUE CHECK (badge_code ~ '^[A-HJ-NP-Z2-9]{20}$'),
  review_notes text NOT NULL DEFAULT '' CHECK (char_length(review_notes) <= 2000),
  inventory_initialized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, id)
);
CREATE INDEX characters_event_user ON characters(event_id, user_id, status);
CREATE TABLE character_inventory (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  character_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  quantity integer NOT NULL CHECK (quantity BETWEEN 0 AND 9999),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (event_id, character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX character_inventory_character ON character_inventory(character_id);
