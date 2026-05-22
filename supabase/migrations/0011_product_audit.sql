-- 0010_product_audit.sql — Product audit log + creator/OCR-source columns.
--
-- Adds two nullable columns to `products` so every product row carries its
-- origin: who created it and which OCR job (if any) sourced the data.
--
-- Creates `product_audit_log` — an append-only record of safety-gate
-- confirmation actions (confirmed_toxicity_category, confirmed_note_to_physician,
-- confirmed_active_ingredient) per api-spec §7.7 and PRD §Phase 5 Safety Gate.
-- The same table will receive future admin actions (status promote, suspend).

BEGIN;

-- Add origin columns to products.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS creator_id  uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ocr_job_id  uuid REFERENCES ocr_jobs(id)   ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_creator_id  ON products (creator_id);
CREATE INDEX IF NOT EXISTS idx_products_ocr_job_id  ON products (ocr_job_id);

-- Product audit log.
CREATE TABLE product_audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES products(id)     ON DELETE RESTRICT,
  user_id     uuid        NOT NULL REFERENCES auth.users(id)   ON DELETE RESTRICT,
  action      text        NOT NULL,
  ocr_job_id  uuid                 REFERENCES ocr_jobs(id)    ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE product_audit_log IS
  'Append-only record of safety-gate confirmations and admin status changes on products. '
  'Every row from the OCR confirm endpoint records action=''ocr_confirm'' plus the ocr_job_id. '
  'Future promote/suspend actions will record their own action strings. Never update or delete rows.';

CREATE INDEX idx_product_audit_log_product_id  ON product_audit_log (product_id);
CREATE INDEX idx_product_audit_log_user_id     ON product_audit_log (user_id);
CREATE INDEX idx_product_audit_log_created_at  ON product_audit_log (created_at DESC);

-- Append-only: reject UPDATE and DELETE.
CREATE OR REPLACE FUNCTION product_audit_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'product_audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_product_audit_log_no_update
  BEFORE UPDATE ON product_audit_log
  FOR EACH ROW EXECUTE FUNCTION product_audit_log_reject_mutation();

CREATE TRIGGER trg_product_audit_log_no_delete
  BEFORE DELETE ON product_audit_log
  FOR EACH ROW EXECUTE FUNCTION product_audit_log_reject_mutation();

COMMIT;
