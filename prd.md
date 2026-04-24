# GABI Steward 2.0 (GAIA) — Agent Specification

**Author:** Lisa Hayes
**Date:** 2026-04-24
**Status:** Approved — discovery closed, all 53 decisions locked
**Source:** DISCOVERY-gaia.md (v3, 2026-04-24)

---

## Project Context

**Purpose:** GAIA is a Philippine agrochemical traceability and EPR compliance platform that closes the loop from shelf to compliance report — verifying every product is FPA-registered, tracking containers from manufacturer to dealer to farmer to return, and rewarding farmers for responsible container disposal.

**Tech Stack:**
- Website: Next.js 14 (App Router), Tailwind CSS, deployed to Vercel
- CRM: Next.js 14 (App Router), Tailwind CSS, Supabase JS client, deployed to Vercel
- Mobile App: Expo SDK 51+, React Native, Expo Router, Supabase JS client, Expo EAS Build
- Backend: Supabase (Postgres 15, Supabase Auth, Supabase RLS, Supabase Storage)
- QR: `qrcode` npm package (server-side generation), HMAC-SHA256 (Node.js `crypto`)
- Excel import: `xlsx` npm package (FPA spreadsheet ingestion)
- OCR: Vision LLM via API call (Gemini 1.5 Pro or Claude 3.5 Sonnet — configurable via `OCR_PROVIDER` env var)

**Architecture:** Monorepo with three apps (`apps/website`, `apps/crm`, `apps/mobile`), shared Supabase backend. Scan endpoint is surface-agnostic — CRM and mobile app both call the same REST API route.

**Repository:** `Lezzur/gabi-2.0` — monorepo. Directory structure:
```
apps/
  website/        # Next.js informational site
  crm/            # Next.js CRM
  mobile/         # Expo React Native app
packages/
  supabase/       # migrations/, seed/, types/
  shared/         # shared types, constants, validation schemas
```

---

## Constraints (Apply to ALL Phases)

1. All scan-related state transitions must be atomic — use Postgres transactions. Never leave state in an intermediate condition.
2. HMAC signature verification is the FIRST operation on every scan request, before any DB lookup. Reject immediately on invalid HMAC and log to `scan_attempts`.
3. Supabase RLS is the primary DB-layer security guard. Every table must have RLS enabled and explicit policies. No table is left with RLS disabled.
4. Every scan attempt — valid or invalid, authenticated or not — must be written to `scan_attempts`. This table is append-only (no UPDATE, no DELETE, ever).
5. No cron jobs for state cleanup. Expired `pending_purchase` and `pending_return_reward` records are detected lazily on next scan by checking `expires_at < now()`.
6. Products with un-confirmed safety-critical fields (`note_to_physician`, `category`) must remain in `status = 'draft'`. Draft products NEVER appear in scan results.
7. All timestamps stored as `timestamptz` (UTC). All client-provided timestamps stored alongside server-receive timestamps — never trust client time for state transitions.
8. FPA spreadsheet Excel date serials must be converted to ISO dates during import: `(serial - 25569) * 86400` → Unix timestamp → ISO 8601.
9. The scan API endpoint (`/api/scan`) is identical for CRM and mobile. No platform-specific scan logic.
10. All user-facing text strings must use i18n keys from day one. v1 ships English only; i18n infrastructure must be in place.
11. Mobile app must support offline scan queuing. Offline-queued scans sync on reconnect and are processed with `local_scan_ts` (device timestamp) for window eligibility checks.
12. Point values per return event are a configurable business parameter stored in the DB (`reward_config` table). Do not hardcode.

---

## Phase 1: Database Schema + Migrations

**Depends on:** Nothing (this is the foundation)
**Goal:** All tables, enums, indexes, and foreign keys exist and are migrated. Seed data validates schema correctness.

### Requirements

#### 1.1 Enums
1. Create Postgres enum `container_state`: `'in_distribution'`, `'pending_purchase'`, `'purchased'`, `'returned'`, `'rewards_paid'`
2. Create Postgres enum `product_status`: `'draft'`, `'active'`, `'suspended'`
3. Create Postgres enum `actor_type`: `'farmer'`, `'dealer'`, `'admin'`
4. Create Postgres enum `scan_step`: `'purchase_dealer'`, `'purchase_farmer'`, `'return_dealer'`, `'return_farmer'`
5. Create Postgres enum `scan_outcome`: `'success'`, `'hmac_invalid'`, `'auth_required'`, `'fpa_blocked'`, `'state_mismatch'`, `'window_expired'`, `'already_claimed'`, `'condition_rejected'`, `'product_draft'`
6. Create Postgres enum `formulation_type`: `'EC'`, `'SC'`, `'WP'`, `'WG'`, `'SL'`, `'GR'`, `'DP'`, `'ULV'`, `'OTHER'`
7. Create Postgres enum `toxicity_category`: `'1'`, `'2'`, `'3'`, `'4'`
8. Create Postgres enum `product_type`: `'HERBICIDE'`, `'INSECTICIDE'`, `'FUNGICIDE'`, `'RODENTICIDE'`, `'NEMATICIDE'`, `'ACARICIDE'`, `'OTHER'`

#### 1.2 Core Tables

**`products`**
```sql
id                               uuid PRIMARY KEY DEFAULT gen_random_uuid()
product_name                     text NOT NULL
brand_name                       text
company                          text NOT NULL
active_ingredient                text NOT NULL
concentration                    text             -- e.g. "250 g/L"
formulation_type                 formulation_type
type                             product_type
category                         toxicity_category  -- safety-critical
fpa_registration_number          text UNIQUE
fpa_registration_expires_at      date
fpa_last_imported_at             timestamptz
mode_of_entry                    text             -- verbatim FPA column: CONTACT, SYSTEMIC, etc.
mode_of_action_group             text             -- IRAC/FRAC/HRAC — manual CRM entry
dosage_rate                      text
mrl                              text             -- Maximum Residue Limit
pre_harvest_interval             text             -- PHI
re_entry_period                  text
distributor                      text
formulated_by                    text
imported_by                      text
timing_of_application            text
note_to_physician                text             -- safety-critical
pests                            text             -- aggregated pests/weeds/diseases text
status                           product_status NOT NULL DEFAULT 'draft'
category_confirmed_by            uuid REFERENCES auth.users(id)
category_confirmed_at            timestamptz
note_to_physician_confirmed_by   uuid REFERENCES auth.users(id)
note_to_physician_confirmed_at   timestamptz
label_image_storage_path         text
created_at                       timestamptz NOT NULL DEFAULT now()
updated_at                       timestamptz NOT NULL DEFAULT now()
```
- Index on `fpa_registration_number`
- Index on `status`
- `status` may only become `'active'` when BOTH `category_confirmed_by IS NOT NULL` AND `note_to_physician_confirmed_by IS NOT NULL`

**`product_crops`**
```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE
crop        text NOT NULL
pests       text
created_at  timestamptz NOT NULL DEFAULT now()
```
- Index on `product_id`
- Unique constraint on `(product_id, crop)`

**`containers`**
```sql
id                     uuid PRIMARY KEY DEFAULT gen_random_uuid()
product_id             uuid NOT NULL REFERENCES products(id)
hmac                   text NOT NULL
batch_number           text
manufacture_date       date
formulation_expires_at date GENERATED ALWAYS AS (manufacture_date + INTERVAL '2 years') STORED
state                  container_state NOT NULL DEFAULT 'in_distribution'
purchased_by_user_id   uuid REFERENCES auth.users(id)
dealer_id              uuid REFERENCES dealer_accounts(id)       -- original sale dealer
return_dealer_id       uuid REFERENCES dealer_accounts(id)       -- return-processing dealer
purchased_at           timestamptz
returned_at            timestamptz
rewards_paid_at        timestamptz
created_at             timestamptz NOT NULL DEFAULT now()
updated_at             timestamptz NOT NULL DEFAULT now()
```
- Index on `state`
- Index on `purchased_by_user_id`
- `hmac` is NOT NULL; stored as canonical reference; recomputed and compared on every scan

