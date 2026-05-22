-- =============================================================================
-- 0007_idempotency.sql — Idempotency-key store for /api/scan offline replays.
--
-- Backs the dedup gate from tech-spec §5.2 (offline scan, queued, replayed
-- minutes-to-hours later) and api-spec §6.1 (mobile retries after a 200
-- response is lost in transit). The mobile client picks one v4 UUID per
-- queued scan; the server caches the full response body for 24 h so a
-- replay returns the original outcome byte-for-byte instead of executing
-- the state machine twice.
--
-- Why a dedicated table and not the existing scan_attempts dedup tuple
-- (device_id, container_id, step, local_scan_ts) from api-spec §6.1:
--   That tuple lets the server recognise a retry of *the same logical
--   scan* and skip the side effects, but it can't reproduce the response
--   payload — translations, expiry timestamps, and rewards_credited are
--   computed at scan time and would drift on re-derivation. This table
--   stores the rendered response, so a 24-h replay returns identical
--   bytes (including the original `pending_expires_at`, `request_id`,
--   etc.) the client may have already keyed UI state on.
--
-- Uniqueness model:
--   `key` is PRIMARY KEY (globally unique). The auth'd user_id is
--   recorded so the lookup path can require (key, user_id) to match —
--   user B cannot ever read user A's cached response, and an attempt to
--   reuse user A's key under user B fails on the PK and is rejected by
--   the storeIdempotency caller (returns 503 rather than silently
--   degrading to non-idempotent mode — see scan/idempotency.ts header).
--   Conceptually the uniqueness tuple is (key, user_id); the PK is
--   tighter than necessary because v4-UUID keys collide with vanishing
--   probability and a single PK is cheaper to look up than a composite.
--
-- RLS:
--   ENABLE ROW LEVEL SECURITY with no policies declared → every verb is
--   denied for anon / authenticated. The scan route uses the
--   service_role client, which bypasses RLS by design. Same posture as
--   pending_purchase / scan_rate_limits.
--
-- Cleanup:
--   `expires_at` defaults to now() + 24 h. A scheduled job (pg_cron in
--   prod, manual sweep in dev — see stub at the foot of this migration)
--   prunes rows where `expires_at < now()` so the table stays bounded.
--   Until that job lands, checkIdempotency() in scan/idempotency.ts
--   treats expired rows as a miss so a stale row never serves a result
--   the operator hasn't authorised to live longer than the 24 h SLA.
-- =============================================================================

BEGIN;

CREATE TABLE scan_idempotency (
  key            uuid        PRIMARY KEY,
  user_id        uuid        NOT NULL,
  response_body  jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

COMMENT ON TABLE scan_idempotency IS
  'Cached response bodies for /api/scan, keyed by client-supplied UUID. 24-hour TTL. Pruned by a scheduled job (see migration footer). user_id scopes lookups so one user cannot read another user''s cached response (see apps/crm/lib/scan/idempotency.ts).';

-- Sweep / per-user-history index. The hot read path goes through the PK
-- (lookup by `key`); this composite supports the cleanup job
-- (`WHERE expires_at < now()` benefits from the implicit ordering on
-- created_at — older rows expire first) and any operator query that
-- wants to enumerate a user's recent idempotency activity.
CREATE INDEX scan_idempotency_user_created_idx
  ON scan_idempotency (user_id, created_at);

ALTER TABLE scan_idempotency ENABLE ROW LEVEL SECURITY;
-- No policies declared — service_role only.

-- =============================================================================
-- Scheduled cleanup — STUB.
--
-- Production: schedule the following statement nightly (or hourly under
-- load) via pg_cron once the extension is enabled in the project:
--
--   SELECT cron.schedule(
--     'scan_idempotency_prune',
--     '0 * * * *',
--     $$ DELETE FROM public.scan_idempotency WHERE expires_at < now() $$
--   );
--
-- Dev / manual: the same DELETE can be run on demand. Until pg_cron is
-- wired, checkIdempotency() in apps/crm/lib/scan/idempotency.ts treats
-- expired rows as a cache miss, so a delayed sweep does not leak stale
-- responses — it only delays reclaiming row storage.
-- =============================================================================

COMMIT;
