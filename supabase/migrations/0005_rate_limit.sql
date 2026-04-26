-- =============================================================================
-- 0005_rate_limit.sql — Per-UUID invalid-HMAC rate limiter for /api/scan.
--
-- Backs the rate-limit gate from tech-spec §6 (Threat model #1: QR UUID
-- enumeration) and api-spec §4.2 (10 invalid HMACs per UUID per rolling hour →
-- 429 for the next hour).
--
-- Why per-UUID and not per-IP:
--   An attacker enumerating QR UUIDs can rotate IPs cheaply (residential proxy
--   pools, mobile NAT) but cannot rotate the QR UUID they are probing — it is
--   the very thing they are trying to discover. Keying on UUID also avoids
--   collateral damage to a real dealer scanning many genuine containers from
--   a shared NAT.
--
-- Concurrency model:
--   `record_invalid_hmac(uuid)` performs a single INSERT … ON CONFLICT DO
--   UPDATE that decides — atomically, per row — whether to start a new window,
--   bump the counter, or set the lockout. Two concurrent invalid scans for
--   the same UUID race on the row lock and serialise; neither double-counts.
--
-- RLS:
--   ENABLE ROW LEVEL SECURITY with no policies declared → every verb is denied
--   for anon / authenticated. The scan route uses the service_role client,
--   which bypasses RLS by design. Same posture as scan_attempts (0001_init).
--
-- Hardening:
--   * `SECURITY INVOKER` + `SET search_path = public, pg_temp` so a malicious
--     schema cannot shadow the table even if EXECUTE is granted later.
--   * Constants (window length, threshold, lockout) are inlined as `interval`
--     / `int` literals — single source of truth lives in code comments and is
--     mirrored on the application side in apps/crm/lib/scan/rate-limit.ts.
-- =============================================================================

BEGIN;

CREATE TABLE scan_rate_limits (
  uuid              uuid        PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  invalid_count     integer     NOT NULL CHECK (invalid_count >= 0),
  locked_until      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Lookup index for sweeping expired locks (operational cleanup); not required
-- by the hot read path, which goes straight to the PK.
CREATE INDEX scan_rate_limits_locked_until_idx
  ON scan_rate_limits (locked_until)
  WHERE locked_until IS NOT NULL;

ALTER TABLE scan_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies declared — service_role only.

-- =============================================================================
-- record_invalid_hmac(p_uuid)
--
-- Single-statement upsert that:
--   * inserts a fresh row with count = 1 if none exists
--   * keeps the row untouched if the UUID is currently locked
--   * resets the window (count := 1, lock := NULL) if the existing window has
--     elapsed (≥ 1 hour since window_started_at)
--   * otherwise increments the count, and sets `locked_until = now + 1 hour`
--     when the threshold (10) is reached on this very increment
--
-- Returns one row:
--   locked          boolean — true iff the UUID is locked at the post-update instant
--   retry_after_sec integer — seconds until lock expiry, NULL when not locked
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_invalid_hmac(p_uuid uuid)
RETURNS TABLE (locked boolean, retry_after_sec integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now           timestamptz := now();
  v_window        interval    := interval '1 hour';
  v_lockout       interval    := interval '1 hour';
  v_threshold     integer     := 10;
  v_locked_until  timestamptz;
BEGIN
  INSERT INTO public.scan_rate_limits AS r (
    uuid, window_started_at, invalid_count, locked_until, updated_at
  )
  VALUES (p_uuid, v_now, 1, NULL, v_now)
  ON CONFLICT (uuid) DO UPDATE SET
    window_started_at = CASE
      WHEN r.locked_until IS NOT NULL AND r.locked_until > v_now
        THEN r.window_started_at
      WHEN v_now - r.window_started_at >= v_window
        THEN v_now
      ELSE r.window_started_at
    END,
    invalid_count = CASE
      WHEN r.locked_until IS NOT NULL AND r.locked_until > v_now
        THEN r.invalid_count
      WHEN v_now - r.window_started_at >= v_window
        THEN 1
      ELSE r.invalid_count + 1
    END,
    locked_until = CASE
      WHEN r.locked_until IS NOT NULL AND r.locked_until > v_now
        THEN r.locked_until
      WHEN v_now - r.window_started_at >= v_window
        THEN NULL
      WHEN r.invalid_count + 1 >= v_threshold
        THEN v_now + v_lockout
      ELSE r.locked_until
    END,
    updated_at = v_now
  RETURNING r.locked_until INTO v_locked_until;

  IF v_locked_until IS NOT NULL AND v_locked_until > v_now THEN
    RETURN QUERY SELECT
      true,
      GREATEST(1, ceil(extract(epoch FROM (v_locked_until - v_now)))::integer);
  ELSE
    RETURN QUERY SELECT false, NULL::integer;
  END IF;
END;
$$;

-- service_role only — anon/authenticated never call this RPC directly.
REVOKE ALL ON FUNCTION public.record_invalid_hmac(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_invalid_hmac(uuid) TO service_role;

COMMIT;