**`pending_purchase`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
container_id    uuid NOT NULL REFERENCES containers(id)
dealer_id       uuid NOT NULL REFERENCES dealer_accounts(id)
expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '60 minutes')
created_at      timestamptz NOT NULL DEFAULT now()
```
- Unique constraint on `container_id`
- Index on `(container_id, expires_at)`

**`pending_return_reward`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
container_id    uuid NOT NULL REFERENCES containers(id)
dealer_id       uuid NOT NULL REFERENCES dealer_accounts(id)
expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '60 minutes')
created_at      timestamptz NOT NULL DEFAULT now()
```
- Unique constraint on `container_id`
- Index on `(container_id, expires_at)`

**`scan_attempts`** (append-only — no UPDATE, no DELETE ever)
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
container_id    uuid             -- nullable: if HMAC invalid, container may not be resolved
actor_id        uuid
actor_type      actor_type
step            scan_step NOT NULL
outcome         scan_outcome NOT NULL
hmac_valid      boolean NOT NULL
auth_valid      boolean NOT NULL
ip_address      inet
local_scan_ts   timestamptz      -- device-reported timestamp
sync_ts         timestamptz NOT NULL DEFAULT now()  -- server receive time
device_id       text
last_online_ts  timestamptz      -- device snapshot of last-confirmed connectivity
sync_delayed    boolean NOT NULL DEFAULT false  -- true if (sync_ts - local_scan_ts) > 5 minutes
created_at      timestamptz NOT NULL DEFAULT now()
```
- Index on `container_id`
- Index on `actor_id`
- Index on `created_at`
- Index on `(outcome, created_at)` for alerting queries
- DB trigger: set `sync_delayed = true` automatically when `sync_ts - local_scan_ts > '5 minutes'::interval`

**`dealer_accounts`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES auth.users(id)
business_name   text NOT NULL
territory_notes text
is_verified     boolean NOT NULL DEFAULT false
verified_by     uuid REFERENCES auth.users(id)
verified_at     timestamptz
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

**`manufacturer_accounts`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES auth.users(id)
company_name    text NOT NULL
onboarded_by    uuid NOT NULL REFERENCES auth.users(id)  -- GAIA staff only
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

**`wallets`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES auth.users(id) UNIQUE
balance_points  integer NOT NULL DEFAULT 0 CHECK (balance_points >= 0)
updated_at      timestamptz NOT NULL DEFAULT now()
```

**`wallet_transactions`**
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
wallet_id       uuid NOT NULL REFERENCES wallets(id)
container_id    uuid REFERENCES containers(id)
points          integer NOT NULL  -- positive = credit, negative = debit
description     text NOT NULL
created_at      timestamptz NOT NULL DEFAULT now()
```

**`vouchers`**
```sql
id                     uuid PRIMARY KEY DEFAULT gen_random_uuid()
wallet_id              uuid NOT NULL REFERENCES wallets(id)
points_cost            integer NOT NULL
discount_value         numeric(10,2) NOT NULL
description            text NOT NULL
redeemed               boolean NOT NULL DEFAULT false
redeemed_at            timestamptz
redeemed_at_dealer_id  uuid REFERENCES dealer_accounts(id)
expires_at             timestamptz NOT NULL
created_at             timestamptz NOT NULL DEFAULT now()
```

**`reward_config`** (singleton business-parameter table — do not hardcode point values)
```sql
id                        uuid PRIMARY KEY DEFAULT gen_random_uuid()
farmer_points_per_return  integer NOT NULL DEFAULT 100
dealer_points_per_return  integer NOT NULL DEFAULT 50
updated_by                uuid REFERENCES auth.users(id)
updated_at                timestamptz NOT NULL DEFAULT now()
```
- Enforce singleton via unique partial index or trigger — only one row permitted.

**`user_profiles`**
```sql
id              uuid PRIMARY KEY REFERENCES auth.users(id)
phone_number    text UNIQUE
display_name    text
role            text NOT NULL DEFAULT 'farmer'  -- farmer | dealer | brand_admin | gabs_admin
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

#### 1.3 Seed Data
9. Seed `reward_config` with one row: `farmer_points_per_return = 100`, `dealer_points_per_return = 50` (placeholder — overridable via CRM).
10. Seed five test products: two active (both safety fields confirmed), two draft (safety fields pending), one suspended.
11. Seed ten test containers spread across all five container states.
12. Seed two dealer accounts (verified) and two farmer user accounts for integration test use.

### Non-Goals for This Phase
- Do NOT implement API routes.
- Do NOT implement RLS policies (Phase 2).
- Do NOT implement any application logic.

### Exit Criteria
- [ ] All migrations run successfully on a fresh Supabase project via `supabase db reset`
- [ ] Seed data loads without errors
- [ ] `supabase gen types typescript` produces a valid `database.types.ts` file with all tables
- [ ] All tables have correct columns, types, constraints, and indexes
- [ ] Querying `containers JOIN products` returns expected seed data
- [ ] `scan_attempts` table has no UPDATE or DELETE permissions granted to any role

---

## Phase 2: Supabase Auth + RLS Policies

**Depends on:** Phase 1 (all tables exist)
**Goal:** Authentication configured for phone OTP (farmers) and email/password (CRM users). RLS policies on every table enforce role-based access.

### Requirements

#### 2.1 Supabase Auth Configuration
1. Enable Phone OTP provider in Supabase Auth. SMS provider: Twilio (configurable via env vars).
2. Disable OAuth providers for all users.
3. Enable email/password for CRM users (dealers, admins) only. Phone OTP is the ONLY farmer auth method.
4. On new `auth.users` insert: auto-create `user_profiles` row (role = 'farmer') and `wallets` row via Postgres trigger.
5. On new user creation, default `user_profiles.role = 'farmer'`. Admin must manually elevate to `dealer`, `brand_admin`, or `gabs_admin` via CRM.

#### 2.2 RLS Policies

**`products`**
6. Read: `gabs_admin` and `brand_admin` read all. `dealer` and `farmer` read only `status = 'active'` rows.
7. Insert/Update: `gabs_admin` only.
8. Delete: Disallowed for all roles.

**`product_crops`**
9. Read: Same visibility rules as parent `products` row.
10. Insert/Update: `gabs_admin` only.

**`containers`**
11. Read: `gabs_admin` sees all. `dealer` sees rows where `dealer_id = auth.uid()` OR `return_dealer_id = auth.uid()`. `farmer` sees rows where `purchased_by_user_id = auth.uid()`.
12. Update: Server-side only via service role key in API routes. No client role may update directly.

**`scan_attempts`**
13. Insert: Via service role in API routes only (not direct client insert).
14. Read: `gabs_admin` sees all. Other roles see only rows where `actor_id = auth.uid()`.
15. Update/Delete: No role. Ever.

**`pending_purchase`, `pending_return_reward`**
16. All access: service role only. No client reads or writes.

**`dealer_accounts`**
17. Read: `gabs_admin` sees all. `dealer` reads own row only (`user_id = auth.uid()`). `farmer` cannot read.
18. Insert/Update: `gabs_admin` only.

**`wallets`**
19. Read: User reads own wallet only (`user_id = auth.uid()`). `gabs_admin` reads all.
20. Update: Service role only (reward-crediting logic).

**`wallet_transactions`**
21. Read: User reads own (via wallet join). `gabs_admin` reads all.
22. Insert: Service role only.

