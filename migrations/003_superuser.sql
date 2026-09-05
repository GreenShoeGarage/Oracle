ALTER TABLE users ADD COLUMN is_superuser boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN is_disabled boolean NOT NULL DEFAULT false;

CREATE TABLE system_audit_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_audit_recent_idx ON system_audit_entries(id DESC);
CREATE INDEX system_audit_target_idx ON system_audit_entries(target_user_id,id DESC);
