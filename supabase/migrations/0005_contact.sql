-- =============================================================================
-- 0005_contact.sql — Contact form submissions table.
--
-- Stores every validated contact submission from the /api/contact endpoint.
-- Rate-limiting is enforced via the ip_hash index (SHA-256 of IP + HMAC_SECRET,
-- server-side). No public RLS policies — the table is service-role only.
--
-- Intentional decisions:
--   * ip_hash stores a 32-char hex prefix of SHA-256(HMAC_SECRET:ip) so raw IPs
--     are never persisted while rate-limiting queries remain O(log n).
--   * CHECK constraints mirror the Zod schema in apps/website/app/api/contact/route.ts.
--     They are defence-in-depth, not a substitute for application validation.
--   * No updated_at column — rows are append-only (admin updates status via service role).
-- =============================================================================

BEGIN;

CREATE TYPE contact_topic AS ENUM (
  'general',
  'dealer_inquiry',
  'report_counterfeit',
  'other'
);

CREATE TYPE contact_status AS ENUM (
  'new',
  'read',
  'replied',
  'archived'
);

CREATE TABLE contact_submissions (
  id         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text           NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email      text           NOT NULL CHECK (email LIKE '%@%'),
  phone      text           CHECK (phone IS NULL OR char_length(phone) <= 30),
  topic      contact_topic  NOT NULL DEFAULT 'general',
  message    text           NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  status     contact_status NOT NULL DEFAULT 'new',
  ip_hash    text,
  created_at timestamptz    NOT NULL DEFAULT now()
);

-- Admin queue: newest 'new' submissions first
CREATE INDEX contact_submissions_status_idx
  ON contact_submissions (status, created_at DESC);

-- Rate-limit check: count recent rows from the same hashed IP
CREATE INDEX contact_submissions_ip_hash_idx
  ON contact_submissions (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
-- No public policies — reads and inserts go through service role only.

COMMIT;
