-- 0011_batch_log.sql — Idempotency log for container batch generation.
--
-- `batch_generation_log` records every container batch that has been committed.
-- The `idempotency_key` column (UNIQUE) is the caller-supplied dedup token:
-- a second POST with the same key returns the original batch_id without
-- re-inserting any containers. This prevents double-generation when a CRM
-- admin retries a timed-out request.
--
-- Spec: api-spec §8.3 (containers/generate), PRD §Phase 6.

BEGIN;

CREATE TABLE batch_generation_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  text        NOT NULL UNIQUE,
  batch_id         uuid        NOT NULL,
  product_id       uuid        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity         integer     NOT NULL CHECK (quantity > 0 AND quantity <= 10000),
  created_by       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE batch_generation_log IS
  'One row per committed container batch. `idempotency_key` (caller-supplied, UNIQUE) '
  'prevents double-creation on retry. `batch_id` is the UUID the caller uses to '
  'reference the batch in subsequent label-export calls. `quantity` is the number of '
  'containers actually inserted (matches the request input; bounded 1–10000 by CHECK).';

CREATE INDEX idx_batch_generation_log_product_id  ON batch_generation_log (product_id);
CREATE INDEX idx_batch_generation_log_created_by  ON batch_generation_log (created_by);
CREATE INDEX idx_batch_generation_log_created_at  ON batch_generation_log (created_at DESC);

COMMIT;
