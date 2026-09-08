-- Batch 14: optional personal character arcs.
-- Authored templates are event-owned. Player selection/progress belongs to the
-- current account-character assignment and is intentionally not exposed to
-- organizers through normal arc reads.
CREATE TABLE character_arc_templates (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 1000),
  starting_question text NOT NULL CHECK (char_length(starting_question) BETWEEN 1 AND 1000),
  prompts jsonb NOT NULL CHECK (jsonb_typeof(prompts)='array' AND jsonb_array_length(prompts) BETWEEN 1 AND 5),
  closing_reflection text NOT NULL CHECK (char_length(closing_reflection) BETWEEN 1 AND 1000),
  theme_id text NOT NULL CHECK (theme_id IN ('fantasy','cyberpunk','wasteland','custom')),
  source text NOT NULL DEFAULT 'custom' CHECK (source IN ('starter','custom')),
  published boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,id)
);
CREATE INDEX character_arc_templates_event ON character_arc_templates(event_id,published,created_at);

CREATE TABLE character_arc_states (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  character_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES character_arc_templates(id) ON DELETE RESTRICT,
  template_snapshot jsonb NOT NULL CHECK (jsonb_typeof(template_snapshot)='object'),
  prompt_states jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(prompt_states)='array'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','replaced')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX character_arc_one_active ON character_arc_states(character_id,user_id) WHERE status='active';
CREATE INDEX character_arc_state_owner ON character_arc_states(event_id,user_id,character_id,updated_at DESC);
