-- Sharing permission is separate from format-1 adventure definitions. Existing
-- adventures default to restricted until an organizer explicitly permits it.
CREATE TABLE event_sharing_settings (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  policies jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(policies)='object')
);
CREATE TABLE exchange_sessions (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code text NOT NULL CHECK(code ~ '^[A-HJ-NP-Z2-9]{12}$'),
  status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','negotiating','completed','cancelled','rejected','expired')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  initiator_user_id uuid NOT NULL REFERENCES users(id),
  initiator_character_id uuid NOT NULL,
  recipient_user_id uuid REFERENCES users(id),
  recipient_character_id uuid,
  initiator_offer jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(initiator_offer)='array'),
  recipient_offer jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(recipient_offer)='array'),
  initiator_confirmed_version integer,
  recipient_confirmed_version integer,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE(event_id,id),
  UNIQUE(event_id,code),
  CHECK((recipient_user_id IS NULL)=(recipient_character_id IS NULL)),
  CHECK(recipient_user_id IS NULL OR recipient_user_id<>initiator_user_id),
  FOREIGN KEY(event_id,initiator_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,recipient_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX exchange_sessions_participants ON exchange_sessions(event_id,initiator_user_id,recipient_user_id,updated_at);
CREATE TABLE exchange_requests (
  event_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  exchange_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(event_id,actor_user_id,request_id),
  FOREIGN KEY(event_id,exchange_id) REFERENCES exchange_sessions(event_id,id) ON DELETE CASCADE
);
CREATE TABLE exchange_copies (
  event_id uuid NOT NULL,
  recipient_character_id uuid NOT NULL,
  origin_journal_id uuid NOT NULL REFERENCES adventure_journal(id) ON DELETE CASCADE,
  journal_id uuid NOT NULL UNIQUE REFERENCES adventure_journal(id) ON DELETE CASCADE,
  exchange_id uuid NOT NULL,
  sender_character_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(event_id,recipient_character_id,origin_journal_id),
  FOREIGN KEY(event_id,recipient_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,sender_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,exchange_id) REFERENCES exchange_sessions(event_id,id) ON DELETE CASCADE
);
CREATE TABLE exchange_receipts (
  exchange_id uuid NOT NULL,
  event_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  owner_character_id uuid NOT NULL,
  receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
  PRIMARY KEY(exchange_id,owner_user_id),
  FOREIGN KEY(event_id,owner_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,exchange_id) REFERENCES exchange_sessions(event_id,id) ON DELETE CASCADE
);
CREATE TABLE exchange_contacts (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  owner_character_id uuid NOT NULL,
  peer_user_id uuid NOT NULL REFERENCES users(id),
  peer_character_id uuid NOT NULL,
  met_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,owner_user_id,owner_character_id,peer_user_id,peer_character_id),
  FOREIGN KEY(event_id,owner_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,peer_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX exchange_contacts_owner ON exchange_contacts(event_id,owner_user_id,owner_character_id,met_at);
