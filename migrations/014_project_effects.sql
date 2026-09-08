-- Batch 16: verified project evidence, atomic resource donations, and bounded consequences.
-- Existing Batch 15 projects remain narrative-first unless an organizer explicitly configures an integration.
ALTER TABLE community_project_milestones
  ADD COLUMN contribution_mode text NOT NULL DEFAULT 'reviewed' CHECK (contribution_mode IN ('reviewed','evidence','resource')),
  ADD COLUMN resource_id text,
  ADD COLUMN allowed_evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(allowed_evidence)='array');

ALTER TABLE community_project_contributions
  ADD COLUMN kind text NOT NULL DEFAULT 'narrative' CHECK (kind IN ('narrative','evidence','resource')),
  ADD COLUMN units integer NOT NULL DEFAULT 1 CHECK (units BETWEEN 1 AND 1000000000),
  ADD COLUMN source_kind text CHECK (source_kind IS NULL OR source_kind IN ('relic','dead_drop','sigil','oath')),
  ADD COLUMN source_id uuid,
  ADD COLUMN economy_transaction_id uuid;

CREATE UNIQUE INDEX community_project_evidence_once
  ON community_project_contributions(project_id,source_kind,source_id)
  WHERE kind='evidence' AND source_id IS NOT NULL AND status='accepted';

ALTER TABLE economy_transactions DROP CONSTRAINT economy_transactions_kind_check;
ALTER TABLE economy_transactions ADD CONSTRAINT economy_transactions_kind_check
  CHECK(kind IN('purchase','adjustment','exchange','oath','project_donation','project_refund'));

CREATE TABLE community_project_consequences (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('content_unlock','broadside_draft')),
  title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 8000),
  audience jsonb NOT NULL DEFAULT '{"type":"event"}' CHECK(jsonb_typeof(audience)='object'),
  position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 99),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,project_id) REFERENCES community_projects(event_id,id) ON DELETE CASCADE,
  UNIQUE(project_id,position), UNIQUE(event_id,id)
);

CREATE TABLE community_project_effects (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  project_id uuid NOT NULL,
  consequence_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('content_unlock','broadside_draft')),
  story_entry_id uuid,
  payload jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,project_id) REFERENCES community_projects(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,consequence_id) REFERENCES community_project_consequences(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,story_entry_id) REFERENCES story_entries(event_id,id) ON DELETE SET NULL,
  UNIQUE(project_id,consequence_id)
);

CREATE INDEX community_project_effects_project ON community_project_effects(project_id,created_at);

CREATE TABLE community_project_refunds (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  project_id uuid NOT NULL,
  contribution_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,project_id) REFERENCES community_projects(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,contribution_id) REFERENCES community_project_contributions(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,transaction_id) REFERENCES economy_transactions(event_id,id),
  UNIQUE(contribution_id)
);
