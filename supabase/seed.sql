-- =============================================================================
-- seed.sql — GAIA development seed data
--
-- *** LOCAL / CI USE ONLY — NEVER run against a production database. ***
--
-- Idempotent: every INSERT uses ON CONFLICT DO NOTHING.
-- UUIDs are v5-namespaced (namespace bfd1e9e1-b1b8-4d4b-a5e6-73af14916b7e)
-- so re-runs produce identical IDs.
--
-- Populates:
--   • 2 GABS admin users
--   • 1 manufacturer account (brand_admin)
--   • 3 dealer accounts (2 verified, 1 unverified)
--   • 3 farmer users
--   • 20 products across HERBICIDE / INSECTICIDE / FUNGICIDE
--   • 100 containers spread across all container states
--   • 10 pre-completed scan_attempts (purchase + return flows)
--   • 20 wallet_transactions (10 rewards_paid containers × 2 credits each)
--
-- Depends on: all migrations through 0007 (pgcrypto already loaded in 0001).
-- reward_config row is seeded in 0002_aux.sql — not repeated here.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: deterministic UUID v5 using the project seed namespace
-- Namespace: bfd1e9e1-b1b8-4d4b-a5e6-73af14916b7e
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_uuid_v5(name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  ns  bytea := decode('bfd1e9e1b1b84d4ba5e673af14916b7e', 'hex');
  h   bytea;
BEGIN
  h := digest(ns || convert_to(name, 'utf8'), 'sha1');
  h := set_byte(h, 6, (get_byte(h, 6) & 15)  | 80);   -- version 5
  h := set_byte(h, 8, (get_byte(h, 8) & 63)  | 128);  -- RFC 4122 variant
  RETURN (
    encode(substr(h,  1, 4), 'hex') || '-' ||
    encode(substr(h,  5, 2), 'hex') || '-' ||
    encode(substr(h,  7, 2), 'hex') || '-' ||
    encode(substr(h,  9, 2), 'hex') || '-' ||
    encode(substr(h, 11, 6), 'hex')
  )::uuid;
END;
$$;

-- ---------------------------------------------------------------------------
-- auth.users  (local Supabase dev; password = Demo1234! for all seed users)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pw text := crypt('Demo1234!', gen_salt('bf'));
  meta_email jsonb := '{"provider":"email","providers":["email"]}'::jsonb;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at
  ) VALUES
    (seed_uuid_v5('user:admin-1@demo.gaia.ph'),    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-1@demo.gaia.ph',    pw, now(), meta_email, '{}', false, now(), now()),
    (seed_uuid_v5('user:admin-2@demo.gaia.ph'),    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-2@demo.gaia.ph',    pw, now(), meta_email, '{}', false, now(), now()),
    (seed_uuid_v5('user:mfg-1@demo.gaia.ph'),      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mfg-1@demo.gaia.ph',      pw, now(), meta_email, '{}', false, now(), now()),
    (seed_uuid_v5('user:dealer-1@demo.gaia.ph'),   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dealer-1@demo.gaia.ph',   pw, now(), meta_email, '{}', false, now(), now()),
    (seed_uuid_v5('user:dealer-2@demo.gaia.ph'),   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dealer-2@demo.gaia.ph',   pw, now(), meta_email, '{}', false, now(), now()),
    (seed_uuid_v5('user:dealer-3@demo.gaia.ph'),   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dealer-3@demo.gaia.ph',   pw, now(), meta_email, '{}', false, now(), now()),
    (seed_uuid_v5('user:farmer-1@demo.gaia.ph'),   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'farmer-1@demo.gaia.ph',   pw, now(), meta_email, '{}', false, now(), now()),
    (seed_uuid_v5('user:farmer-2@demo.gaia.ph'),   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'farmer-2@demo.gaia.ph',   pw, now(), meta_email, '{}', false, now(), now()),
    (seed_uuid_v5('user:farmer-3@demo.gaia.ph'),   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'farmer-3@demo.gaia.ph',   pw, now(), meta_email, '{}', false, now(), now())
  ON CONFLICT DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- user_profiles
-- ---------------------------------------------------------------------------
INSERT INTO user_profiles (id, role, display_name, phone_number)
VALUES
  (seed_uuid_v5('user:admin-1@demo.gaia.ph'),   'gabs_admin',  'Demo Admin One',      '+639170000001'),
  (seed_uuid_v5('user:admin-2@demo.gaia.ph'),   'gabs_admin',  'Demo Admin Two',      '+639170000002'),
  (seed_uuid_v5('user:mfg-1@demo.gaia.ph'),     'brand_admin', 'Demo Manufacturer',   '+639170000003'),
  (seed_uuid_v5('user:dealer-1@demo.gaia.ph'),  'dealer',      'Demo Dealer One',     '+639170000011'),
  (seed_uuid_v5('user:dealer-2@demo.gaia.ph'),  'dealer',      'Demo Dealer Two',     '+639170000012'),
  (seed_uuid_v5('user:dealer-3@demo.gaia.ph'),  'dealer',      'Demo Dealer Three',   '+639170000013'),
  (seed_uuid_v5('user:farmer-1@demo.gaia.ph'),  'farmer',      'Test Farmer One',     '+639170000021'),
  (seed_uuid_v5('user:farmer-2@demo.gaia.ph'),  'farmer',      'Test Farmer Two',     '+639170000022'),
  (seed_uuid_v5('user:farmer-3@demo.gaia.ph'),  'farmer',      'Test Farmer Three',   '+639170000023')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- dealer_accounts  (dealer-3 left unverified for testing)
-- ---------------------------------------------------------------------------
INSERT INTO dealer_accounts (id, user_id, business_name, territory_notes, is_verified, verified_by, verified_at)
VALUES
  (
    seed_uuid_v5('dealer-account:1'),
    seed_uuid_v5('user:dealer-1@demo.gaia.ph'),
    'Demo Agri Shop One',
    'Metro Manila — northern district',
    true,
    seed_uuid_v5('user:admin-1@demo.gaia.ph'),
    now() - interval '60 days'
  ),
  (
    seed_uuid_v5('dealer-account:2'),
    seed_uuid_v5('user:dealer-2@demo.gaia.ph'),
    'Test Farm Supply Co.',
    'Cavite — general area',
    true,
    seed_uuid_v5('user:admin-1@demo.gaia.ph'),
    now() - interval '45 days'
  ),
  (
    seed_uuid_v5('dealer-account:3'),
    seed_uuid_v5('user:dealer-3@demo.gaia.ph'),
    'Sample Crop Store Three',
    'Laguna — pending area assignment',
    false,
    NULL,
    NULL
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- manufacturer_accounts
-- ---------------------------------------------------------------------------
INSERT INTO manufacturer_accounts (id, user_id, company_name, onboarded_by)
VALUES (
  seed_uuid_v5('manufacturer-account:1'),
  seed_uuid_v5('user:mfg-1@demo.gaia.ph'),
  'Test AgriChem Industries Inc.',
  seed_uuid_v5('user:admin-1@demo.gaia.ph')
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- products (20 total: 10 active, 8 draft, 2 suspended)
-- Active products have category + note_to_physician confirmed.
-- Draft products have neither confirmed (safety review pending).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  admin1 uuid := seed_uuid_v5('user:admin-1@demo.gaia.ph');
  now_ts timestamptz := now();
  conf_at timestamptz := now() - interval '30 days';

  -- Shared fake notes per toxicity category
  note2 text := 'Highly toxic — call a doctor immediately. No specific antidote; treatment is symptomatic. Keep out of reach of children.';
  note3 text := 'Moderately hazardous — seek medical attention if symptoms persist. Treatment is symptomatic. Keep out of reach of children.';
  note4 text := 'Slightly hazardous — seek medical attention only if large quantities ingested. Treat symptomatically.';
BEGIN
  INSERT INTO products (
    id, product_name, brand_name, company,
    active_ingredient, concentration, formulation_type, type, category,
    fpa_registration_number, fpa_registration_expires_at, fpa_last_imported_at,
    mode_of_entry, mode_of_action_group, dosage_rate, pests,
    note_to_physician, status,
    category_confirmed_by, category_confirmed_at,
    note_to_physician_confirmed_by, note_to_physician_confirmed_at
  ) VALUES

  -- -------------------------------------------------------------------------
  -- HERBICIDE — 8 products (4 active, 2 draft, 2 suspended)
  -- -------------------------------------------------------------------------
  (
    seed_uuid_v5('product:1'), 'Demo Butachlor 500 EC', 'DemoButach',
    'Test AgriChem Industries Inc.',
    'Butachlor', '500 g/L', 'EC', 'HERBICIDE', '3',
    'FPA-TEST-H001', '2027-12-31', now() - interval '90 days',
    'CONTACT', 'Group K', '1–2 L/ha',
    'Barnyard grass; Sprangletop; Annual sedges',
    note3, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:2'), 'Test Glyphosate 760 WG', 'TestGlyph',
    'Demo Crop Science Ltd.',
    'Glyphosate isopropylamine salt', '760 g/kg', 'WG', 'HERBICIDE', '4',
    'FPA-TEST-H002', '2028-06-30', now() - interval '90 days',
    'SYSTEMIC', 'Group 9', '2–3 kg/ha',
    'Annual and perennial grasses; Broadleaf weeds',
    note4, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:3'), 'Sample Oxyfluorfen 240 EC', 'SampleOxy',
    'Test AgriChem Industries Inc.',
    'Oxyfluorfen', '240 g/L', 'EC', 'HERBICIDE', NULL,
    NULL, NULL, NULL,
    'CONTACT', 'Group E', '0.5–1 L/ha',
    'Broadleaf weeds; Grasses',
    NULL, 'draft', NULL, NULL, NULL, NULL
  ),
  (
    seed_uuid_v5('product:4'), 'Demo 2,4-D Amine 720 SL', 'Demo24D',
    'Demo Crop Science Ltd.',
    '2,4-Dichlorophenoxyacetic acid', '720 g/L', 'SL', 'HERBICIDE', NULL,
    'FPA-TEST-H004', '2027-03-31', now() - interval '90 days',
    'SYSTEMIC', 'Group O', '1–1.5 L/ha',
    'Broadleaf weeds in rice; Annual sedges',
    NULL, 'draft', NULL, NULL, NULL, NULL
  ),
  (
    seed_uuid_v5('product:5'), 'Test Propanil 360 EC', 'TestPropan',
    'Sample Agri Corp.',
    'Propanil', '360 g/L', 'EC', 'HERBICIDE', '3',
    'FPA-TEST-H005', '2027-09-30', now() - interval '90 days',
    'CONTACT', 'Group C2', '3–4 L/ha',
    'Barnyard grass; Broadleaf weeds in wetland rice',
    note3, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:6'), 'Sample Pendimethalin 330 EC', 'SampPendi',
    'Test AgriChem Industries Inc.',
    'Pendimethalin', '330 g/L', 'EC', 'HERBICIDE', NULL,
    NULL, NULL, NULL,
    'CONTACT', 'Group K1', '2.5–3 L/ha',
    'Annual grasses; Broadleaf weeds in corn',
    NULL, 'draft', NULL, NULL, NULL, NULL
  ),
  (
    seed_uuid_v5('product:7'), 'Demo Pretilachlor 500 EC', 'DemoPretil',
    'Demo Crop Science Ltd.',
    'Pretilachlor', '500 g/L', 'EC', 'HERBICIDE', '3',
    'FPA-TEST-H007', '2026-06-30', now() - interval '180 days',
    'CONTACT', 'Group K3', '1.5–2 L/ha',
    'Barnyard grass; Sedge; Broadleaf weeds',
    note3, 'suspended', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:8'), 'Test Atrazine 80 WP', 'TestAtra',
    'Sample Agri Corp.',
    'Atrazine', '800 g/kg', 'WP', 'HERBICIDE', '3',
    'FPA-TEST-H008', '2028-12-31', now() - interval '90 days',
    'SYSTEMIC', 'Group C1', '1.5–2 kg/ha',
    'Broadleaf weeds; Grasses in corn',
    note3, 'active', admin1, conf_at, admin1, conf_at
  ),

  -- -------------------------------------------------------------------------
  -- INSECTICIDE — 7 products (4 active, 3 draft)
  -- -------------------------------------------------------------------------
  (
    seed_uuid_v5('product:9'), 'Demo Chlorpyrifos 480 EC', 'DemoClor',
    'Test AgriChem Industries Inc.',
    'Chlorpyrifos', '480 g/L', 'EC', 'INSECTICIDE', '2',
    'FPA-TEST-I001', '2027-12-31', now() - interval '90 days',
    'CONTACT', 'Group 1B', '1–2 L/ha',
    'Stem borers; Leaf folders; Thrips; Aphids',
    note2, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:10'), 'Test Lambda-cyhalothrin 25 SC', 'TestLambda',
    'Demo Crop Science Ltd.',
    'Lambda-cyhalothrin', '25 g/L', 'SC', 'INSECTICIDE', NULL,
    NULL, NULL, NULL,
    'CONTACT', 'Group 3A', '0.3–0.5 L/ha',
    'Aphids; Whiteflies; Leaf folders',
    NULL, 'draft', NULL, NULL, NULL, NULL
  ),
  (
    seed_uuid_v5('product:11'), 'Sample Cypermethrin 100 EC', 'SampCyper',
    'Sample Agri Corp.',
    'Cypermethrin', '100 g/L', 'EC', 'INSECTICIDE', '3',
    'FPA-TEST-I003', '2027-06-30', now() - interval '90 days',
    'CONTACT', 'Group 3A', '0.5–1 L/ha',
    'Stem borers; Pod borers; Fruit flies',
    note3, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:12'), 'Demo Imidacloprid 200 SL', 'DemoImida',
    'Test AgriChem Industries Inc.',
    'Imidacloprid', '200 g/L', 'SL', 'INSECTICIDE', NULL,
    'FPA-TEST-I004', '2027-12-31', now() - interval '90 days',
    'SYSTEMIC', 'Group 4A', '0.5 L/ha',
    'Brown planthopper; Green leafhopper; Aphids; Whiteflies',
    NULL, 'draft', NULL, NULL, NULL, NULL
  ),
  (
    seed_uuid_v5('product:13'), 'Test Profenofos 500 EC', 'TestProfen',
    'Demo Crop Science Ltd.',
    'Profenofos', '500 g/L', 'EC', 'INSECTICIDE', '2',
    'FPA-TEST-I005', '2028-03-31', now() - interval '90 days',
    'CONTACT', 'Group 1B', '0.5–1 L/ha',
    'Thrips; Mites; Aphids; Bollworms',
    note2, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:14'), 'Sample Deltamethrin 25 EC', 'SampDelta',
    'Sample Agri Corp.',
    'Deltamethrin', '25 g/L', 'EC', 'INSECTICIDE', '2',
    'FPA-TEST-I006', '2027-09-30', now() - interval '90 days',
    'CONTACT', 'Group 3A', '0.5 L/ha',
    'Stem borers; Leaf folders; Pod borers; Aphids',
    note2, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:15'), 'Demo Abamectin 18 EC', 'DemoAbam',
    'Test AgriChem Industries Inc.',
    'Abamectin', '18 g/L', 'EC', 'INSECTICIDE', NULL,
    NULL, NULL, NULL,
    'CONTACT', 'Group 6', '0.5–0.75 L/ha',
    'Spider mites; Leaf miners; Thrips',
    NULL, 'draft', NULL, NULL, NULL, NULL
  ),

  -- -------------------------------------------------------------------------
  -- FUNGICIDE — 5 products (2 active, 2 draft, 1 suspended)
  -- -------------------------------------------------------------------------
  (
    seed_uuid_v5('product:16'), 'Test Mancozeb 800 WP', 'TestManco',
    'Demo Crop Science Ltd.',
    'Mancozeb', '800 g/kg', 'WP', 'FUNGICIDE', '3',
    'FPA-TEST-F001', '2027-12-31', now() - interval '90 days',
    'CONTACT', 'Group M3', '2–3 kg/ha',
    'Leaf blast; Sheath blight; Downy mildew; Late blight',
    note3, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:17'), 'Sample Carbendazim 500 SC', 'SampCarb',
    'Sample Agri Corp.',
    'Carbendazim', '500 g/L', 'SC', 'FUNGICIDE', NULL,
    NULL, NULL, NULL,
    'SYSTEMIC', 'Group 1', '0.5–1 L/ha',
    'Blast; Sheath blight; Bakanae; Brown spot',
    NULL, 'draft', NULL, NULL, NULL, NULL
  ),
  (
    seed_uuid_v5('product:18'), 'Demo Propiconazole 250 EC', 'DemoPropic',
    'Test AgriChem Industries Inc.',
    'Propiconazole', '250 g/L', 'EC', 'FUNGICIDE', '2',
    'FPA-TEST-F003', '2028-06-30', now() - interval '90 days',
    'SYSTEMIC', 'Group 3', '0.5 L/ha',
    'Sheath blight; Brown spot; Narrow brown leaf spot',
    note2, 'active', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:19'), 'Test Copper Hydroxide 77 WP', 'TestCopHyd',
    'Demo Crop Science Ltd.',
    'Copper hydroxide', '770 g/kg', 'WP', 'FUNGICIDE', '3',
    'FPA-TEST-F004', '2026-09-30', now() - interval '180 days',
    'CONTACT', 'Group M1', '2–3 kg/ha',
    'Angular leaf spot; Downy mildew; Early blight',
    note3, 'suspended', admin1, conf_at, admin1, conf_at
  ),
  (
    seed_uuid_v5('product:20'), 'Sample Metalaxyl 8 WP', 'SampMetal',
    'Sample Agri Corp.',
    'Metalaxyl', '80 g/kg', 'WP', 'FUNGICIDE', NULL,
    NULL, NULL, NULL,
    'SYSTEMIC', 'Group 4', '2 kg/ha',
    'Downy mildew; Late blight; Damping off',
    NULL, 'draft', NULL, NULL, NULL, NULL
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- product_crops  (active + suspended products only, 2–3 crops each)
-- ---------------------------------------------------------------------------
INSERT INTO product_crops (id, product_id, crop, pests)
VALUES
  -- product:1  Demo Butachlor 500 EC (HERBICIDE, active)
  (seed_uuid_v5('crop:1:rice'),       seed_uuid_v5('product:1'), 'Rice',       'Barnyard grass; Sprangletop; Annual sedges'),
  (seed_uuid_v5('crop:1:corn'),       seed_uuid_v5('product:1'), 'Corn',       'Annual grasses; Broadleaf weeds'),

  -- product:2  Test Glyphosate 760 WG (HERBICIDE, active)
  (seed_uuid_v5('crop:2:sugarcane'),  seed_uuid_v5('product:2'), 'Sugarcane',  'Annual and perennial grasses; Broadleaf weeds'),
  (seed_uuid_v5('crop:2:orchard'),    seed_uuid_v5('product:2'), 'Orchard',    'Perennial weeds; Grasses'),
  (seed_uuid_v5('crop:2:corn'),       seed_uuid_v5('product:2'), 'Corn',       'Annual grasses; Broadleaf weeds'),

  -- product:5  Test Propanil 360 EC (HERBICIDE, active)
  (seed_uuid_v5('crop:5:rice'),       seed_uuid_v5('product:5'), 'Rice',       'Barnyard grass; Broadleaf weeds'),

  -- product:7  Demo Pretilachlor 500 EC (HERBICIDE, suspended)
  (seed_uuid_v5('crop:7:rice'),       seed_uuid_v5('product:7'), 'Rice',       'Barnyard grass; Sedge; Broadleaf weeds'),

  -- product:8  Test Atrazine 80 WP (HERBICIDE, active)
  (seed_uuid_v5('crop:8:corn'),       seed_uuid_v5('product:8'), 'Corn',       'Broadleaf weeds; Annual grasses'),
  (seed_uuid_v5('crop:8:sugarcane'),  seed_uuid_v5('product:8'), 'Sugarcane',  'Broadleaf weeds'),

  -- product:9  Demo Chlorpyrifos 480 EC (INSECTICIDE, active)
  (seed_uuid_v5('crop:9:rice'),       seed_uuid_v5('product:9'), 'Rice',       'Stem borers; Leaf folders; Thrips'),
  (seed_uuid_v5('crop:9:corn'),       seed_uuid_v5('product:9'), 'Corn',       'Corn borers; Aphids; Armyworms'),
  (seed_uuid_v5('crop:9:vegetables'), seed_uuid_v5('product:9'), 'Vegetables', 'Aphids; Thrips; Leaf miners'),

  -- product:11  Sample Cypermethrin 100 EC (INSECTICIDE, active)
  (seed_uuid_v5('crop:11:rice'),      seed_uuid_v5('product:11'), 'Rice',      'Stem borers; Leaf folders'),
  (seed_uuid_v5('crop:11:mango'),     seed_uuid_v5('product:11'), 'Mango',     'Fruit flies; Mango hoppers; Scale insects'),

  -- product:13  Test Profenofos 500 EC (INSECTICIDE, active)
  (seed_uuid_v5('crop:13:vegetables'),seed_uuid_v5('product:13'), 'Vegetables','Thrips; Aphids; Whiteflies'),
  (seed_uuid_v5('crop:13:cotton'),    seed_uuid_v5('product:13'), 'Cotton',    'Bollworms; Mites; Aphids'),

  -- product:14  Sample Deltamethrin 25 EC (INSECTICIDE, active)
  (seed_uuid_v5('crop:14:rice'),      seed_uuid_v5('product:14'), 'Rice',      'Stem borers; Leaf folders'),
  (seed_uuid_v5('crop:14:corn'),      seed_uuid_v5('product:14'), 'Corn',      'Corn borers; Pod borers'),

  -- product:16  Test Mancozeb 800 WP (FUNGICIDE, active)
  (seed_uuid_v5('crop:16:rice'),      seed_uuid_v5('product:16'), 'Rice',      'Leaf blast; Sheath blight; Brown spot'),
  (seed_uuid_v5('crop:16:potato'),    seed_uuid_v5('product:16'), 'Potato',    'Late blight; Early blight'),
  (seed_uuid_v5('crop:16:tomato'),    seed_uuid_v5('product:16'), 'Tomato',    'Late blight; Early blight; Downy mildew'),

  -- product:18  Demo Propiconazole 250 EC (FUNGICIDE, active)
  (seed_uuid_v5('crop:18:rice'),      seed_uuid_v5('product:18'), 'Rice',      'Sheath blight; Brown spot'),
  (seed_uuid_v5('crop:18:banana'),    seed_uuid_v5('product:18'), 'Banana',    'Sigatoka leaf spot; Black leaf streak'),

  -- product:19  Test Copper Hydroxide 77 WP (FUNGICIDE, suspended)
  (seed_uuid_v5('crop:19:mango'),     seed_uuid_v5('product:19'), 'Mango',     'Anthracnose; Powdery mildew'),
  (seed_uuid_v5('crop:19:vegetables'),seed_uuid_v5('product:19'), 'Vegetables','Angular leaf spot; Downy mildew')

ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- containers (100 total)
--   1–40:   in_distribution
--  41–70:   purchased
--  71–90:   returned
--  91–100:  rewards_paid
--
-- Odd containers use dealer-1 / farmer-1; even use dealer-2 / farmer-2.
-- dealer-3 and farmer-3 are left unused intentionally (testing edge cases).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dealer1_id  uuid := seed_uuid_v5('dealer-account:1');
  dealer2_id  uuid := seed_uuid_v5('dealer-account:2');
  farmer1_uid uuid := seed_uuid_v5('user:farmer-1@demo.gaia.ph');
  farmer2_uid uuid := seed_uuid_v5('user:farmer-2@demo.gaia.ph');

  prod_ids uuid[] := ARRAY[
    seed_uuid_v5('product:1'),  seed_uuid_v5('product:2'),  seed_uuid_v5('product:3'),
    seed_uuid_v5('product:4'),  seed_uuid_v5('product:5'),  seed_uuid_v5('product:6'),
    seed_uuid_v5('product:7'),  seed_uuid_v5('product:8'),  seed_uuid_v5('product:9'),
    seed_uuid_v5('product:10'), seed_uuid_v5('product:11'), seed_uuid_v5('product:12'),
    seed_uuid_v5('product:13'), seed_uuid_v5('product:14'), seed_uuid_v5('product:15'),
    seed_uuid_v5('product:16'), seed_uuid_v5('product:17'), seed_uuid_v5('product:18'),
    seed_uuid_v5('product:19'), seed_uuid_v5('product:20')
  ];

  i            int;
  cid          uuid;
  c_hmac       text;
  c_suffix     char(16);
  c_product    uuid;
  c_state      container_state;
  c_dealer     uuid;
  c_farmer     uuid;
  c_purch_at   timestamptz;
  c_ret_at     timestamptz;
  c_rwd_at     timestamptz;
BEGIN
  FOR i IN 1..100 LOOP
    cid      := seed_uuid_v5('container:' || i::text);
    c_hmac   := encode(digest('GAIA_SEED_HMAC:' || cid::text, 'sha256'), 'hex');
    c_suffix := right(c_hmac, 16);
    c_product := prod_ids[((i - 1) % 20) + 1];

    -- Dealer / farmer assignment (odd → pair 1, even → pair 2)
    c_dealer := CASE WHEN i % 2 = 1 THEN dealer1_id ELSE dealer2_id END;
    c_farmer := CASE WHEN i % 2 = 1 THEN farmer1_uid ELSE farmer2_uid END;

    IF i <= 40 THEN
      c_state    := 'in_distribution';
      c_dealer   := NULL;
      c_farmer   := NULL;
      c_purch_at := NULL;
      c_ret_at   := NULL;
      c_rwd_at   := NULL;
    ELSIF i <= 70 THEN
      c_state    := 'purchased';
      c_purch_at := now() - make_interval(days := 61 - (i - 41));  -- 60..31 days ago
      c_ret_at   := NULL;
      c_rwd_at   := NULL;
    ELSIF i <= 90 THEN
      c_state    := 'returned';
      c_purch_at := now() - make_interval(days := 91 - (i - 71));  -- 90..71 days ago
      c_ret_at   := now() - make_interval(days := 61 - (i - 71));  -- 60..41 days ago
      c_rwd_at   := NULL;
    ELSE
      c_state    := 'rewards_paid';
      c_purch_at := now() - make_interval(days := 121 - (i - 91)); -- 120..111 days ago
      c_ret_at   := now() - make_interval(days := 91 - (i - 91));  -- 90..81 days ago
      c_rwd_at   := now() - make_interval(days := 61 - (i - 91));  -- 60..51 days ago
    END IF;

    INSERT INTO containers (
      id, product_id, hmac, hmac_suffix, batch_number, manufacture_date,
      state,
      purchased_by_user_id, dealer_id, purchased_at,
      returned_by_user_id, return_dealer_id, returned_at,
      rewards_paid_at
    ) VALUES (
      cid, c_product, c_hmac, c_suffix,
      'BATCH-2025-' || LPAD(i::text, 3, '0'),
      '2025-01-01'::date,
      c_state,
      c_farmer,  c_dealer,  c_purch_at,
      CASE WHEN c_ret_at IS NOT NULL THEN c_farmer ELSE NULL END,
      CASE WHEN c_ret_at IS NOT NULL THEN c_dealer ELSE NULL END,
      c_ret_at,
      c_rwd_at
    ) ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- wallets
-- Pre-calculated balances:
--   farmer-1 / farmer-2: 5 rewards_paid containers × 100 pts = 500 pts each
--   dealer-1 / dealer-2: 5 rewards_paid containers × 50 pts  = 250 pts each
--   farmer-3 / dealer-3: 0 pts (no activity)
-- ---------------------------------------------------------------------------
INSERT INTO wallets (id, user_id, balance_points)
VALUES
  (seed_uuid_v5('wallet:farmer-1'),  seed_uuid_v5('user:farmer-1@demo.gaia.ph'),  500),
  (seed_uuid_v5('wallet:farmer-2'),  seed_uuid_v5('user:farmer-2@demo.gaia.ph'),  500),
  (seed_uuid_v5('wallet:farmer-3'),  seed_uuid_v5('user:farmer-3@demo.gaia.ph'),  0),
  (seed_uuid_v5('wallet:dealer-1'),  seed_uuid_v5('user:dealer-1@demo.gaia.ph'),  250),
  (seed_uuid_v5('wallet:dealer-2'),  seed_uuid_v5('user:dealer-2@demo.gaia.ph'),  250),
  (seed_uuid_v5('wallet:dealer-3'),  seed_uuid_v5('user:dealer-3@demo.gaia.ph'),  0)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- scan_attempts  (10 rows: 4 purchase steps + 6 return steps)
--
-- Purchase flows: containers 41 and 42 (currently in 'purchased' state).
-- Return flows: containers 91, 92, 93 (currently in 'rewards_paid' state).
-- All scans are successful for history demo clarity.
-- ---------------------------------------------------------------------------
INSERT INTO scan_attempts (
  id, container_id, actor_id, actor_type,
  step, outcome, hmac_valid, auth_valid,
  ip_address, local_scan_ts, sync_ts, device_id
) VALUES
  -- Container 41: dealer-1 initiates purchase
  (
    seed_uuid_v5('scan:1'),
    seed_uuid_v5('container:41'),
    seed_uuid_v5('user:dealer-1@demo.gaia.ph'),
    'dealer',
    'purchase_dealer', 'success', true, true,
    '192.168.1.1'::inet,
    now() - interval '60 days' - interval '5 minutes',
    now() - interval '60 days',
    'seed-device-d1'
  ),
  -- Container 41: farmer-1 confirms purchase
  (
    seed_uuid_v5('scan:2'),
    seed_uuid_v5('container:41'),
    seed_uuid_v5('user:farmer-1@demo.gaia.ph'),
    'farmer',
    'purchase_farmer', 'success', true, true,
    '192.168.1.2'::inet,
    now() - interval '60 days' - interval '2 minutes',
    now() - interval '60 days',
    'seed-device-f1'
  ),
  -- Container 42: dealer-2 initiates purchase
  (
    seed_uuid_v5('scan:3'),
    seed_uuid_v5('container:42'),
    seed_uuid_v5('user:dealer-2@demo.gaia.ph'),
    'dealer',
    'purchase_dealer', 'success', true, true,
    '192.168.2.1'::inet,
    now() - interval '59 days' - interval '5 minutes',
    now() - interval '59 days',
    'seed-device-d2'
  ),
  -- Container 42: farmer-2 confirms purchase
  (
    seed_uuid_v5('scan:4'),
    seed_uuid_v5('container:42'),
    seed_uuid_v5('user:farmer-2@demo.gaia.ph'),
    'farmer',
    'purchase_farmer', 'success', true, true,
    '192.168.2.2'::inet,
    now() - interval '59 days' - interval '2 minutes',
    now() - interval '59 days',
    'seed-device-f2'
  ),
  -- Container 91: dealer-1 processes return
  (
    seed_uuid_v5('scan:5'),
    seed_uuid_v5('container:91'),
    seed_uuid_v5('user:dealer-1@demo.gaia.ph'),
    'dealer',
    'return_dealer', 'success', true, true,
    '192.168.1.1'::inet,
    now() - interval '90 days' - interval '5 minutes',
    now() - interval '90 days',
    'seed-device-d1'
  ),
  -- Container 91: farmer-1 confirms return → rewards_paid
  (
    seed_uuid_v5('scan:6'),
    seed_uuid_v5('container:91'),
    seed_uuid_v5('user:farmer-1@demo.gaia.ph'),
    'farmer',
    'return_farmer', 'success', true, true,
    '192.168.1.2'::inet,
    now() - interval '90 days' - interval '2 minutes',
    now() - interval '90 days',
    'seed-device-f1'
  ),
  -- Container 92: dealer-2 processes return
  (
    seed_uuid_v5('scan:7'),
    seed_uuid_v5('container:92'),
    seed_uuid_v5('user:dealer-2@demo.gaia.ph'),
    'dealer',
    'return_dealer', 'success', true, true,
    '192.168.2.1'::inet,
    now() - interval '89 days' - interval '5 minutes',
    now() - interval '89 days',
    'seed-device-d2'
  ),
  -- Container 92: farmer-2 confirms return → rewards_paid
  (
    seed_uuid_v5('scan:8'),
    seed_uuid_v5('container:92'),
    seed_uuid_v5('user:farmer-2@demo.gaia.ph'),
    'farmer',
    'return_farmer', 'success', true, true,
    '192.168.2.2'::inet,
    now() - interval '89 days' - interval '2 minutes',
    now() - interval '89 days',
    'seed-device-f2'
  ),
  -- Container 93: dealer-1 processes return
  (
    seed_uuid_v5('scan:9'),
    seed_uuid_v5('container:93'),
    seed_uuid_v5('user:dealer-1@demo.gaia.ph'),
    'dealer',
    'return_dealer', 'success', true, true,
    '192.168.1.1'::inet,
    now() - interval '88 days' - interval '5 minutes',
    now() - interval '88 days',
    'seed-device-d1'
  ),
  -- Container 93: farmer-1 confirms return → rewards_paid
  (
    seed_uuid_v5('scan:10'),
    seed_uuid_v5('container:93'),
    seed_uuid_v5('user:farmer-1@demo.gaia.ph'),
    'farmer',
    'return_farmer', 'success', true, true,
    '192.168.1.2'::inet,
    now() - interval '88 days' - interval '2 minutes',
    now() - interval '88 days',
    'seed-device-f1'
  )
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- wallet_transactions  (20 rows for 10 rewards_paid containers)
--
-- Containers 91, 92, 93 reference the scan_attempts above.
-- Containers 94–100 have no corresponding scan_attempts (NULL reference).
-- All credits use reason codes that the scan pipeline would produce.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  farmer1 uuid := seed_uuid_v5('user:farmer-1@demo.gaia.ph');
  farmer2 uuid := seed_uuid_v5('user:farmer-2@demo.gaia.ph');
  dealer1 uuid := seed_uuid_v5('user:dealer-1@demo.gaia.ph');
  dealer2 uuid := seed_uuid_v5('user:dealer-2@demo.gaia.ph');

  -- Containers 91–100 scan references (only 91, 92, 93 have scan_attempts)
  scan6  uuid := seed_uuid_v5('scan:6');
  scan8  uuid := seed_uuid_v5('scan:8');
  scan10 uuid := seed_uuid_v5('scan:10');

  -- Reward config defaults (must match reward_config row seeded in 0002_aux)
  farmer_pts int := 100;
  dealer_pts int := 50;

  i int;
  c_farmer uuid;
  c_dealer uuid;
  c_scan   uuid;
BEGIN
  FOR i IN 91..100 LOOP
    c_farmer := CASE WHEN i % 2 = 1 THEN farmer1 ELSE farmer2 END;
    c_dealer := CASE WHEN i % 2 = 1 THEN dealer1 ELSE dealer2 END;
    c_scan   := CASE
                  WHEN i = 91 THEN scan6
                  WHEN i = 92 THEN scan8
                  WHEN i = 93 THEN scan10
                  ELSE NULL
                END;

    -- Farmer credit
    INSERT INTO wallet_transactions (id, user_id, delta, reason, scan_attempt_id)
    VALUES (
      seed_uuid_v5('wt:farmer:' || i::text),
      c_farmer,
      farmer_pts,
      'farmer_return_reward',
      c_scan
    ) ON CONFLICT DO NOTHING;

    -- Dealer credit
    INSERT INTO wallet_transactions (id, user_id, delta, reason, scan_attempt_id)
    VALUES (
      seed_uuid_v5('wt:dealer:' || i::text),
      c_dealer,
      dealer_pts,
      'dealer_return_reward',
      c_scan
    ) ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cleanup helper — only needed during this seed run
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS seed_uuid_v5(text);

COMMIT;