**`reward_config`**
23. Read: All authenticated roles.
24. Insert/Update: `gabs_admin` only.

### Non-Goals for This Phase
- Do NOT implement API route logic.
- Do NOT implement the scan flow (Phase 3).

### Exit Criteria
- [ ] Phone OTP login flow works end-to-end in staging Supabase project
- [ ] New farmer sign-up auto-creates `user_profiles` and `wallets` rows
- [ ] Farmer JWT cannot read `dealer_accounts` (403 response)
- [ ] Farmer JWT cannot read another farmer's `wallets` row
- [ ] `scan_attempts` returns 403 on UPDATE or DELETE attempt from any role
- [ ] `gabs_admin` JWT can read all rows in all tables
- [ ] Products with `status = 'draft'` are not returned for dealer or farmer RLS queries

---

## Phase 3: Core Scan API — State Machine

**Depends on:** Phase 1 (schema), Phase 2 (auth + RLS)
**Goal:** Single surface-agnostic endpoint `POST /api/scan` handles all four scan steps with correct state transitions, HMAC validation, lazy expiry detection, FPA checks, and forensic logging.

### Requirements

#### 3.1 Endpoint Specification

**`POST /api/scan`**

Request body:
```json
{
  "uuid": "string",
  "hmac": "string",
  "step": "purchase_dealer | purchase_farmer | return_dealer | return_farmer",
  "local_scan_ts": "ISO 8601 timestamp (device time)",
  "device_id": "string",
  "last_online_ts": "ISO 8601 timestamp (device's last known online time)",
  "condition_confirmed": "boolean (required for return_dealer step only)"
}
```

Response envelope (all outcomes):
```json
{
  "outcome": "success | hmac_invalid | auth_required | fpa_blocked | state_mismatch | window_expired | already_claimed | condition_rejected | product_draft",
  "container": { ... } | null,
  "product": { ... } | null,
  "message": "string (i18n key)",
  "rewards_credited": { "farmer_points": number, "dealer_points": number } | null,
  "fpa_warning": boolean,
  "pending_expires_at": "ISO 8601 timestamp | null"
}
```

25. Validate HMAC FIRST. Compute `HMAC-SHA256(uuid, process.env.HMAC_SECRET)`, compare to `hmac` parameter using `crypto.timingSafeEqual`. On mismatch: log to `scan_attempts` (`hmac_valid = false`), return `outcome: 'hmac_invalid'`, HTTP 401. Do not proceed with any DB lookup.
26. Verify actor is authenticated (valid Supabase JWT). On unauthenticated request: log to `scan_attempts` (`auth_valid = false`), return `outcome: 'auth_required'`, HTTP 401.
27. Log ALL attempts to `scan_attempts` with full context regardless of outcome.
28. Set `sync_delayed = true` on `scan_attempts` row if `now() - local_scan_ts > 5 minutes`.

#### 3.2 Purchase Flow — Step 1: Dealer Scan (`step = 'purchase_dealer'`)

29. Verify calling user has `role = 'dealer'` AND `dealer_accounts.is_verified = true`. On failure: `outcome: 'auth_required'`.
30. Fetch container by UUID. If not found: `outcome: 'state_mismatch'`.
31. Lazy expiry check: if a `pending_purchase` row exists for this container AND `pending_purchase.expires_at < now()`, DELETE the expired row, treat container as `in_distribution`.
32. FPA check: if `products.fpa_registration_expires_at < CURRENT_DATE` AND container state is `'in_distribution'`: return `outcome: 'fpa_blocked'`, message `'i18n:scan.fpa_expired_block'`. Hard block — no state change.
33. State check: container must be `'in_distribution'`. On mismatch: `outcome: 'state_mismatch'`.
34. Create `pending_purchase` row: `container_id`, `dealer_id = calling dealer`, `expires_at = now() + 60 minutes`.
35. Return `outcome: 'success'`, `pending_expires_at`, message `'i18n:scan.purchase.dealer_confirmed'`.

#### 3.3 Purchase Flow — Step 2: Farmer Scan (`step = 'purchase_farmer'`)

36. Verify calling user has `role = 'farmer'`. On failure: `outcome: 'auth_required'`.
37. Fetch container and associated `pending_purchase` row.
38. Lazy expiry check: if `pending_purchase` row is missing or `expires_at < now()`:
    - Check offline acceptance criteria (§3.6). If offline criteria met: proceed with offline acceptance path.
    - Otherwise: `outcome: 'window_expired'`, message `'i18n:scan.purchase.window_expired'`.
39. FPA check: if `products.fpa_registration_expires_at < CURRENT_DATE` AND state is `'pending_purchase'`: include `fpa_warning: true` in response — warning only, non-blocking.
40. Product status check: if `products.status = 'draft'`: `outcome: 'product_draft'`, message `'i18n:scan.product_pending'`.
41. Within a single Postgres transaction:
    - UPDATE `containers` SET `state = 'purchased'`, `purchased_by_user_id = auth.uid()`, `purchased_at = now()`
    - DELETE `pending_purchase` row for this container
42. Return product details: `product_name`, `brand_name`, `company`, `active_ingredient`, `concentration`, `formulation_type`, `type`, `category`, `fpa_registration_number`, `fpa_registration_expires_at`, `mode_of_entry`, `mode_of_action_group`, `dosage_rate`, `pre_harvest_interval`, `re_entry_period`, `note_to_physician`, `registered_crops[]`.
43. Return computed fields: `formulation_months_remaining` (integer months from today to `formulation_expires_at`, negative if expired), `fpa_status` (`'valid'` | `'expiring_soon'` if within 90 days | `'expired'`).
44. Return `outcome: 'success'`, message `'i18n:scan.purchase.farmer_confirmed'`.

#### 3.4 Return Flow — Step 1: Dealer Scan (`step = 'return_dealer'`)

45. Verify calling user has `role = 'dealer'` AND `dealer_accounts.is_verified = true`.
46. Fetch container. State must be `'purchased'`. On mismatch: `outcome: 'state_mismatch'`.
47. Require `condition_confirmed = true` in request body. If missing or false: `outcome: 'condition_rejected'`, message `'i18n:scan.return.condition_required'`.
48. Within a single Postgres transaction:
    - UPDATE `containers` SET `state = 'returned'`, `return_dealer_id = calling dealer`, `returned_at = now()`
    - INSERT EPR compliance event to audit log (timestamp, container_id, return_dealer_id, product_id)
    - INSERT `pending_return_reward` row: `container_id`, `dealer_id = calling dealer`, `expires_at = now() + 60 minutes`
49. EPR compliance event fires here — on dealer scan alone. It does NOT wait for farmer scan. It does NOT require farmer connectivity. The container state is `'returned'` regardless of whether farmer ever scans.
50. Return `outcome: 'success'`, `pending_expires_at`, message `'i18n:scan.return.dealer_confirmed'`.

#### 3.5 Return Flow — Step 2: Farmer Scan (`step = 'return_farmer'`)

51. Verify calling user has `role = 'farmer'`.
52. Fetch container and associated `pending_return_reward` row.
53. Lazy expiry check: if `pending_return_reward` is missing or `expires_at < now()`:
    - Container state remains `'returned'` — do NOT revert. Compliance is intact.
    - Return `outcome: 'window_expired'`, message `'i18n:scan.return.window_expired'`. No rewards issued. No retry path.
54. Within a single Postgres transaction:
    - UPDATE `containers` SET `state = 'rewards_paid'`, `rewards_paid_at = now()`
    - DELETE `pending_return_reward` row
    - Read `reward_config` (farmer and dealer point values)
    - Credit farmer wallet: INSERT `wallet_transactions` (+ `farmer_points_per_return`), UPDATE `wallets.balance_points += farmer_points_per_return`
    - Credit dealer wallet: INSERT `wallet_transactions` (+ `dealer_points_per_return`) for `pending_return_reward.dealer_id`, UPDATE that dealer's `wallets.balance_points`
