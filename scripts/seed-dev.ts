#!/usr/bin/env tsx
/**
 * scripts/seed-dev.ts
 *
 * Populates a local / dev Supabase instance with deterministic demo data.
 *
 * NEVER run against production — the script exits with a non-zero code if
 * NODE_ENV=production or if SUPABASE_URL looks like a hosted project.
 *
 * Run:
 *   pnpm tsx scripts/seed-dev.ts
 *   # or: npx tsx scripts/seed-dev.ts
 *
 * Requires in environment (or .env / .env.local):
 *   SUPABASE_URL            — local stack URL, e.g. http://localhost:54321
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key for the local stack
 *
 * Idempotent: uses upsert with ignoreDuplicates=true throughout.
 * UUIDs are v5 (SHA-1 namespaced) so re-runs produce identical rows.
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// .env loader (no external dependency required)
// ---------------------------------------------------------------------------
function loadEnvFile(path: string): void {
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      process.env[key] ??= val;
    }
  } catch {
    // file absent — silently skip
  }
}

const cwd = process.cwd();
loadEnvFile(join(cwd, '.env.local'));
loadEnvFile(join(cwd, '.env'));

// ---------------------------------------------------------------------------
// Production guard — must happen before any DB connection is attempted
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env['SUPABASE_URL'] ?? '';
const SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[seed-dev] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

if (process.env['NODE_ENV'] === 'production') {
  console.error('[seed-dev] ERROR: NODE_ENV=production — refusing to seed a production database.');
  process.exit(1);
}

// Hosted Supabase projects have URLs like https://<ref>.supabase.co
if (/[a-z0-9]+\.supabase\.co\b/i.test(SUPABASE_URL)) {
  console.error(`[seed-dev] ERROR: SUPABASE_URL looks like a hosted/production project:`);
  console.error(`  ${SUPABASE_URL}`);
  console.error('  Seed data must only be loaded into a local or explicitly-approved staging instance.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// UUID v5 helper — same namespace and algorithm as seed_uuid_v5() in seed.sql
// Namespace: bfd1e9e1-b1b8-4d4b-a5e6-73af14916b7e
// ---------------------------------------------------------------------------
const NS_HEX = 'bfd1e9e1b1b84d4ba5e673af14916b7e';
const NS_BYTES = Buffer.from(NS_HEX, 'hex');

function seedUuid(name: string): string {
  const hash = createHash('sha1')
    .update(NS_BYTES)
    .update(Buffer.from(name, 'utf8'))
    .digest();

  const b6 = hash[6] ?? 0;
  const b8 = hash[8] ?? 0;
  hash[6] = (b6 & 0x0f) | 0x50; // version 5
  hash[8] = (b8 & 0x3f) | 0x80; // RFC 4122 variant

  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// HMAC string for a container (mirrors the DO block in seed.sql)
// Uses SHA-256 of 'GAIA_SEED_HMAC:' + container UUID
// ---------------------------------------------------------------------------
function containerHmac(containerUuid: string): string {
  return createHash('sha256')
    .update(`GAIA_SEED_HMAC:${containerUuid}`)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Supabase admin client (service-role, no session/token refresh)
// ---------------------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg: string): void {
  console.log(`[seed-dev] ${msg}`);
}

async function raiseSeedError(context: string, error: unknown): Promise<never> {
  console.error(`[seed-dev] FATAL in ${context}:`, error);
  process.exit(1);
}

// Upsert a batch to a table, ignoring duplicates.
async function upsert<T extends object>(
  table: string,
  rows: T[],
  onConflict: string,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .upsert(rows, { onConflict, ignoreDuplicates: true });
  if (error) await raiseSeedError(`upsert(${table})`, error);
}

// ---------------------------------------------------------------------------
// 1. Auth users
// ---------------------------------------------------------------------------
interface SeedUser {
  id: string;
  email: string;
  role: 'gabs_admin' | 'brand_admin' | 'dealer' | 'farmer';
  displayName: string;
  phone: string;
}

const SEED_USERS: SeedUser[] = [
  { id: seedUuid('user:admin-1@demo.gaia.ph'),   email: 'admin-1@demo.gaia.ph',   role: 'gabs_admin',  displayName: 'Demo Admin One',     phone: '+639170000001' },
  { id: seedUuid('user:admin-2@demo.gaia.ph'),   email: 'admin-2@demo.gaia.ph',   role: 'gabs_admin',  displayName: 'Demo Admin Two',     phone: '+639170000002' },
  { id: seedUuid('user:mfg-1@demo.gaia.ph'),     email: 'mfg-1@demo.gaia.ph',     role: 'brand_admin', displayName: 'Demo Manufacturer',  phone: '+639170000003' },
  { id: seedUuid('user:dealer-1@demo.gaia.ph'),  email: 'dealer-1@demo.gaia.ph',  role: 'dealer',      displayName: 'Demo Dealer One',    phone: '+639170000011' },
  { id: seedUuid('user:dealer-2@demo.gaia.ph'),  email: 'dealer-2@demo.gaia.ph',  role: 'dealer',      displayName: 'Demo Dealer Two',    phone: '+639170000012' },
  { id: seedUuid('user:dealer-3@demo.gaia.ph'),  email: 'dealer-3@demo.gaia.ph',  role: 'dealer',      displayName: 'Demo Dealer Three',  phone: '+639170000013' },
  { id: seedUuid('user:farmer-1@demo.gaia.ph'),  email: 'farmer-1@demo.gaia.ph',  role: 'farmer',      displayName: 'Test Farmer One',    phone: '+639170000021' },
  { id: seedUuid('user:farmer-2@demo.gaia.ph'),  email: 'farmer-2@demo.gaia.ph',  role: 'farmer',      displayName: 'Test Farmer Two',    phone: '+639170000022' },
  { id: seedUuid('user:farmer-3@demo.gaia.ph'),  email: 'farmer-3@demo.gaia.ph',  role: 'farmer',      displayName: 'Test Farmer Three',  phone: '+639170000023' },
];

async function seedAuthUsers(): Promise<void> {
  log('Creating auth users …');
  for (const u of SEED_USERS) {
    const { error } = await supabase.auth.admin.createUser({
      id: u.id,
      email: u.email,
      password: 'Demo1234!',
      email_confirm: true,
    });
    if (error) {
      // 422 / "already registered" = idempotent — skip
      const msg = error.message.toLowerCase();
      if (!msg.includes('already') && !msg.includes('registered') && error.status !== 422) {
        await raiseSeedError(`createUser(${u.email})`, error);
      }
    }
  }
  log(`  ${SEED_USERS.length} auth users ready.`);
}

// ---------------------------------------------------------------------------
// 2. user_profiles
// ---------------------------------------------------------------------------
async function seedUserProfiles(): Promise<void> {
  log('Seeding user_profiles …');
  const rows = SEED_USERS.map((u) => ({
    id: u.id,
    role: u.role,
    display_name: u.displayName,
    phone_number: u.phone,
  }));
  await upsert('user_profiles', rows, 'id');
  log(`  ${rows.length} profiles ready.`);
}

// ---------------------------------------------------------------------------
// 3. dealer_accounts
// ---------------------------------------------------------------------------
async function seedDealerAccounts(): Promise<void> {
  log('Seeding dealer_accounts …');
  const admin1 = seedUuid('user:admin-1@demo.gaia.ph');
  const now = new Date().toISOString();
  const d60 = new Date(Date.now() - 60 * 86400_000).toISOString();
  const d45 = new Date(Date.now() - 45 * 86400_000).toISOString();

  await upsert('dealer_accounts', [
    {
      id: seedUuid('dealer-account:1'),
      user_id: seedUuid('user:dealer-1@demo.gaia.ph'),
      business_name: 'Demo Agri Shop One',
      territory_notes: 'Metro Manila — northern district',
      is_verified: true,
      verified_by: admin1,
      verified_at: d60,
      created_at: now,
      updated_at: now,
    },
    {
      id: seedUuid('dealer-account:2'),
      user_id: seedUuid('user:dealer-2@demo.gaia.ph'),
      business_name: 'Test Farm Supply Co.',
      territory_notes: 'Cavite — general area',
      is_verified: true,
      verified_by: admin1,
      verified_at: d45,
      created_at: now,
      updated_at: now,
    },
    {
      id: seedUuid('dealer-account:3'),
      user_id: seedUuid('user:dealer-3@demo.gaia.ph'),
      business_name: 'Sample Crop Store Three',
      territory_notes: 'Laguna — pending area assignment',
      is_verified: false,
      verified_by: null,
      verified_at: null,
      created_at: now,
      updated_at: now,
    },
  ], 'id');
  log('  3 dealer accounts ready.');
}

// ---------------------------------------------------------------------------
// 4. manufacturer_accounts
// ---------------------------------------------------------------------------
async function seedManufacturerAccounts(): Promise<void> {
  log('Seeding manufacturer_accounts …');
  const now = new Date().toISOString();
  await upsert('manufacturer_accounts', [
    {
      id: seedUuid('manufacturer-account:1'),
      user_id: seedUuid('user:mfg-1@demo.gaia.ph'),
      company_name: 'Test AgriChem Industries Inc.',
      onboarded_by: seedUuid('user:admin-1@demo.gaia.ph'),
      created_at: now,
      updated_at: now,
    },
  ], 'id');
  log('  1 manufacturer account ready.');
}

// ---------------------------------------------------------------------------
// 5. products  (20 total: 10 active, 8 draft, 2 suspended)
// ---------------------------------------------------------------------------
type ProductStatus = 'active' | 'draft' | 'suspended';
type FormulationType = 'EC' | 'SC' | 'WP' | 'WG' | 'SL' | 'GR' | 'DP' | 'ULV' | 'OTHER';
type ProductType = 'HERBICIDE' | 'INSECTICIDE' | 'FUNGICIDE' | 'RODENTICIDE' | 'NEMATICIDE' | 'ACARICIDE' | 'OTHER';
type ToxicityCategory = '1' | '2' | '3' | '4';

interface ProductSeed {
  key: string;
  product_name: string;
  brand_name: string;
  company: string;
  active_ingredient: string;
  concentration: string;
  formulation_type: FormulationType;
  type: ProductType;
  category: ToxicityCategory | null;
  fpa_registration_number: string | null;
  fpa_registration_expires_at: string | null;
  mode_of_entry: string;
  mode_of_action_group: string;
  dosage_rate: string;
  pests: string;
  note_to_physician: string | null;
  status: ProductStatus;
}

const NOTE2 = 'Highly toxic — call a doctor immediately. No specific antidote; treatment is symptomatic. Keep out of reach of children.';
const NOTE3 = 'Moderately hazardous — seek medical attention if symptoms persist. Treatment is symptomatic. Keep out of reach of children.';
const NOTE4 = 'Slightly hazardous — seek medical attention only if large quantities ingested. Treat symptomatically.';

const PRODUCT_SEEDS: ProductSeed[] = [
  // HERBICIDE (8)
  { key: 'product:1',  product_name: 'Demo Butachlor 500 EC',          brand_name: 'DemoButach',   company: 'Test AgriChem Industries Inc.',  active_ingredient: 'Butachlor',                        concentration: '500 g/L', formulation_type: 'EC', type: 'HERBICIDE',   category: '3', fpa_registration_number: 'FPA-TEST-H001', fpa_registration_expires_at: '2027-12-31', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group K',  dosage_rate: '1–2 L/ha',   pests: 'Barnyard grass; Sprangletop; Annual sedges',           note_to_physician: NOTE3, status: 'active'    },
  { key: 'product:2',  product_name: 'Test Glyphosate 760 WG',          brand_name: 'TestGlyph',    company: 'Demo Crop Science Ltd.',          active_ingredient: 'Glyphosate isopropylamine salt',   concentration: '760 g/kg', formulation_type: 'WG', type: 'HERBICIDE',  category: '4', fpa_registration_number: 'FPA-TEST-H002', fpa_registration_expires_at: '2028-06-30', mode_of_entry: 'SYSTEMIC', mode_of_action_group: 'Group 9',  dosage_rate: '2–3 kg/ha',  pests: 'Annual and perennial grasses; Broadleaf weeds',        note_to_physician: NOTE4, status: 'active'    },
  { key: 'product:3',  product_name: 'Sample Oxyfluorfen 240 EC',       brand_name: 'SampleOxy',    company: 'Test AgriChem Industries Inc.',  active_ingredient: 'Oxyfluorfen',                      concentration: '240 g/L', formulation_type: 'EC', type: 'HERBICIDE',   category: null, fpa_registration_number: null,            fpa_registration_expires_at: null,         mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group E',  dosage_rate: '0.5–1 L/ha', pests: 'Broadleaf weeds; Grasses',                             note_to_physician: null,  status: 'draft'     },
  { key: 'product:4',  product_name: 'Demo 2,4-D Amine 720 SL',         brand_name: 'Demo24D',      company: 'Demo Crop Science Ltd.',          active_ingredient: '2,4-Dichlorophenoxyacetic acid',   concentration: '720 g/L', formulation_type: 'SL', type: 'HERBICIDE',   category: null, fpa_registration_number: 'FPA-TEST-H004', fpa_registration_expires_at: '2027-03-31', mode_of_entry: 'SYSTEMIC', mode_of_action_group: 'Group O',  dosage_rate: '1–1.5 L/ha', pests: 'Broadleaf weeds in rice; Annual sedges',               note_to_physician: null,  status: 'draft'     },
  { key: 'product:5',  product_name: 'Test Propanil 360 EC',             brand_name: 'TestPropan',   company: 'Sample Agri Corp.',              active_ingredient: 'Propanil',                         concentration: '360 g/L', formulation_type: 'EC', type: 'HERBICIDE',   category: '3', fpa_registration_number: 'FPA-TEST-H005', fpa_registration_expires_at: '2027-09-30', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group C2', dosage_rate: '3–4 L/ha',   pests: 'Barnyard grass; Broadleaf weeds in wetland rice',      note_to_physician: NOTE3, status: 'active'    },
  { key: 'product:6',  product_name: 'Sample Pendimethalin 330 EC',      brand_name: 'SampPendi',    company: 'Test AgriChem Industries Inc.',  active_ingredient: 'Pendimethalin',                    concentration: '330 g/L', formulation_type: 'EC', type: 'HERBICIDE',   category: null, fpa_registration_number: null,            fpa_registration_expires_at: null,         mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group K1', dosage_rate: '2.5–3 L/ha', pests: 'Annual grasses; Broadleaf weeds in corn',              note_to_physician: null,  status: 'draft'     },
  { key: 'product:7',  product_name: 'Demo Pretilachlor 500 EC',         brand_name: 'DemoPretil',   company: 'Demo Crop Science Ltd.',          active_ingredient: 'Pretilachlor',                     concentration: '500 g/L', formulation_type: 'EC', type: 'HERBICIDE',   category: '3', fpa_registration_number: 'FPA-TEST-H007', fpa_registration_expires_at: '2026-06-30', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group K3', dosage_rate: '1.5–2 L/ha', pests: 'Barnyard grass; Sedge; Broadleaf weeds',               note_to_physician: NOTE3, status: 'suspended' },
  { key: 'product:8',  product_name: 'Test Atrazine 80 WP',              brand_name: 'TestAtra',     company: 'Sample Agri Corp.',              active_ingredient: 'Atrazine',                         concentration: '800 g/kg', formulation_type: 'WP', type: 'HERBICIDE',  category: '3', fpa_registration_number: 'FPA-TEST-H008', fpa_registration_expires_at: '2028-12-31', mode_of_entry: 'SYSTEMIC', mode_of_action_group: 'Group C1', dosage_rate: '1.5–2 kg/ha', pests: 'Broadleaf weeds; Grasses in corn',                    note_to_physician: NOTE3, status: 'active'    },
  // INSECTICIDE (7)
  { key: 'product:9',  product_name: 'Demo Chlorpyrifos 480 EC',         brand_name: 'DemoClor',     company: 'Test AgriChem Industries Inc.',  active_ingredient: 'Chlorpyrifos',                     concentration: '480 g/L', formulation_type: 'EC', type: 'INSECTICIDE', category: '2', fpa_registration_number: 'FPA-TEST-I001', fpa_registration_expires_at: '2027-12-31', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group 1B', dosage_rate: '1–2 L/ha',   pests: 'Stem borers; Leaf folders; Thrips; Aphids',            note_to_physician: NOTE2, status: 'active'    },
  { key: 'product:10', product_name: 'Test Lambda-cyhalothrin 25 SC',    brand_name: 'TestLambda',   company: 'Demo Crop Science Ltd.',          active_ingredient: 'Lambda-cyhalothrin',               concentration: '25 g/L',  formulation_type: 'SC', type: 'INSECTICIDE', category: null, fpa_registration_number: null,            fpa_registration_expires_at: null,         mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group 3A', dosage_rate: '0.3–0.5 L/ha', pests: 'Aphids; Whiteflies; Leaf folders',                  note_to_physician: null,  status: 'draft'     },
  { key: 'product:11', product_name: 'Sample Cypermethrin 100 EC',       brand_name: 'SampCyper',    company: 'Sample Agri Corp.',              active_ingredient: 'Cypermethrin',                     concentration: '100 g/L', formulation_type: 'EC', type: 'INSECTICIDE', category: '3', fpa_registration_number: 'FPA-TEST-I003', fpa_registration_expires_at: '2027-06-30', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group 3A', dosage_rate: '0.5–1 L/ha', pests: 'Stem borers; Pod borers; Fruit flies',                note_to_physician: NOTE3, status: 'active'    },
  { key: 'product:12', product_name: 'Demo Imidacloprid 200 SL',         brand_name: 'DemoImida',    company: 'Test AgriChem Industries Inc.',  active_ingredient: 'Imidacloprid',                     concentration: '200 g/L', formulation_type: 'SL', type: 'INSECTICIDE', category: null, fpa_registration_number: 'FPA-TEST-I004', fpa_registration_expires_at: '2027-12-31', mode_of_entry: 'SYSTEMIC', mode_of_action_group: 'Group 4A', dosage_rate: '0.5 L/ha',   pests: 'Brown planthopper; Green leafhopper; Aphids; Whiteflies', note_to_physician: null, status: 'draft'  },
  { key: 'product:13', product_name: 'Test Profenofos 500 EC',           brand_name: 'TestProfen',   company: 'Demo Crop Science Ltd.',          active_ingredient: 'Profenofos',                       concentration: '500 g/L', formulation_type: 'EC', type: 'INSECTICIDE', category: '2', fpa_registration_number: 'FPA-TEST-I005', fpa_registration_expires_at: '2028-03-31', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group 1B', dosage_rate: '0.5–1 L/ha', pests: 'Thrips; Mites; Aphids; Bollworms',                    note_to_physician: NOTE2, status: 'active'    },
  { key: 'product:14', product_name: 'Sample Deltamethrin 25 EC',        brand_name: 'SampDelta',    company: 'Sample Agri Corp.',              active_ingredient: 'Deltamethrin',                     concentration: '25 g/L',  formulation_type: 'EC', type: 'INSECTICIDE', category: '2', fpa_registration_number: 'FPA-TEST-I006', fpa_registration_expires_at: '2027-09-30', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group 3A', dosage_rate: '0.5 L/ha',   pests: 'Stem borers; Leaf folders; Pod borers; Aphids',        note_to_physician: NOTE2, status: 'active'    },
  { key: 'product:15', product_name: 'Demo Abamectin 18 EC',             brand_name: 'DemoAbam',     company: 'Test AgriChem Industries Inc.',  active_ingredient: 'Abamectin',                        concentration: '18 g/L',  formulation_type: 'EC', type: 'INSECTICIDE', category: null, fpa_registration_number: null,            fpa_registration_expires_at: null,         mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group 6',  dosage_rate: '0.5–0.75 L/ha', pests: 'Spider mites; Leaf miners; Thrips',                note_to_physician: null,  status: 'draft'     },
  // FUNGICIDE (5)
  { key: 'product:16', product_name: 'Test Mancozeb 800 WP',             brand_name: 'TestManco',    company: 'Demo Crop Science Ltd.',          active_ingredient: 'Mancozeb',                         concentration: '800 g/kg', formulation_type: 'WP', type: 'FUNGICIDE',  category: '3', fpa_registration_number: 'FPA-TEST-F001', fpa_registration_expires_at: '2027-12-31', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group M3', dosage_rate: '2–3 kg/ha',  pests: 'Leaf blast; Sheath blight; Downy mildew; Late blight', note_to_physician: NOTE3, status: 'active'    },
  { key: 'product:17', product_name: 'Sample Carbendazim 500 SC',        brand_name: 'SampCarb',     company: 'Sample Agri Corp.',              active_ingredient: 'Carbendazim',                      concentration: '500 g/L', formulation_type: 'SC', type: 'FUNGICIDE',   category: null, fpa_registration_number: null,            fpa_registration_expires_at: null,         mode_of_entry: 'SYSTEMIC', mode_of_action_group: 'Group 1',  dosage_rate: '0.5–1 L/ha', pests: 'Blast; Sheath blight; Bakanae; Brown spot',           note_to_physician: null,  status: 'draft'     },
  { key: 'product:18', product_name: 'Demo Propiconazole 250 EC',        brand_name: 'DemoPropic',   company: 'Test AgriChem Industries Inc.',  active_ingredient: 'Propiconazole',                    concentration: '250 g/L', formulation_type: 'EC', type: 'FUNGICIDE',   category: '2', fpa_registration_number: 'FPA-TEST-F003', fpa_registration_expires_at: '2028-06-30', mode_of_entry: 'SYSTEMIC', mode_of_action_group: 'Group 3',  dosage_rate: '0.5 L/ha',   pests: 'Sheath blight; Brown spot; Narrow brown leaf spot',    note_to_physician: NOTE2, status: 'active'    },
  { key: 'product:19', product_name: 'Test Copper Hydroxide 77 WP',      brand_name: 'TestCopHyd',   company: 'Demo Crop Science Ltd.',          active_ingredient: 'Copper hydroxide',                 concentration: '770 g/kg', formulation_type: 'WP', type: 'FUNGICIDE',  category: '3', fpa_registration_number: 'FPA-TEST-F004', fpa_registration_expires_at: '2026-09-30', mode_of_entry: 'CONTACT',  mode_of_action_group: 'Group M1', dosage_rate: '2–3 kg/ha',  pests: 'Angular leaf spot; Downy mildew; Early blight',        note_to_physician: NOTE3, status: 'suspended' },
  { key: 'product:20', product_name: 'Sample Metalaxyl 8 WP',            brand_name: 'SampMetal',    company: 'Sample Agri Corp.',              active_ingredient: 'Metalaxyl',                        concentration: '80 g/kg',  formulation_type: 'WP', type: 'FUNGICIDE',  category: null, fpa_registration_number: null,            fpa_registration_expires_at: null,         mode_of_entry: 'SYSTEMIC', mode_of_action_group: 'Group 4',  dosage_rate: '2 kg/ha',    pests: 'Downy mildew; Late blight; Damping off',               note_to_physician: null,  status: 'draft'     },
];

async function seedProducts(): Promise<void> {
  log('Seeding products …');
  const admin1 = seedUuid('user:admin-1@demo.gaia.ph');
  const confAt = new Date(Date.now() - 30 * 86400_000).toISOString();
  const importedAt = new Date(Date.now() - 90 * 86400_000).toISOString();
  const now = new Date().toISOString();

  const rows = PRODUCT_SEEDS.map((p) => {
    const isConfirmed = p.status !== 'draft';
    return {
      id: seedUuid(p.key),
      product_name: p.product_name,
      brand_name: p.brand_name,
      company: p.company,
      active_ingredient: p.active_ingredient,
      concentration: p.concentration,
      formulation_type: p.formulation_type,
      type: p.type,
      category: p.category,
      fpa_registration_number: p.fpa_registration_number,
      fpa_registration_expires_at: p.fpa_registration_expires_at,
      fpa_last_imported_at: p.fpa_registration_number ? importedAt : null,
      mode_of_entry: p.mode_of_entry,
      mode_of_action_group: p.mode_of_action_group,
      dosage_rate: p.dosage_rate,
      pests: p.pests,
      note_to_physician: p.note_to_physician,
      status: p.status,
      category_confirmed_by: isConfirmed ? admin1 : null,
      category_confirmed_at: isConfirmed ? confAt : null,
      note_to_physician_confirmed_by: isConfirmed ? admin1 : null,
      note_to_physician_confirmed_at: isConfirmed ? confAt : null,
      created_at: now,
      updated_at: now,
    };
  });

  await upsert('products', rows, 'id');
  log(`  ${rows.length} products ready.`);
}

// ---------------------------------------------------------------------------
// 6. product_crops
// ---------------------------------------------------------------------------
async function seedProductCrops(): Promise<void> {
  log('Seeding product_crops …');
  type CropRow = { id: string; product_id: string; crop: string; pests: string };
  const rows: CropRow[] = [
    { id: seedUuid('crop:1:rice'),        product_id: seedUuid('product:1'),  crop: 'Rice',       pests: 'Barnyard grass; Sprangletop; Annual sedges' },
    { id: seedUuid('crop:1:corn'),        product_id: seedUuid('product:1'),  crop: 'Corn',       pests: 'Annual grasses; Broadleaf weeds' },
    { id: seedUuid('crop:2:sugarcane'),   product_id: seedUuid('product:2'),  crop: 'Sugarcane',  pests: 'Annual and perennial grasses; Broadleaf weeds' },
    { id: seedUuid('crop:2:orchard'),     product_id: seedUuid('product:2'),  crop: 'Orchard',    pests: 'Perennial weeds; Grasses' },
    { id: seedUuid('crop:2:corn'),        product_id: seedUuid('product:2'),  crop: 'Corn',       pests: 'Annual grasses; Broadleaf weeds' },
    { id: seedUuid('crop:5:rice'),        product_id: seedUuid('product:5'),  crop: 'Rice',       pests: 'Barnyard grass; Broadleaf weeds' },
    { id: seedUuid('crop:7:rice'),        product_id: seedUuid('product:7'),  crop: 'Rice',       pests: 'Barnyard grass; Sedge; Broadleaf weeds' },
    { id: seedUuid('crop:8:corn'),        product_id: seedUuid('product:8'),  crop: 'Corn',       pests: 'Broadleaf weeds; Annual grasses' },
    { id: seedUuid('crop:8:sugarcane'),   product_id: seedUuid('product:8'),  crop: 'Sugarcane',  pests: 'Broadleaf weeds' },
    { id: seedUuid('crop:9:rice'),        product_id: seedUuid('product:9'),  crop: 'Rice',       pests: 'Stem borers; Leaf folders; Thrips' },
    { id: seedUuid('crop:9:corn'),        product_id: seedUuid('product:9'),  crop: 'Corn',       pests: 'Corn borers; Aphids; Armyworms' },
    { id: seedUuid('crop:9:vegetables'),  product_id: seedUuid('product:9'),  crop: 'Vegetables', pests: 'Aphids; Thrips; Leaf miners' },
    { id: seedUuid('crop:11:rice'),       product_id: seedUuid('product:11'), crop: 'Rice',       pests: 'Stem borers; Leaf folders' },
    { id: seedUuid('crop:11:mango'),      product_id: seedUuid('product:11'), crop: 'Mango',      pests: 'Fruit flies; Mango hoppers; Scale insects' },
    { id: seedUuid('crop:13:vegetables'), product_id: seedUuid('product:13'), crop: 'Vegetables', pests: 'Thrips; Aphids; Whiteflies' },
    { id: seedUuid('crop:13:cotton'),     product_id: seedUuid('product:13'), crop: 'Cotton',     pests: 'Bollworms; Mites; Aphids' },
    { id: seedUuid('crop:14:rice'),       product_id: seedUuid('product:14'), crop: 'Rice',       pests: 'Stem borers; Leaf folders' },
    { id: seedUuid('crop:14:corn'),       product_id: seedUuid('product:14'), crop: 'Corn',       pests: 'Corn borers; Pod borers' },
    { id: seedUuid('crop:16:rice'),       product_id: seedUuid('product:16'), crop: 'Rice',       pests: 'Leaf blast; Sheath blight; Brown spot' },
    { id: seedUuid('crop:16:potato'),     product_id: seedUuid('product:16'), crop: 'Potato',     pests: 'Late blight; Early blight' },
    { id: seedUuid('crop:16:tomato'),     product_id: seedUuid('product:16'), crop: 'Tomato',     pests: 'Late blight; Early blight; Downy mildew' },
    { id: seedUuid('crop:18:rice'),       product_id: seedUuid('product:18'), crop: 'Rice',       pests: 'Sheath blight; Brown spot' },
    { id: seedUuid('crop:18:banana'),     product_id: seedUuid('product:18'), crop: 'Banana',     pests: 'Sigatoka leaf spot; Black leaf streak' },
    { id: seedUuid('crop:19:mango'),      product_id: seedUuid('product:19'), crop: 'Mango',      pests: 'Anthracnose; Powdery mildew' },
    { id: seedUuid('crop:19:vegetables'), product_id: seedUuid('product:19'), crop: 'Vegetables', pests: 'Angular leaf spot; Downy mildew' },
  ];

  await upsert('product_crops', rows, 'id');
  log(`  ${rows.length} product_crops ready.`);
}

// ---------------------------------------------------------------------------
// 7. containers (100 total)
// ---------------------------------------------------------------------------
async function seedContainers(): Promise<void> {
  log('Seeding containers (100) …');

  const dealer1 = seedUuid('dealer-account:1');
  const dealer2 = seedUuid('dealer-account:2');
  const farmer1 = seedUuid('user:farmer-1@demo.gaia.ph');
  const farmer2 = seedUuid('user:farmer-2@demo.gaia.ph');
  const now = Date.now();
  const DAY = 86400_000;

  const rows = Array.from({ length: 100 }, (_, idx) => {
    const i = idx + 1;
    const cid = seedUuid(`container:${i}`);
    const hmac = containerHmac(cid);
    const hmacSuffix = hmac.slice(-16);
    const productId = seedUuid(`product:${((i - 1) % 20) + 1}`);
    const isOdd = i % 2 === 1;
    const dealer = isOdd ? dealer1 : dealer2;
    const farmer = isOdd ? farmer1 : farmer2;

    // in_distribution: 1–40
    if (i <= 40) {
      return {
        id: cid, product_id: productId, hmac, hmac_suffix: hmacSuffix,
        batch_number: `BATCH-2025-${String(i).padStart(3, '0')}`,
        manufacture_date: '2025-01-01',
        state: 'in_distribution',
        purchased_by_user_id: null, dealer_id: null, purchased_at: null,
        returned_by_user_id: null, return_dealer_id: null, returned_at: null,
        rewards_paid_at: null,
      };
    }

    // purchased: 41–70
    if (i <= 70) {
      const purchasedAt = new Date(now - (61 - (i - 41)) * DAY).toISOString();
      return {
        id: cid, product_id: productId, hmac, hmac_suffix: hmacSuffix,
        batch_number: `BATCH-2025-${String(i).padStart(3, '0')}`,
        manufacture_date: '2025-01-01',
        state: 'purchased',
        purchased_by_user_id: farmer, dealer_id: dealer, purchased_at: purchasedAt,
        returned_by_user_id: null, return_dealer_id: null, returned_at: null,
        rewards_paid_at: null,
      };
    }

    // returned: 71–90
    if (i <= 90) {
      const purchasedAt = new Date(now - (91 - (i - 71)) * DAY).toISOString();
      const returnedAt  = new Date(now - (61 - (i - 71)) * DAY).toISOString();
      return {
        id: cid, product_id: productId, hmac, hmac_suffix: hmacSuffix,
        batch_number: `BATCH-2025-${String(i).padStart(3, '0')}`,
        manufacture_date: '2025-01-01',
        state: 'returned',
        purchased_by_user_id: farmer, dealer_id: dealer, purchased_at: purchasedAt,
        returned_by_user_id: farmer, return_dealer_id: dealer, returned_at: returnedAt,
        rewards_paid_at: null,
      };
    }

    // rewards_paid: 91–100
    const purchasedAt  = new Date(now - (121 - (i - 91)) * DAY).toISOString();
    const returnedAt   = new Date(now - (91  - (i - 91)) * DAY).toISOString();
    const rewardsPaidAt = new Date(now - (61  - (i - 91)) * DAY).toISOString();
    return {
      id: cid, product_id: productId, hmac, hmac_suffix: hmacSuffix,
      batch_number: `BATCH-2025-${String(i).padStart(3, '0')}`,
      manufacture_date: '2025-01-01',
      state: 'rewards_paid',
      purchased_by_user_id: farmer, dealer_id: dealer, purchased_at: purchasedAt,
      returned_by_user_id: farmer, return_dealer_id: dealer, returned_at: returnedAt,
      rewards_paid_at: rewardsPaidAt,
    };
  });

  // Batch in chunks of 25 to stay within Supabase payload limits
  for (let start = 0; start < rows.length; start += 25) {
    await upsert('containers', rows.slice(start, start + 25), 'id');
  }
  log('  100 containers ready.');
}

// ---------------------------------------------------------------------------
// 8. wallets
// ---------------------------------------------------------------------------
async function seedWallets(): Promise<void> {
  log('Seeding wallets …');
  const now = new Date().toISOString();
  await upsert('wallets', [
    { id: seedUuid('wallet:farmer-1'), user_id: seedUuid('user:farmer-1@demo.gaia.ph'), balance_points: 500, created_at: now, updated_at: now },
    { id: seedUuid('wallet:farmer-2'), user_id: seedUuid('user:farmer-2@demo.gaia.ph'), balance_points: 500, created_at: now, updated_at: now },
    { id: seedUuid('wallet:farmer-3'), user_id: seedUuid('user:farmer-3@demo.gaia.ph'), balance_points: 0,   created_at: now, updated_at: now },
    { id: seedUuid('wallet:dealer-1'), user_id: seedUuid('user:dealer-1@demo.gaia.ph'), balance_points: 250, created_at: now, updated_at: now },
    { id: seedUuid('wallet:dealer-2'), user_id: seedUuid('user:dealer-2@demo.gaia.ph'), balance_points: 250, created_at: now, updated_at: now },
    { id: seedUuid('wallet:dealer-3'), user_id: seedUuid('user:dealer-3@demo.gaia.ph'), balance_points: 0,   created_at: now, updated_at: now },
  ], 'id');
  log('  6 wallets ready.');
}

// ---------------------------------------------------------------------------
// 9. scan_attempts  (10 pre-completed scans)
// ---------------------------------------------------------------------------
async function seedScanAttempts(): Promise<void> {
  log('Seeding scan_attempts …');
  const d1uid = seedUuid('user:dealer-1@demo.gaia.ph');
  const d2uid = seedUuid('user:dealer-2@demo.gaia.ph');
  const f1uid = seedUuid('user:farmer-1@demo.gaia.ph');
  const f2uid = seedUuid('user:farmer-2@demo.gaia.ph');
  const now = Date.now();
  const DAY = 86400_000;

  type ScanRow = {
    id: string; container_id: string; actor_id: string; actor_type: string;
    step: string; outcome: string; hmac_valid: boolean; auth_valid: boolean;
    ip_address: string; local_scan_ts: string; sync_ts: string; device_id: string;
  };

  const rows: ScanRow[] = [
    // Purchase flows: containers 41 (odd→d1/f1) and 42 (even→d2/f2)
    { id: seedUuid('scan:1'),  container_id: seedUuid('container:41'), actor_id: d1uid, actor_type: 'dealer',  step: 'purchase_dealer', outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.1.1', local_scan_ts: new Date(now - 60*DAY - 5*60_000).toISOString(), sync_ts: new Date(now - 60*DAY).toISOString(), device_id: 'seed-device-d1' },
    { id: seedUuid('scan:2'),  container_id: seedUuid('container:41'), actor_id: f1uid, actor_type: 'farmer',  step: 'purchase_farmer', outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.1.2', local_scan_ts: new Date(now - 60*DAY - 2*60_000).toISOString(), sync_ts: new Date(now - 60*DAY).toISOString(), device_id: 'seed-device-f1' },
    { id: seedUuid('scan:3'),  container_id: seedUuid('container:42'), actor_id: d2uid, actor_type: 'dealer',  step: 'purchase_dealer', outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.2.1', local_scan_ts: new Date(now - 59*DAY - 5*60_000).toISOString(), sync_ts: new Date(now - 59*DAY).toISOString(), device_id: 'seed-device-d2' },
    { id: seedUuid('scan:4'),  container_id: seedUuid('container:42'), actor_id: f2uid, actor_type: 'farmer',  step: 'purchase_farmer', outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.2.2', local_scan_ts: new Date(now - 59*DAY - 2*60_000).toISOString(), sync_ts: new Date(now - 59*DAY).toISOString(), device_id: 'seed-device-f2' },
    // Return flows: containers 91, 92, 93 (rewards_paid)
    { id: seedUuid('scan:5'),  container_id: seedUuid('container:91'), actor_id: d1uid, actor_type: 'dealer',  step: 'return_dealer',   outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.1.1', local_scan_ts: new Date(now - 90*DAY - 5*60_000).toISOString(), sync_ts: new Date(now - 90*DAY).toISOString(), device_id: 'seed-device-d1' },
    { id: seedUuid('scan:6'),  container_id: seedUuid('container:91'), actor_id: f1uid, actor_type: 'farmer',  step: 'return_farmer',   outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.1.2', local_scan_ts: new Date(now - 90*DAY - 2*60_000).toISOString(), sync_ts: new Date(now - 90*DAY).toISOString(), device_id: 'seed-device-f1' },
    { id: seedUuid('scan:7'),  container_id: seedUuid('container:92'), actor_id: d2uid, actor_type: 'dealer',  step: 'return_dealer',   outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.2.1', local_scan_ts: new Date(now - 89*DAY - 5*60_000).toISOString(), sync_ts: new Date(now - 89*DAY).toISOString(), device_id: 'seed-device-d2' },
    { id: seedUuid('scan:8'),  container_id: seedUuid('container:92'), actor_id: f2uid, actor_type: 'farmer',  step: 'return_farmer',   outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.2.2', local_scan_ts: new Date(now - 89*DAY - 2*60_000).toISOString(), sync_ts: new Date(now - 89*DAY).toISOString(), device_id: 'seed-device-f2' },
    { id: seedUuid('scan:9'),  container_id: seedUuid('container:93'), actor_id: d1uid, actor_type: 'dealer',  step: 'return_dealer',   outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.1.1', local_scan_ts: new Date(now - 88*DAY - 5*60_000).toISOString(), sync_ts: new Date(now - 88*DAY).toISOString(), device_id: 'seed-device-d1' },
    { id: seedUuid('scan:10'), container_id: seedUuid('container:93'), actor_id: f1uid, actor_type: 'farmer',  step: 'return_farmer',   outcome: 'success', hmac_valid: true, auth_valid: true, ip_address: '192.168.1.2', local_scan_ts: new Date(now - 88*DAY - 2*60_000).toISOString(), sync_ts: new Date(now - 88*DAY).toISOString(), device_id: 'seed-device-f1' },
  ];

  await upsert('scan_attempts', rows, 'id');
  log(`  ${rows.length} scan_attempts ready.`);
}

// ---------------------------------------------------------------------------
// 10. wallet_transactions  (20 rows for 10 rewards_paid containers)
// ---------------------------------------------------------------------------
async function seedWalletTransactions(): Promise<void> {
  log('Seeding wallet_transactions …');

  const farmer1 = seedUuid('user:farmer-1@demo.gaia.ph');
  const farmer2 = seedUuid('user:farmer-2@demo.gaia.ph');
  const dealer1 = seedUuid('user:dealer-1@demo.gaia.ph');
  const dealer2 = seedUuid('user:dealer-2@demo.gaia.ph');
  const scanIds: Record<number, string> = { 91: seedUuid('scan:6'), 92: seedUuid('scan:8'), 93: seedUuid('scan:10') };

  type TxRow = { id: string; user_id: string; delta: number; reason: string; scan_attempt_id: string | null };
  const rows: TxRow[] = [];

  for (let i = 91; i <= 100; i++) {
    const isOdd = i % 2 === 1;
    const farmer = isOdd ? farmer1 : farmer2;
    const dealer = isOdd ? dealer1 : dealer2;
    const scanId = scanIds[i] ?? null;

    rows.push({ id: seedUuid(`wt:farmer:${i}`), user_id: farmer, delta: 100, reason: 'farmer_return_reward', scan_attempt_id: scanId });
    rows.push({ id: seedUuid(`wt:dealer:${i}`), user_id: dealer, delta: 50,  reason: 'dealer_return_reward', scan_attempt_id: scanId });
  }

  await upsert('wallet_transactions', rows, 'id');
  log(`  ${rows.length} wallet_transactions ready.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('[seed-dev] Starting dev seed …');
  console.log(`[seed-dev] Target: ${SUPABASE_URL}`);

  await seedAuthUsers();
  await seedUserProfiles();
  await seedDealerAccounts();
  await seedManufacturerAccounts();
  await seedProducts();
  await seedProductCrops();
  await seedContainers();
  await seedWallets();
  await seedScanAttempts();
  await seedWalletTransactions();

  console.log('[seed-dev] Done. All seed data is in place.');
}

main().catch((err: unknown) => {
  console.error('[seed-dev] Unhandled error:', err);
  process.exit(1);
});
