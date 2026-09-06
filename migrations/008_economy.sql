-- Whole-unit fictional resources and immutable, account-bound transaction evidence.
-- Existing inventory and all migrations 001–007 remain unchanged.
CREATE TABLE economy_resources (
 event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 id text NOT NULL CHECK(id ~ '^[a-z][a-z0-9-]{0,39}$'),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80),
 PRIMARY KEY(event_id,id)
);
CREATE TABLE economy_balances (
 event_id uuid NOT NULL, character_id uuid NOT NULL, resource_id text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 1000000000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(event_id,character_id,resource_id),
 FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,resource_id) REFERENCES economy_resources(event_id,id)
);
CREATE TABLE economy_shops (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=2000),
 enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(event_id,id)
);
CREATE TABLE economy_stock (
 id uuid PRIMARY KEY, event_id uuid NOT NULL, shop_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=2000),
 quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 9999),
 initial_quantity integer NOT NULL CHECK(initial_quantity BETWEEN 0 AND 9999),
 resource_id text NOT NULL, unit_price integer NOT NULL CHECK(unit_price BETWEEN 1 AND 1000000000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 FOREIGN KEY(event_id,shop_id) REFERENCES economy_shops(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,resource_id) REFERENCES economy_resources(event_id,id), UNIQUE(event_id,id)
);
CREATE TABLE economy_transactions (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN('purchase','adjustment','exchange','oath')),
 reference_id uuid NOT NULL, payload_hash text NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_id,kind,reference_id), UNIQUE(event_id,id)
);
CREATE TABLE economy_receipts (
 event_id uuid NOT NULL, transaction_id uuid NOT NULL,
 owner_user_id uuid NOT NULL REFERENCES users(id), owner_character_id uuid NOT NULL,
 PRIMARY KEY(event_id,transaction_id,owner_user_id,owner_character_id),
 FOREIGN KEY(event_id,transaction_id) REFERENCES economy_transactions(event_id,id) ON DELETE CASCADE,
 FOREIGN KEY(event_id,owner_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX economy_receipts_owner ON economy_receipts(event_id,owner_user_id,owner_character_id);
CREATE TABLE economy_requests (
 event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 actor_user_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
 payload_hash text NOT NULL, action text NOT NULL, response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 character_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(event_id,actor_user_id,request_id)
);
CREATE TABLE economy_baselines (
 event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 inventory jsonb NOT NULL CHECK(jsonb_typeof(inventory)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE exchange_trade_offers (
 event_id uuid NOT NULL, exchange_id uuid NOT NULL,
 side text NOT NULL CHECK(side IN('initiator','recipient')),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 PRIMARY KEY(event_id,exchange_id,side),
 FOREIGN KEY(event_id,exchange_id) REFERENCES exchange_sessions(event_id,id) ON DELETE CASCADE
);

-- Agreements preserve captured account ownership and exact terms/signatures.
CREATE TABLE oath_agreements (
  id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL REFERENCES users(id), creator_character_id uuid NOT NULL,
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
  terms text NOT NULL CHECK(char_length(terms) BETWEEN 1 AND 12000),
  settlement jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(settlement)='array'),
  status text NOT NULL DEFAULT 'proposed' CHECK(status IN('proposed','active','fulfilled','cancelled','disputed','adjudicated')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), terms_version integer NOT NULL DEFAULT 1 CHECK(terms_version>0),
  expires_at timestamptz, settled_at timestamptz, receipt jsonb CHECK(receipt IS NULL OR jsonb_typeof(receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_id,id), FOREIGN KEY(event_id,creator_character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX oath_agreements_event ON oath_agreements(event_id,updated_at,id);
CREATE TABLE oath_participants (
  event_id uuid NOT NULL, agreement_id uuid NOT NULL, character_id uuid NOT NULL, owner_user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL, kind text NOT NULL CHECK(kind IN('participant','witness')),
  accepted_terms_version integer CHECK(accepted_terms_version>0), accepted_at timestamptz,
  witnessed_terms_version integer CHECK(witnessed_terms_version>0), witnessed_at timestamptz,
  settlement_terms_version integer CHECK(settlement_terms_version>0), settlement_confirmed_at timestamptz,
  PRIMARY KEY(event_id,agreement_id,character_id), UNIQUE(event_id,agreement_id,owner_user_id),
  FOREIGN KEY(event_id,agreement_id) REFERENCES oath_agreements(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE INDEX oath_participants_owner ON oath_participants(event_id,owner_user_id,character_id,agreement_id);
CREATE TABLE oath_history (
  id uuid PRIMARY KEY, event_id uuid NOT NULL, agreement_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id), character_id uuid, character_name text,
  action text NOT NULL, terms_version integer NOT NULL CHECK(terms_version>0),
  details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(event_id,agreement_id) REFERENCES oath_agreements(event_id,id) ON DELETE CASCADE
);
CREATE INDEX oath_history_agreement ON oath_history(event_id,agreement_id,created_at,id);
CREATE TABLE oath_requests (
  event_id uuid NOT NULL, actor_user_id uuid NOT NULL REFERENCES users(id), request_id uuid NOT NULL,
  payload_hash text NOT NULL, agreement_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(event_id,actor_user_id,request_id),
  FOREIGN KEY(event_id,agreement_id) REFERENCES oath_agreements(event_id,id) ON DELETE CASCADE
);
