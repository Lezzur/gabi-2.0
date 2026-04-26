-- =============================================================================
-- 0006_config_audit_log.sql — GAIA: Config audit log.
--
-- Append-only log of every admin change to singleton config tables (currently
-- reward_config). Each row stores the before/after JSONB snapshot so that the
-- CRM can present a diff view and forensic investigators can reconstruct the
-- config at any point in time.
--
-- All writes go through service_role in the API routes (no client INSERT/
-- UPDATE/DELETE policy). gabs_admin can read via the SELECT policy below.
-- =============================================================================

BEGIN;

CREATE TABLE config_audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  text        NOT NULL,
  changed_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  before      jsonb,
  after       jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE config_audit_log IS
  'Append-only audit log for admin mutations to singleton config tables (e.g. reward_config). `before` is NULL when the row is first created. Written exclusively via service_role from CRM API routes; authenticated clients have no write policy.';

ALTER TABLE public.config_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY config_audit_log_select_admin
  ON public.config_audit_log
  FOR SELECT
  TO authenticated
  USING ((select app_user_role()) = 'gabs_admin');

COMMENT ON POLICY config_audit_log_select_admin ON public.config_audit_log IS
  'Only gabs_admin can read config audit log entries. No INSERT/UPDATE/DELETE policies — all writes go through service_role in CRM API routes.';

CREATE INDEX idx_config_audit_log_table_created
  ON config_audit_log (table_name, created_at DESC);

COMMIT;
