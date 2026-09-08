-- Batch 13: connection cards. Authored templates, immutable assignment snapshots,
-- account-bound responses, and exact mutual shared-history consent remain distinct.
CREATE TABLE connection_templates (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  situation text NOT NULL CHECK (char_length(situation) BETWEEN 1 AND 500),
  approach text NOT NULL CHECK (char_length(approach) BETWEEN 1 AND 160),
  opening text NOT NULL CHECK (char_length(opening) BETWEEN 1 AND 500),
  follow_up text NOT NULL DEFAULT '' CHECK (char_length(follow_up) <= 500),
  quiet_alternative text NOT NULL DEFAULT '' CHECK (char_length(quiet_alternative) <= 500),
  shared_fact text NOT NULL DEFAULT '' CHECK (char_length(shared_fact) <= 500),
  source_key text,
  published boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,source_key)
);
CREATE INDEX connection_templates_event ON connection_templates(event_id,published);

CREATE TABLE connection_assignments (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  template_id uuid REFERENCES connection_templates(id) ON DELETE SET NULL,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counterpart_character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  counterpart_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  response_status text NOT NULL DEFAULT 'offered' CHECK (response_status IN ('offered','kept','paused','dismissed')),
  shared_fact_accepted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connection_assignments_player ON connection_assignments(event_id,assigned_user_id,response_status);
CREATE INDEX connection_assignments_counterpart ON connection_assignments(event_id,counterpart_user_id);

CREATE TABLE connection_confirmations (
  assignment_id uuid NOT NULL REFERENCES connection_assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exact_text text NOT NULL CHECK (char_length(exact_text) BETWEEN 1 AND 500),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(assignment_id,user_id)
);