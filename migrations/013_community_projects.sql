-- Batch 15: narrative-first community projects. Projects and milestones are
-- event-authored; player submissions are reviewed separately. No economy or
-- cross-instrument effects are introduced in this migration.
CREATE TABLE community_projects (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  purpose text NOT NULL DEFAULT '' CHECK (char_length(purpose) <= 3000),
  audience text NOT NULL DEFAULT 'event' CHECK (audience IN ('event')),
  contribution_routes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(contribution_routes)='array'),
  outcome_text text NOT NULL DEFAULT '' CHECK (char_length(outcome_text) <= 3000),
  organizer_notes text NOT NULL DEFAULT '' CHECK (char_length(organizer_notes) <= 5000),
  theme_id text NOT NULL DEFAULT 'custom' CHECK (char_length(theme_id) <= 40),
  source text NOT NULL DEFAULT 'custom' CHECK (source IN ('custom','starter')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','completed','closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,id)
);
CREATE INDEX community_projects_event_status ON community_projects(event_id,status,created_at);

CREATE TABLE community_project_milestones (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  required_count integer NOT NULL DEFAULT 1 CHECK (required_count BETWEEN 1 AND 1000),
  counting_rule text NOT NULL DEFAULT 'distinct_accounts' CHECK (counting_rule IN ('distinct_accounts','accepted_contributions')),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY(event_id,project_id) REFERENCES community_projects(event_id,id) ON DELETE CASCADE,
  UNIQUE(project_id,position),
  UNIQUE(event_id,id)
);
CREATE INDEX community_project_milestones_project ON community_project_milestones(project_id,position);

CREATE TABLE community_project_contributions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  event_id uuid NOT NULL,
  project_id uuid NOT NULL,
  milestone_id uuid NOT NULL,
  character_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_key text NOT NULL CHECK (char_length(route_key) BETWEEN 1 AND 80),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 3000),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','declined','withdrawn','superseded')),
  review_note text NOT NULL DEFAULT '' CHECK (char_length(review_note) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,project_id) REFERENCES community_projects(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,milestone_id) REFERENCES community_project_milestones(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,character_id) REFERENCES characters(event_id,id) ON DELETE CASCADE,
  UNIQUE(event_id,request_id),
  UNIQUE(event_id,id)
);
CREATE INDEX community_project_contributions_project ON community_project_contributions(project_id,status,created_at);
CREATE INDEX community_project_contributions_user ON community_project_contributions(event_id,user_id,created_at);

CREATE TABLE community_project_receipts (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('milestone_complete','project_complete')),
  milestone_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,project_id) REFERENCES community_projects(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,milestone_id) REFERENCES community_project_milestones(event_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX community_project_once_milestone ON community_project_receipts(project_id,milestone_id,kind) WHERE milestone_id IS NOT NULL;
CREATE UNIQUE INDEX community_project_once_complete ON community_project_receipts(project_id,kind) WHERE kind='project_complete';