55. Return `outcome: 'success'`, `rewards_credited: { farmer_points: N, dealer_points: N }`, message `'i18n:scan.return.rewards_paid'`.

#### 3.6 Offline Sync — Late Acceptance Logic

56. Offline late acceptance applies ONLY to `purchase_farmer` step. Dealer scans always require connectivity (dealers at POS have reliable connectivity — Decision #53).
57. Accept a late-syncing `purchase_farmer` scan if ALL three conditions are true:
    - (a) `local_scan_ts` falls within the original `pending_purchase.expires_at` window (i.e., device claimed it scanned before expiry)
    - (b) `now() - local_scan_ts <= 7 days` (hard cap — no acceptance beyond 7 days regardless of circumstances)
    - (c) `local_scan_ts >= last_online_ts` (scan occurred after device's last known online timestamp, confirming offline state)
58. Atomic claim: `UPDATE containers SET state='purchased', purchased_by_user_id=$1, purchased_at=now() WHERE id=$2 AND state IN ('in_distribution','pending_purchase') AND purchased_by_user_id IS NULL RETURNING id`. If `RETURNING` is empty: `outcome: 'already_claimed'`, HTTP 409.
59. The `pending_purchase` record is NOT required to exist for offline acceptance (may have been lazily deleted). If absent, proxy window check: `local_scan_ts >= now() - 60 minutes` OR `local_scan_ts <= now()` AND sync within 7-day cap.
60. Set `sync_delayed = true` on `scan_attempts` for all accepted late syncs.

### Non-Goals for This Phase
- Do NOT implement the CRM UI (Phase 7).
- Do NOT implement the mobile app (Phase 8).
- Do NOT implement FPA import (Phase 4).
- Do NOT implement OCR (Phase 5).

### Exit Criteria
- [ ] `POST /api/scan` with valid HMAC + `step=purchase_dealer` transitions container to `pending_purchase`
- [ ] Invalid HMAC returns 401 and logs `hmac_valid=false` to `scan_attempts`
- [ ] Expired `pending_purchase` + farmer scan returns `outcome: 'window_expired'`
- [ ] Expired FPA registration + dealer purchase scan returns `outcome: 'fpa_blocked'`
- [ ] Return scan with `condition_confirmed: false` returns `outcome: 'condition_rejected'`
- [ ] After dealer return scan, container state is `'returned'` even if farmer never scans
- [ ] After farmer return scan within window, both wallets credited atomically; `rewards_paid_at` set
- [ ] Concurrent offline sync: second claimant receives 409 `already_claimed`
- [ ] `scan_attempts` row exists for every test case above
- [ ] Draft product scan returns `outcome: 'product_draft'`

---

## Phase 4: FPA Spreadsheet Import Pipeline

**Depends on:** Phase 1 (products + product_crops tables), Phase 2 (gabs_admin RLS)
**Goal:** CRM API route accepts FPA Excel upload, parses it, converts date serials, deduplicates by registration number, upserts products, normalizes crops to child table.

### Requirements

#### 4.1 API Route: `POST /api/products/import-fpa`

61. Accept `multipart/form-data` with a single `.xlsx` file upload. Maximum file size: 50MB.
62. Only `gabs_admin` role may call this endpoint (middleware check before processing).
63. Parse using `xlsx` npm package. Target sheet name: `'LIST'`. Header row: index 5 (0-indexed) — data starts row index 6.
64. Map columns to DB fields:

| Spreadsheet Column | DB Field |
|--------------------|----------|
| NAME OF COMPANY | `company` |
| ACTIVE INGREDIENT | `active_ingredient` |
| PRODUCT NAME | `product_name` |
| CONCENTRATION | `concentration` |
| FORMULATION TYPE | `formulation_type` |
| USE/S | `type` |
| TOXICITY CATEGORY | `category` |
| REGISTRATION NO. | `fpa_registration_number` |
| EXPIRY DATE | `fpa_registration_expires_at` |
| MODE OF ENTRY | `mode_of_entry` |
| CROPS | `registered_crops` (normalize → product_crops) |
| PESTS / WEEDS / DISEASES | `pests` |
| RECOMMENDED RATE | `dosage_rate` |
| MRL (Proposed) | `mrl` |
| PHI | `pre_harvest_interval` |
| RE-ENTRY PERIOD | `re_entry_period` |

65. Convert `EXPIRY DATE` from Excel serial to ISO date: `new Date((serial - 25569) * 86400 * 1000).toISOString().slice(0, 10)`. Handle both numeric serials and pre-formatted date strings gracefully.
66. Group rows by `REGISTRATION NO.`. One `products` row per unique registration number. Aggregate all unique CROPS values into `product_crops` rows.
67. Upsert: `INSERT INTO products ... ON CONFLICT (fpa_registration_number) DO UPDATE SET` all 16 FPA-sourced fields. Preserve OCR-sourced fields on conflict — do NOT overwrite `note_to_physician`, `brand_name`, `distributor`, `formulated_by`, `imported_by`, `mode_of_action_group`.
68. Set `fpa_last_imported_at = now()` on every upserted row.
69. Do NOT change `status` from `'active'` to `'draft'` on upsert — FPA import does not gate product activation.
70. Return import summary: `{ inserted: N, updated: N, skipped: N, errors: [{ row: number, reason: string }] }`.
71. Process in batches of 500 rows — do not buffer the entire 31,990-row file in memory.

#### 4.2 Import Validation
72. Skip rows where `REGISTRATION NO.` is empty or null. Log as skipped.
73. Skip rows where `EXPIRY DATE` is unparseable. Log as error with row number and raw value.
74. Normalize `USE/S` to `product_type` enum: known values map directly (`HERBICIDE`, `INSECTICIDE`, `FUNGICIDE`, etc.); unknown → `'OTHER'`.
75. Normalize `TOXICITY CATEGORY` to `toxicity_category` enum: values `2`, `3`, `4` map to `'2'`, `'3'`, `'4'`. Unexpected values → log warning, skip field update.

### Non-Goals for This Phase
- Do NOT implement the CRM upload UI (Phase 7).
- Do NOT implement OCR (Phase 5).

### Exit Criteria
- [ ] Upload the provided FPA spreadsheet. Import completes without crashing.
- [ ] Result shows ≥ 5,000 unique products inserted (31,990 rows → many fewer unique REGISTRATION NO. values)
- [ ] A product with multiple crops has correct number of `product_crops` rows
- [ ] `fpa_registration_expires_at` stored as a valid ISO date (not a raw integer serial)
- [ ] Re-running import on same file: `inserted: 0`, `updated: N` — idempotent
- [ ] Non-gabs_admin role receives 403

---

## Phase 5: OCR Label Ingestion Pipeline

**Depends on:** Phase 1 (products table), Phase 2 (auth + RLS)
**Goal:** CRM operator uploads product label image → vision LLM extracts fields → human review UI → safety gate → product activates. Manual input fallback for all OCR failures.

### Requirements

#### 5.1 Label Upload + LLM Extraction: `POST /api/products/ocr`

76. Accept `multipart/form-data` with `label_image` (JPEG/PNG/WEBP, max 10MB) and optional `product_id` (UUID).
77. Store label image in Supabase Storage at path: `labels/{product_id}/{timestamp}.{ext}`. Set `products.label_image_storage_path`. Bucket is private (no public access).
78. Call vision LLM (provider from `OCR_PROVIDER` env var: `'gemini'` or `'claude'`). Use respective API client.
79. System prompt:
    ```
    You are extracting product registration data from a Philippine agrochemical product label.
    Extract ONLY what is explicitly printed on the label. Do NOT infer or fabricate values.
    Return a JSON object with these exact keys (use null if not found on the label):
    brand_name, distributor, formulated_by, imported_by, timing_of_application,
    note_to_physician, mode_of_action_group, concentration, active_ingredient,
    dosage_rate, pre_harvest_interval, re_entry_period, product_name, company
    Return ONLY valid JSON. No explanation text. No markdown code blocks.
    ```
80. Parse LLM JSON response. On parse failure: return `{ status: 'ocr_parse_failed', fields: null }`.
81. Return extracted fields to CRM — do NOT auto-save to `products` yet. Include per-field confidence: `'extracted'` (non-null) or `'not_found'` (null).

#### 5.2 Human Review + Safety Gate: `POST /api/products/ocr/confirm`

82. Accept reviewed and operator-corrected field values plus two explicit confirmation flags:
    - `category_confirmed: true` — operator confirms the `category` value
    - `note_to_physician_confirmed: true` — operator confirms `note_to_physician`
83. If EITHER flag is missing or false: reject with HTTP 400, message `'Safety-critical fields must be explicitly confirmed before saving'`.
84. On valid confirmation: upsert to `products`, set confirming user ID + timestamp for both fields.
85. If both safety fields confirmed and all required fields present: set `products.status = 'active'`.
86. If required fields still null after review: keep `status = 'draft'`, return list of missing fields.

#### 5.3 Failure Modes
87. LLM timeout (>30 seconds): return `{ status: 'ocr_timeout' }`. Operator falls back to manual input.
88. LLM rate limit (429): return `{ status: 'ocr_rate_limited', retry_after: N }`.
89. LLM returns malformed response: log full response, return `{ status: 'ocr_parse_failed' }`.
90. Manual input fallback: all form fields pre-populated with OCR results (editable). Operator can submit with any combination of OCR + manual values. No LLM result required to complete activation.

### Non-Goals for This Phase
- Do NOT implement the CRM review UI (Phase 7).
- OCR does NOT auto-activate products — human confirmation is always required.

### Exit Criteria
- [ ] Upload a test label image → LLM returns JSON with ≥ 5 non-null fields
- [ ] Confirm request without `category_confirmed: true` returns HTTP 400
- [ ] After confirming both safety fields, `products.status` becomes `'active'`
- [ ] LLM timeout (simulated) returns `ocr_timeout` response; operator can proceed with manual entry
- [ ] Manual-only flow (no OCR extraction) can produce an active product

---

## Phase 6: QR Generation + Label Export

**Depends on:** Phase 1 (containers), Phase 2 (auth), Phase 3 (HMAC logic)
**Goal:** GABS admin generates batch of UUID containers for an active product, computes HMACs, exports QR codes and product data in Zebra-compatible format.

### Requirements

#### 6.1 Batch QR Generation: `POST /api/containers/generate`

91. Only `gabs_admin` role may call this endpoint.
92. Request body: `{ product_id: uuid, batch_number: string, manufacture_date: ISO date string, quantity: integer (1–10000) }`.
93. Validate: `product_id` must reference an `active` product. Reject draft/suspended products with HTTP 400.
94. Generate `quantity` UUID v4 values server-side. For each:
    - Compute HMAC: `HMAC-SHA256(uuid, HMAC_SECRET)` — use full hex output. Store full HMAC in `containers.hmac`.
    - URL suffix: first 16 hex characters of HMAC (for URL compactness).
    - Insert row: `id = uuid`, `hmac = full_hmac`, `product_id`, `batch_number`, `manufacture_date`, `state = 'in_distribution'`.
95. Return: `Array<{ uuid, url: 'https://gaia.ph/scan/<uuid>.<hmac_16_chars>' }>`.
96. At scan time, verification recomputes full HMAC and uses `crypto.timingSafeEqual` to compare — prevents timing attacks.

#### 6.2 QR Code + Label Export: `POST /api/containers/export-labels`

97. Accept `{ container_ids: uuid[], format: 'pdf' | 'zpl' }`.
98. For each container, generate:
    - QR code image (PNG, 300×300px) encoding `https://gaia.ph/scan/<uuid>.<hmac_16>`
    - Label data payload: product name, company, active ingredient, concentration, formulation type, FPA registration number, FPA expiry, batch number, manufacture date, formulation expiry, PHI, re-entry period, toxicity category symbol
99. PDF format: one label per page, 4×6 inch dimensions (Zebra ZD420 / GK420 compatible).
100. ZPL format: generate ZPL commands for Zebra thermal printer.
101. Return binary file download with appropriate `Content-Type` and `Content-Disposition` headers.

### Non-Goals for This Phase
- Do NOT implement CRM UI (Phase 7).
- Label visual design (logo, typography, color) is a Phase 7 design concern.

### Exit Criteria
- [ ] Generate 100 containers for an active product — 100 rows in `containers` table, all `state = 'in_distribution'`
- [ ] HMAC verification on a generated UUID+HMAC passes in the scan endpoint
- [ ] Modifying the UUID or HMAC by one character causes scan to return `hmac_invalid`
- [ ] Export PDF for 10 containers — PDF has 10 pages, each with QR code and product fields visible
- [ ] Attempting to generate for a draft product returns HTTP 400

---

## Phase 7: CRM Surface

**Depends on:** Phases 1–6 (all backend logic complete)
**Goal:** Next.js CRM at `apps/crm` provides all operational surfaces: dealer management, product management (FPA import + OCR), container/QR management, scan history, compliance reporting.

### Requirements

#### 7.1 Authentication + Layout
102. CRM uses Supabase Auth with email/password. No phone OTP in CRM.
103. `farmer` role cannot access CRM — redirect to 403 page.
104. Sidebar navigation: Products | Containers | Dealers | Manufacturers | Reports | Settings.
105. Role-scoped nav: `dealer` sees Products (read-only) + Containers (own) + Reports (own). `brand_admin` sees Products (edit own) + Containers + Reports. `gabs_admin` sees all.

#### 7.2 Product Management
106. Product list page: table, paginated 50/page, filterable by status / type / company. Columns: product name, company, FPA reg #, FPA expiry, status badge, last updated.
107. Product detail page: all fields displayed. Edit form for `gabs_admin` and `brand_admin`.
108. FPA Import page: drag-and-drop `.xlsx` upload. Progress indicator. Post-import summary table: inserted / updated / skipped / errors.
109. OCR ingestion flow (from product detail — "Add from Label"):
    - Step 1: Upload label image (drag-and-drop or file picker, max 10MB)
    - Step 2: Review extracted fields. Each field shows extracted value (editable) + confidence badge. "Fill manually" option skips OCR.
    - Step 3: Safety confirmation panel with two explicit checkboxes:
      - `[ ] I confirm the Toxicity Category is: [value] — verified on physical label`
      - `[ ] I confirm the Note to Physician / Antidote is: [value] — verified on physical label`
      - Submit button disabled until both checkboxes checked.
    - Step 4: Success — product status shows "Active."
110. Manual fallback: all form fields editable regardless of OCR result.

#### 7.3 Container + QR Management
111. Container list: table filterable by product / state / batch. Columns: UUID (truncated), product, batch, state badge, manufacture date, formulation expiry.
112. Batch generation form: select active product, enter batch number + manufacture date + quantity → download label export immediately on completion.
113. Container detail: full scan history (all `scan_attempts` for this UUID — timestamped, actor, outcome).

#### 7.4 Dealer Scan Interface
114. Dealer scan page: full-screen QR scanner using browser camera (`html5-qrcode` or `@zxing/browser`). Context toggle above scanner: "Purchase" / "Return".
115. Purchase scan result states:
    - Success: green card, product summary, 60-minute countdown timer. "Customer must scan within 60 minutes."
    - FPA blocked: red card with FPA expiry date. "FPA registration expired — cannot proceed with sale."
    - State mismatch: yellow card. "This container is not available for sale."
116. Return scan: show condition confirmation dialog BEFORE submitting — "Confirm this container is clean and has been punctured." [Confirm] [Cancel]. After dealer confirmation:
    - Success: green card, compliance confirmed, 60-minute countdown.
    - State mismatch: yellow card. "Container must be in purchased state to process return."
117. Countdown timers: update every second, turn red below 5 minutes, display "Expired" at 0:00.

#### 7.5 Dealer Management
118. Dealer list: business name, verification status, created date.
119. Dealer detail: contact info, territory notes, verification status. Verify button (`gabs_admin` only).
120. Invite dealer: email invite via Supabase Auth magic link.

#### 7.6 Reports + Compliance Export
121. Compliance report: filter by date range, dealer, product, manufacturer. Metrics: total returns, total EPR events, return rate (returns ÷ purchases per period).
122. CSV export: all scan events in date range. Columns: timestamp, container UUID, product name, FPA reg #, actor type, outcome, step.

#### 7.7 Wallet Management
123. Dealer wallet: balance + transaction history + voucher list.
124. `gabs_admin` can view any user's wallet.

#### 7.8 UI States — All CRM Components
125. Every data table: loading (skeleton rows), loaded (data), empty (contextual empty-state message + action CTA), error (error message + retry button).
126. Every form: default, submitting (fields disabled + spinner on submit button), success (toast), error (inline field errors + global error banner).
127. Every scan result card: success (green), warning (yellow), blocked (red), loading (spinner while API responds).

### Performance (CRM)
128. Product list LCP < 2.5 seconds with 1,000 products in DB on 10 Mbps connection.
129. FPA import of 31,990-row spreadsheet completes within 120 seconds.
130. Container list: virtualized scrolling (`@tanstack/react-virtual`) for lists > 200 rows.

### Non-Goals for This Phase
- Pi Network wallet integration — Phase 3+.
- Manufacturer self-serve portal — not in v1.
- Advanced analytics dashboards — post-launch.

### Exit Criteria
- [ ] Dealer can log in, open scan page, scan a container QR, and see a success state
- [ ] OCR flow: upload image → see extracted fields → confirm safety fields → product status = active
- [ ] FPA import: upload full spreadsheet → summary shows inserted count > 5,000
- [ ] Compliance export: download CSV for date range with correct columns
- [ ] All table empty states render a non-blank UI
- [ ] Countdown timer decrements correctly and turns red below 5 minutes

---

## Phase 8: Farmer Mobile App

**Depends on:** Phase 1 (schema), Phase 2 (auth), Phase 3 (scan API), Phase 6 (QR format)
**Goal:** Expo React Native app for iOS 16+ and Android 10+. Phone OTP auth, QR scanning (purchase + return), offline queue, rewards wallet.

### Requirements

#### 8.1 Authentication — Phone OTP
131. Onboarding: enter phone number → receive OTP SMS → enter OTP → logged in.
132. Phone number is the only auth method — no email, no social.
133. Persist session in Expo SecureStore. Auto-refresh JWT silently.
134. Logout clears session from SecureStore.

#### 8.2 Scan Screen
135. Full-screen camera view with QR overlay frame.
136. Context toggle above scanner: "Buying" (default) / "Returning" — sets `step` parameter.
137. On QR detected:
    - Parse URL: `https://gaia.ph/scan/<uuid>.<hmac_16>`
    - If online: POST to `/api/scan` immediately.
    - If offline: enqueue to local offline queue (see §8.3). Show "Scan saved — will sync when you're back online."
138. Scan result screen states:
    - Success (purchase): product card — product name, company, category icon, formulation expiry bar (remaining months), PHI, re-entry period, FPA status badge. CTA: "Back to scanner."
    - Success (return): "+N points" confirmation card with confetti animation.
    - Window expired: "The 60-minute window has passed. Ask your dealer to scan again."
    - FPA warning (non-blocking): yellow banner above product card: "This product's FPA registration has expired. Use with caution."
    - Product draft: "This product is pending registration. Contact your dealer."
    - HMAC invalid: "This QR code may be counterfeit. Do not use this product." (red screen, prominent warning)
    - Auth required: Redirect to login screen.

#### 8.3 Offline Queue
139. Queue stored in AsyncStorage at key `'gaia_offline_queue'`. Schema: `Array<{ uuid, hmac, step, local_scan_ts, device_id, last_online_ts }>`.
140. On app foreground + connectivity detected: drain queue sequentially. POST each item to `/api/scan`. On `already_claimed` or `window_expired`: mark failed, do not retry.
141. Scan screen shows offline queue badge (count of pending items) when queue is non-empty.
142. "N scans pending sync" banner with manual sync button.
143. After successful sync: show result card for each queued scan.
144. `last_online_ts`: updated to `now()` every time network connectivity is confirmed. Persisted in AsyncStorage.

#### 8.4 Wallet Screen
145. Current points balance (large, prominent).
146. Transaction history: description, points delta, date.
147. Redeem button: opens voucher redemption — shows available vouchers by points cost. Redemption calls `POST /api/wallet/redeem`.
148. Active voucher list: shows unredeemed, unexpired vouchers with QR code for dealer scanning at redemption.

#### 8.5 Scan History Screen
149. List: product name, scan type (purchase/return), date, outcome badge.
150. Tap → product detail card.

#### 8.6 Profile Screen
151. Phone number (masked: `+63 9XX XXX X###`).
152. Logout button.
153. App version.

#### 8.7 UI States — All Mobile Screens
154. Scan screen: camera active (default), loading (spinner while API responds), success, warning, error, offline (badge showing queued count).
155. Wallet: loading (skeleton), loaded (balance + list), empty ("Start scanning to earn rewards").
156. All screens: offline banner at top when no connectivity.

### Performance (Mobile)
157. Camera activation to first QR decode: < 1 second on mid-range Android.
158. Scan → API response → result rendered: < 2 seconds on 4G.
159. Offline queue drain (50 items): < 30 seconds on reconnect.
160. Cold start: < 3 seconds on iPhone 12 / Samsung Galaxy A52 (benchmark devices).

### Non-Goals for This Phase
- Pi Network wallet — Phase 3+.
- Push notifications — post-launch.
- In-app product search or browse — scan-only app.

### Exit Criteria
- [ ] Phone OTP login works end-to-end with real SMS delivery in staging
- [ ] Scanning valid QR while online shows full product card
- [ ] Scanning valid QR while offline adds to queue and shows "Scan saved"
- [ ] Reconnecting syncs queue and shows result cards
- [ ] HMAC-invalid QR shows counterfeit warning screen
- [ ] Wallet shows correct balance after return reward credited
- [ ] Cold start < 3 seconds on Samsung Galaxy A52

---

## Phase 9: Informational Website

**Depends on:** Nothing structural (static content surface)
**Goal:** Next.js SSG website at `apps/website`. Full rebuild from Lovable prototype in Next.js App Router. Target audiences: farmers, FPA regulators, brand representatives, general public.

### Requirements

#### 9.1 Pages + Routes
161. `/` — Homepage: hero, 4-stage lifecycle, 4-role grid, stats section, Pi Network section, CTAs
162. `/how-it-works` — Step-by-step scan flow (illustrated, farmer-facing language)
163. `/for-brands` — Manufacturer/brand value proposition (EPR compliance, audit reports, label service)
164. `/for-dealers` — Dealer value proposition (rewards, return processing, compliance)
165. `/contact` — Contact form
166. `/privacy` — Privacy policy (placeholder, legally reviewed pre-launch)

#### 9.2 Design System (From Prototype)
167. Primary color: deep forest green `#1A3D2E`
168. Background: warm cream `#F5EDD8`
169. Accent/CTA: gold `#C8952A`
170. Hero H1: Bold serif (Playfair Display), 56px desktop / 36px mobile
171. Body: Inter or Poppins, 16px desktop / 15px mobile
172. H2: 40px desktop / 28px mobile

#### 9.3 Hero Section
173. Headline (exact copy, not a placeholder): **"Authentic inputs. Rewarded farmers. Audit-ready stewardship."**
174. Subheadline: 2-sentence description of GAIA's purpose.
175. Primary CTA: "Open demo" (URL configurable via env var `DEMO_URL`). Secondary CTA: "Talk to the team" (links to `/contact`).

#### 9.4 Lifecycle Section
176. Four cards: Verify Products → Grants and Rewards → Returns Container → Customer Compliance.
177. Each: icon, title, 2-sentence description.

#### 9.5 Four Roles Section
178. Grid: Verify Products (Farmer) | Sight Checkers (Regulators) | Brand Solutions (Manufacturers) | GABS Hyper Admin.
179. Each: icon, role title, 1-sentence description.

#### 9.6 Pi Network Section
180. Heading: **"Pi Network & on-chain traceability — in the architecture, not on the demo."** (exact copy)
181. Body: 2–3 sentences on v2 roadmap. Do NOT remove this section.

#### 9.7 Responsive Breakpoints
182. Mobile < 768px: navigation collapses to hamburger, all sections stack vertically.
183. Tablet 768–1024px: 2-column grids where applicable.
184. Desktop > 1024px: full layout.

#### 9.8 Performance
185. Lighthouse Performance ≥ 90 desktop, ≥ 80 mobile (measured via Lighthouse CLI).
186. LCP < 2.5 seconds on 4G.
187. CLS < 0.1.
188. All pages rendered as Next.js SSG — no client-side JS required for initial render.

#### 9.9 Contact Form
189. POST to `/api/contact` (Next.js API route).
190. Send email to `CONTACT_EMAIL` env var via Resend.
191. Form states: default, submitting (disabled + spinner), success ("We'll be in touch"), error ("Something went wrong — try again").
192. Rate limiting: 5 submissions per IP per hour.

### Non-Goals for This Phase
- Blog / news / press section — not in v1.
- App Store download links — mobile not in App Store at website launch.
- Live scan demo embedded in website.

### Exit Criteria
- [ ] All 6 pages render at 375px, 768px, and 1440px viewport widths
- [ ] Hero headline exact text present: "Authentic inputs. Rewarded farmers. Audit-ready stewardship."
- [ ] Pi Network section present on homepage
- [ ] Lighthouse Performance ≥ 90 on desktop
- [ ] Contact form delivers email to configured recipient
- [ ] No hydration errors in browser console on any page

---

## Phase 10: Integration + Launch Prep

**Depends on:** Phases 1–9 complete
**Goal:** End-to-end integration tests pass, performance benchmarks verified, security checklist complete, deployment configurations ready.

### Requirements

#### 10.1 End-to-End Tests
193. E2E: Full purchase flow — dealer scan → `pending_purchase` created → farmer scan → container `purchased`, product card returned.
194. E2E: Full return flow — dealer return scan → container `returned` + EPR event logged → farmer return scan within window → `rewards_paid` + both wallets credited.
195. E2E: FPA block — dealer scans expired-FPA container → `fpa_blocked`, no state change.
196. E2E: Window expiry — dealer scans → advance DB clock 61 minutes → farmer scans → `window_expired`, container stays `in_distribution`.
197. E2E: Offline sync — farmer scan added to offline queue → sync on reconnect → container `purchased`.
198. E2E: OCR pipeline — upload label image → LLM extraction → confirm safety fields → product `active`.
199. E2E: FPA import — upload spreadsheet → products created → re-upload → idempotent (no duplicates).

#### 10.2 Security Checklist
200. `HMAC_SECRET` rotated to a unique random value in production (not development default).
201. Supabase service role key is server-side only — confirm it does not appear in any client bundle.
202. All API routes validate auth via middleware before business logic executes.
203. `scan_attempts` DELETE and UPDATE blocked at DB level — verified by direct Supabase client test.
204. Label images in Supabase Storage: private bucket confirmed (no public URL access).
205. Contact form rate limiting: 5/IP/hour enforced.

#### 10.3 Deployment Configuration
206. `.env.example` documenting all required env vars for each app (`apps/website`, `apps/crm`, `apps/mobile`).
207. Vercel projects created for `apps/website` and `apps/crm` with all production env vars set.
208. Expo EAS Build configured for `apps/mobile` with production Supabase URL and anon key.
209. Supabase production project: RLS verified enabled on all tables. Confirm via `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` — all rows must show `rowsecurity = true`.

#### 10.4 Performance Benchmarks
210. Scan API p95 response time: < 800ms under 50 concurrent requests (load test with k6 or Artillery).
211. FPA import 31,990-row spreadsheet: completes within 120 seconds.
212. CRM product list (1,000 products) LCP: < 2.5 seconds.
213. Website Lighthouse Performance: ≥ 90 desktop.
214. Mobile cold start: < 3 seconds on Samsung Galaxy A52.

### Exit Criteria
- [ ] All 7 E2E tests pass against staging environment
- [ ] Security checklist: all 6 items verified and documented
- [ ] All deployment configs complete
- [ ] Scan API p95 < 800ms under load test
- [ ] No open P0 bugs

---

## AI/ML Specification — OCR Vision LLM Pipeline

### Solution Approach

**Prompt Engineering** — the OCR task is structured extraction: the vision LLM receives a product label image and returns a fixed JSON schema. No fine-tuning required; the safety gate ensures zero auto-deployment risk. Provider: Gemini 1.5 Pro (primary) or Claude 3.5 Sonnet (fallback), configurable via `OCR_PROVIDER` env var.

### Model Requirements

| Requirement | Spec |
|---|---|
| Input | JPEG/PNG/WEBP label image, max 10MB |
| Output | JSON object with 14 specific field keys, null for missing |
| Latency | < 30 seconds p95 |
| Cost per call | < $0.05 (Gemini 1.5 Pro estimate: ~$0.003 per call) |
| Context window | ~2,000 input tokens + 1 image — no chunking needed |
| Provider fallback | If `OCR_PROVIDER=gemini` fails, log error and return `ocr_unavailable` |

### Quality and Evaluation

**Accuracy targets:**
- Field extraction accuracy > 90% on 50-label held-out test set (human review of extracted vs. actual label values)
- Null rate < 30% — most visible fields should be extracted, not returned as null

**Hallucination tolerance:**

| Field | Tolerance | Reason |
|---|---|---|
| `note_to_physician`, `category` | Zero | Safety-critical — incorrect values are a medical risk. Mandatory human confirmation gate before any use. |
| `product_name`, `active_ingredient`, `fpa_registration_number` | Low | Errors are recoverable but significant. Operator confirms in review UI. |
| `distributor`, `imported_by`, `formulated_by` | Acceptable | Minor inaccuracies corrected by operator. |

**Evaluation methodology:** v1 relies on 100% human review (the safety gate). Post-launch: track edit distance between LLM output and operator-confirmed values. Target < 20% of extracted fields edited per label.

### Human-in-the-Loop Requirements

| Output Type | Review Required | Reviewer | SLA |
|---|---|---|---|
| `note_to_physician` | Always, before activation | GABS admin operator | Before `status = active` |
| `category` (toxicity) | Always, before activation | GABS admin operator | Before `status = active` |
| All other fields | Always (pre-populated, editable) | GABS admin operator | Before `status = active` |

**Escalation:** If operator cannot determine a field (damaged label), leave null, keep `status = 'draft'`, flag for manufacturer follow-up.
**Override:** All extracted values fully editable in review UI. No feedback loop to LLM in v1.

### Failure Modes and Fallbacks

| Failure | Detection | Fallback | User Experience |
|---|---|---|---|
| LLM timeout (>30s) | Response time | Return `ocr_timeout` | "AI extraction timed out — fill manually" |
| LLM unavailable (503) | HTTP 503 | Return `ocr_unavailable` | "AI service unavailable — fill manually" |
| Invalid JSON response | Parse failure | Return `ocr_parse_failed` | "Extraction failed — fill manually" |
| Rate limit (429) | HTTP 429 | Return `ocr_rate_limited` + `retry_after` | "Too many requests — try in N seconds" |
| High null rate (>10 nulls) | Count nulls in response | Warn operator | "Most fields not extracted — please fill manually" |

All failure paths route to the same manual input form. OCR is a convenience, not a gate.

### Feedback Loops (v1)
- Capture edit distance per field (LLM value vs. confirmed value) for future prompt tuning.
- Track null rate per field type across all OCR runs.
- Prompt review cadence: every 6 months or when null rate exceeds 40%.

### Content Safety and Guardrails
- Only authenticated `gabs_admin` users can upload label images — no public upload endpoint.
- LLM output is never auto-saved — always populates a human review form.
- Label images stored in private Supabase Storage bucket (no public access).
- Label images are not shared with third parties beyond the single LLM API call.
- UI labels all pre-populated fields: "Extracted by AI — please verify."

### Cost Modeling

| Item | Value |
|---|---|
| Per-call cost (Gemini 1.5 Pro) | ~$0.003 |
| Projected monthly volume (v1) | ~50 product registrations/month |
| Monthly cost projection | ~$0.15/month |
| Cost ceiling | $10/month — alert if exceeded |
| Optimization | Cache extracted fields by `label_image_storage_path` — skip LLM call if same image resubmitted |

---

## Self-Verification Checklist

After completing all phases:

- [ ] All Phase exit criteria from Phases 1–10 are met
- [ ] No requirement from any phase was skipped
- [ ] Global constraints 1–12 respected throughout all phases
- [ ] HMAC verification is the first operation on EVERY scan code path — confirmed in code review
- [ ] `scan_attempts` is append-only — no UPDATE or DELETE anywhere in codebase
- [ ] RLS enabled on ALL tables — confirmed via `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`
- [ ] Products with `status = 'draft'` never appear in scan results — confirmed with test
- [ ] Offline sync race condition handled by atomic `UPDATE ... WHERE ... RETURNING` — confirmed in code
- [ ] EPR compliance event fires on dealer return scan alone, not dependent on farmer scan — confirmed in code
- [ ] Point values read from `reward_config` table — no hardcoded values anywhere in codebase
- [ ] `formulation_expires_at` uses Postgres generated column (`manufacture_date + 2 years`) — confirmed in schema
- [ ] Excel serial date conversion tested against real FPA spreadsheet values
- [ ] `HMAC_SECRET` stored in env var — not committed to repository
- [ ] All user-facing strings use i18n keys — no hardcoded English in component JSX

---

## Decisions

All 53 decisions locked as of discovery close (2026-04-24). Downstream stages must not contradict without a logged amendment.

| # | Decision |
|---|---|
| 1 | 4 surfaces: website, CRM, mobile app, Supabase backend |
| 2 | v1 MVP: website + CRM + backend first, mobile follows |
| 3 | QR code: UUID-only payload, no embedded data |
| 4 | HMAC-signed QR URLs: `gaia.ph/scan/<uuid>.<hmac>` |
| 5 | Stack: Next.js 14 + Supabase + Vercel + Expo SDK 51+ |
| 6 | Rewards: return stage only, no purchase-stage rewards |
| 7 | Both farmer AND dealer earn points at return |
| 8 | Both rewards require both scans (dealer + farmer) at return |
| 9 | FPA integration: monthly spreadsheet import, not live API |
| 10 | Auth + expiry check on every scan, always |
| 11 | `scan_attempts` forensic table — append-only |
| 12 | Supabase RLS as primary DB-layer exploit guard |
| 13 | Pi Network deferred to Phase 3+ |
| 14 | CRM includes QR batch generation + Zebra label export |
| 15 | Zebra thermal transfer printer + polypropylene labels |
| 16 | GAIA generates labels → ships to manufacturers → manufacturers apply |
| 17 | Dual-confirmation purchase flow: dealer scans first, farmer scans within 60 min |
| 18 | 60-minute window for both pending_purchase and pending_return_reward |
| 19 | Lazy evaluation for expired pending records — no cron cleanup jobs |
| 20 | Expired pending_purchase: lazily deleted on next scan, container treated as in_distribution |
| 21 | Dual-scan return: dealer scans first (compliance fires), farmer scans within 60 min (rewards fire) |
| 22 | Compliance event fires on dealer return scan alone — never blocked by farmer connectivity |
| 23 | Return: co-presence expected, same 60-minute window |
| 24 | Cross-dealer returns: any registered dealer can process, rewards follow container UUID |
| 25 | Dealer-first at both purchase and return |
| 26 | Two expiration types: formulation (2 years, per-container) + FPA registration (3 years, per-product) |
| 27 | Remaining formulation months surfaced on farmer scan |
| 28 | FPA expiry: hard block at dealer purchase scan (in_distribution), warning only at farmer scan (purchased) |
| 29 | FPA check runs at dealer scan step AND farmer scan step |
| 30 | OCR via vision LLM for non-FPA product fields |
| 31 | Manual input fallback for OCR |
| 32 | Mandatory human verification for note_to_physician + category before product goes active |
| 33 | Website: full rebuild from Lovable prototype in Next.js |
| 34 | Scan endpoint is surface-agnostic REST API — identical for CRM and mobile |
| 35 | FPA spreadsheet confirmed: 31,990 rows, sheet "LIST", header row 6, denormalized |
| 36 | mode_of_entry (FPA verbatim) ≠ mode_of_action_group (IRAC/FRAC/HRAC manual) — separate fields |
| 37 | Dealer requires CRM-connected device at POS |
| 38 | product_crops normalized child table — import groups by REGISTRATION NO. |
| 39 | FPA EXPIRY DATE stored as Excel serial — convert to ISO during import |
| 40 | Farmer mobile app auth: phone number OTP only |
| 41 | Offline mode required for farmer mobile app |
| 42 | Dealer territories: dealer-defined (not fixed geographic boundaries) |
| 43 | Pi Network: delayed — must prove concept first |
| 44 | Points redemption v1: discount vouchers. Future: AI-app store |
| 45 | Retroactive QR: new production batches only — no shelf stock retrofitting |
| 46 | Manufacturer onboarding: GAIA staff only, no self-serve portal |
| 47 | re_entry_period surfaces on farmer scan result alongside PHI — v1 |
| 48 | mode_of_action_group (IRAC/FRAC/HRAC): required in v1, manual CRM entry |
| 49 | Offline sync: window eligibility measured by device's local_scan_ts, not server receive time |
| 50 | Offline trust model: accept if (a) local_scan_ts in window AND (b) sync ≤ 7 days AND (c) local_scan_ts ≥ last_online_ts |
| 51 | Syncs >5 min delayed flagged sync_delayed=true in scan_attempts for audit |
| 52 | Late farmer sync: accept if container unclaimed (atomic UPDATE RETURNING), else 409 ALREADY_CLAIMED |
| 53 | Dealer return compliance fires immediately — no offline queue for dealer scans |
