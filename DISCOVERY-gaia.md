# GAIA / GABI 2.0 — Discovery Document
**Session:** Discovery Room v1 · 2026-04-24
**Scribe:** Lisa Hayes
**Version:** 2 (updated post-session with all final decisions)
**Status:** FINAL — discovery complete, ready for PRD

---

## 0. Document Purpose

This is the canonical record of every decision, assumption, constraint, and open question captured during the GAIA / GABI 2.0 discovery session. It is the single source of truth from which the PRD, tech specs, and build plans will be derived. Nothing downstream should contradict this document without a logged decision.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Product Name** | GABI 2.0 (also referred to as GAIA internally) |
| **Full Name** | GABI Steward 2.0 |
| **Category** | Agricultural traceability + EPR compliance platform |
| **Market** | Republic of the Philippines |
| **Regulatory Scope** | FPA (Fertilizer and Pesticide Authority) — DENR/EMB EPR compliance |
| **Prototype URL** | https://preview--gabi-steward.lovable.app/ |
| **Repo** | Lezzur/gabi-2.0 |

---

## 2. The Problem

### 2.1 Primary Problem: Agrochemical Counterfeiting
The Philippine agrochemical market is infiltrated with counterfeit and unregistered products. Farmers cannot verify that what they're buying is genuine, FPA-registered, or safe for application. There is no reliable real-time authentication mechanism at the point of purchase or use.

### 2.2 Secondary Problem: EPR Compliance Gap
Republic Act 11898 (Extended Producer Responsibility Act) mandates that manufacturers and distributors account for the lifecycle of their products — including packaging return and proper disposal. No centralized system exists to track whether containers are actually being returned, who is returning them, and whether compliance targets are being met.

### 2.3 Third Problem: Farmer Participation Gap
Farmers lack economic incentive to return empty containers to dealers. The burden of EPR compliance falls upstream (on brands/manufacturers) but the actual behavior required happens at the farmer level. The reward infrastructure connecting those two parties does not exist.

### 2.4 Scan Design Goals (Rick's Three Goals)
The scan system must simultaneously:
1. Encourage farmers to use the app by providing rewards
2. Monitor and collect data on product purchases
3. Shape farmer behavior when purchasing (checking expiration, verifying authenticity)

And explicitly avoid: scan exploits, complicated systems, error-prone flows.

### 2.5 Hero Copy (Prototype-Confirmed)
> "Authentic inputs. Rewarded farmers. Audit-ready stewardship."

---

## 3. The Platform — GAIA

GAIA is the underlying platform. GABI Steward is its consumer-facing brand identity.

### Core Promise
A closed loop from shelf to compliance report — verifying every product, ensuring responsible use, tracking every container from manufacturer to dealer to farmer to return.

### Prototype-Confirmed Lifecycle (4 Stages)
1. **Verify products** — Manufacturer registers product, QR labels generated and applied
2. **Auditing, grants, and rewards** — Scans recorded, eligibility established
3. **Returns container** — Farmer returns empty at dealer, both parties rewarded
4. **Customer compliance** — BIR/FPA-ready report generated from scan + return data

---

## 4. Four Trusted Roles

(Confirmed from prototype UI — "One platform. Four trusted roles.")

| Role | Who | Surface Used |
|---|---|---|
| **Verify Products** | Farmer / End User | Mobile App (QR scan) |
| **Sight Checkers** | Field agents, regulators, compliance officers | CRM + Mobile |
| **Brand Solutions** | Manufacturer, brand owner | CRM |
| **GABS Hyper Admin** | GAIA platform admin | CRM (admin tier) |

---

## 5. Four Surfaces

### Decision: v1 MVP ships exactly these four surfaces

| # | Surface | Users | Tech |
|---|---|---|---|
| 1 | **Informational Website** | Farmers, public, brands, regulators | Next.js + Vercel |
| 2 | **CRM** | Dealers, team members, brand admins, GABS admins | Next.js + Supabase |
| 3 | **Farmer Mobile App** | Farmers (QR scanning, rewards) | Expo / React Native |
| 4 | **Backend** | (Shared DB, shared API) | Supabase (Postgres + Auth + RLS) |

### 5.1 Informational Website
- Rebuilt from the Lovable prototype in Next.js (NOT exported from Lovable — rebuild confirmed)
- Target audience: farmers, FPA regulators, brand representatives, the general public
- Content: what GAIA is, how the scan flow works, why it exists, how to get on the platform
- Includes CTA: demo access, dealer onboarding contact, team contact
- Does NOT handle scan logic or data — links to mobile app

### 5.2 CRM
- Internal operational surface for dealers, brand owners, and platform admins
- Features confirmed for v1:
  - Dealer account management (create, invite, suspend)
  - Team member management (role assignment)
  - Product registration with dual ingestion path:
    - FPA spreadsheet import (monthly, for FPA-covered fields)
    - Label OCR ingestion (vision LLM extracts non-FPA fields from uploaded label image)
    - Manual input as fallback for OCR failures
  - Mandatory human verification gate for safety-critical fields (antidote, category) before product goes live
  - QR code batch generation (linked to registered products)
  - QR label export (Zebra-compatible format)
  - Scan history and audit trail per product/container
  - Return processing (dealer scans returned container → triggers pending_return_reward flow)
  - FPA monthly spreadsheet import tool
  - Basic compliance reporting (export for FPA / DENR / EMB)

### 5.3 Farmer Mobile App
- Expo (React Native) — cross-platform iOS + Android
- Primary function: QR code scanning (both purchase confirmation and return scan)
- Secondary function: wallet / rewards points balance and history
- Farmer-facing scan result: product verification status, product details, remaining formulation months, FPA registration status
- Authentication: account-based (no anonymous scans)
- Dealer requires CRM-connected device at point of sale (confirmed as expected)

### 5.4 Backend (Supabase)
- Postgres database (shared by all surfaces)
- Supabase Auth (user accounts for CRM users and farmers)
- Supabase RLS (Row Level Security) enforced at the database layer — primary exploit guard
- Supabase Storage (label assets, compliance docs)
- Scan endpoint is a surface-agnostic REST API — CRM and mobile app both call the same endpoint. No rework needed when mobile ships; it's a new client, not a new backend.
- All surfaces query this single backend

---

## 6. QR Code Architecture

### Decision: UUID-Only Payload (CONFIRMED)
The QR code payload contains only a UUID. It does NOT embed product data.

**Rationale:**
1. **Exploit prevention** — Embedded data can be forged. A UUID is meaningless without server validation.
2. **Revocability** — A UUID can be invalidated server-side instantly. Embedded data cannot.
3. **Audit trail** — Every scan must hit the server, creating a forensic record. Offline-validated embedded data leaves no trace.
4. **State machine enforcement** — The server controls state transitions. Embedded data bypasses this.

### QR URL Format (CONFIRMED)
```
gaia.ph/scan/<uuid>.<hmac>
```

- `uuid` — the container identifier (UUID v4, generated by GAIA)
- `hmac` — HMAC signature computed server-side at QR generation time
- Purpose: prevents UUID enumeration attacks (attacker cannot guess valid UUID + HMAC pairs)
- HMAC verified on every scan before any DB lookup

### What the QR Resolves To
After HMAC verification and DB lookup, the scan result displays product data. See §10 for the full product schema. Additionally surfaced on scan:
- Remaining months of formulation efficacy (calculated: `formulation_expires_at - today`)
- FPA registration status (registered / expiring soon / expired)
- Current container state

**All product fields are also printed as human-readable text on the physical label sticker alongside the QR**, so the product can be visually verified even without scanning.

### QR Generation Workflow (CONFIRMED)
1. Brand/manufacturer registers product in CRM → FPA number submitted + label OCR run
2. FPA number verified against FPA registry
3. Safety-critical fields (antidote, category) verified by operator before product goes live
4. GAIA generates unique UUID per container (batch generation for production runs)
5. HMAC computed for each UUID
6. QR code + human-readable label designed and exported in Zebra-compatible format
7. GAIA ships label print files to manufacturer
8. Manufacturer prints labels using Zebra thermal transfer printer on weatherproof polypropylene stock
9. Labels applied to product containers at manufacturing/packaging stage

---

## 7. Container State Machine

### Primary Container States (CONFIRMED — UPDATED)
```
in_distribution
  → (dealer scans at checkout)
  → pending_purchase [60 min expiry]
      → (farmer scans within 60 min)
      → purchased
          → (dealer scans returned container — verifies clean + punctured)
          → returned [compliance fires immediately]
              → pending_return_reward [60 min expiry]
                  → (farmer scans within 60 min)
                  → rewards_paid

If pending_purchase expires without farmer scan:
  → lazy eval on next scan → treated as in_distribution, pending record discarded

If pending_return_reward expires without farmer scan:
  → compliance record stays (returned state intact)
  → rewards_paid never fires — no retry path
```

### State Table

| State | Meaning | Set By |
|---|---|---|
| `in_distribution` | Container registered, in dealer/distributor hands | CRM — QR generation |
| `pending_purchase` | Dealer initiated checkout scan, awaiting farmer confirmation (60 min) | CRM — dealer scan |
| `purchased` | Farmer confirmed product; purchase data captured | Mobile app — farmer scan |
| `returned` | Empty container physically returned; EPR compliance event fires | CRM — dealer scan at return |
| `rewards_paid` | Both dealer and farmer scanned at return within window | Mobile app — farmer scan |

### Lazy Evaluation (CONFIRMED)
No scheduled cleanup jobs. Expired `pending_purchase` and `pending_return_reward` records are detected on next scan by checking `expires_at < now()`. Zero background infrastructure.

### Cross-Dealer Returns (CONFIRMED)
Any registered dealer can process a return — not restricted to the original dealer. The farmer reward is tied to the container UUID. The processing dealer receives the dealer-side reward. This removes travel friction for farmers and gives every dealer an incentive to accept returns.

---

## 8. Scan Flow — Full Dual-Confirmation Sequence

### 8.1 Purchase Flow (Two-Step Confirmation)

**Step 1 — Dealer Scan at Checkout:**
```
1. Dealer opens CRM on their device
2. Dealer scans QR of product being sold
3. Server: HMAC verification → FAIL = reject + log attempt
4. Server: Dealer auth check → must be verified dealer account
5. Server: FPA registration check:
   - if fpa_registration_expires_at < today AND state = in_distribution → HARD BLOCK
   - Dealer sees: "FPA registration expired — cannot proceed with sale"
6. Server: Formulation expiry check → surface warning if nearing expiry
7. Server: State check → must be in_distribution
8. Server: Creates pending_purchase record (expires in 60 min)
9. Dealer sees: "Scan confirmed — customer must scan within 60 minutes"
```

**Step 2 — Farmer Scan (within 60-minute window):**
```
1. Farmer opens mobile app
2. Farmer scans same QR
3. Server: HMAC verification → FAIL = reject + log attempt
4. Server: Farmer auth check → must be logged in
5. Server: Finds pending_purchase record for this UUID
   - If expired (lazy eval): treat as in_distribution, show "Ask your dealer to initiate checkout first"
   - If valid: proceed
6. Server: FPA check → if expired AND state = purchased → WARNING only (non-blocking)
7. Server: Container state → purchased_by_user_id bound to farmer
8. State transitions: in_distribution → purchased
9. Farmer sees: full product details + remaining formulation months + FPA status
10. Farmer sees: "You've claimed this container — bring it back empty to earn rewards"
```

**Why dealer-first at purchase:** prevents aisle-scanning exploit. Without dealer scan, no `pending_purchase` record exists, so farmer scan cannot advance state. A farmer scanning all containers in an aisle creates no records and no damage.

### 8.2 Return Flow (Two-Step Confirmation)

**Step 1 — Dealer Scan at Return (dealer inspects container):**
```
1. Dealer opens CRM
2. Dealer scans QR of returned container
3. Server: HMAC verification
4. Server: Dealer auth check
5. Server: State check → must be purchased (not already returned)
6. Dealer confirms physical condition: clean + punctured (required in CRM UI)
7. State transitions: purchased → returned [COMPLIANCE FIRES — EPR event recorded]
8. Server: Creates pending_return_reward record (expires in 60 min)
9. Dealer sees: "Return registered. Farmer must scan within 60 minutes for both to receive rewards."
```

**Step 2 — Farmer Scan at Return (within 60-minute window):**
```
1. Farmer opens mobile app (dealer prompts farmer on-site)
2. Farmer scans same QR
3. Server: HMAC verification
4. Server: Farmer auth check
5. Server: Finds pending_return_reward record
   - If expired: compliance stays intact (returned state doesn't revert), no rewards issued
   - If valid: proceed
6. Both rewards fire simultaneously: farmer points + dealer points credited
7. State → rewards_paid
8. Farmer sees: "Rewards credited — check your wallet"
```

**Key design decisions:**
- Dealer scans first at return — they are the authority on physical condition inspection
- Compliance (EPR event) fires on dealer scan alone — never blocked by farmer's connectivity
- Rewards require both scans — dealer incentive to coach farmer through the return scan
- 60-minute window, co-presence assumed
- If farmer never scans: container stays `returned` (compliance intact), no rewards, no retry

### 8.3 Authentication + Expiry — Always Active
Every scan of any type, at any step, always checks:
1. HMAC validity (first, before DB lookup)
2. Actor authentication (farmer or dealer must be logged in)
3. Logged to `scan_attempts` table regardless of outcome

---

## 9. Reward Model

### Decision: Return-Stage Only, Both Parties, Both Scans Required (CONFIRMED — FINAL)

| Event | Farmer Points | Dealer Points |
|---|---|---|
| Purchase (step 1 dealer scan) | None | None |
| Purchase (step 2 farmer scan) | None | None |
| Return (step 1 dealer scan) | None | None — compliance fires, reward pending |
| Return (step 2 farmer scan within window) | ✓ Credited | ✓ Credited |
| Return (farmer scan window expires) | None | None |

**Dealer incentive alignment:** dealer's reward only pays when farmer scans. Dealers actively coach farmers through the return scan because they don't get paid until the farmer does. This drives app engagement at return without requiring a separate mechanism.

### Points Structure
*(Open — see §12 #1)*

### Points Redemption
*(Open — see §12 #8)*

### Pi Network Integration
- Deferred. Will be in the architecture but NOT in the v1 demo.
- Prototype copy confirmed: *"Pi Network & on-chain traceability — in the architecture, not on the demo."*
- The rewards system in v1 will use GAIA's own internal points wallet
- Pi Network bridge is a Phase 2 feature

---

## 10. Product Data Schema + FPA Integration

### 10.1 Two Separate Expiration Types (CONFIRMED — CRITICAL)

These are distinct concepts with different sources, different timelines, and different scan behaviors:

| Expiration | Field | Duration | Source | Effect on product |
|---|---|---|---|---|
| **Formulation expiration** | `formulation_expires_at` | 2 years from manufacture date | Per-container, set at CRM registration | May reduce efficacy — product may still be FPA-registered |
| **FPA registration expiration** | `fpa_registration_expires_at` | 3 years | FPA monthly spreadsheet | No effect on efficacy — product's legal registration status |

**Scan display:** remaining months of formulation efficacy (`formulation_expires_at - today`) always surfaced when farmer scans.

**Scan behavior per expiration type:**

| Scenario | Container State | Behavior |
|---|---|---|
| FPA registration expired + `in_distribution` | Dealer scan | HARD BLOCK — dealer cannot initiate sale |
| FPA registration expired + `purchased` | Farmer scan | WARNING only — non-blocking, farmer already bought |
| Formulation expiring soon | Any scan | Warning with remaining months displayed |
| Formulation past expiry | Any scan | Warning (not a block — product may still be legal to use) |

### 10.2 FPA Spreadsheet — Confirmed Structure

**File:** UPDATED-LIST-OF-REGISTERED-PRODUCTS-As-of-April-1-2026-PMID.xlsx
**Sheet:** LIST
**Total rows:** 31,990 (denormalized — one row per product-crop combination)
**Header row:** Row 6

**Actual columns:**
| Column | DB Field Name | Notes |
|---|---|---|
| NAME OF COMPANY | `company` | |
| ACTIVE INGREDIENT | `active_ingredient` | |
| PRODUCT NAME | `product_name` | |
| CONCENTRATION | `concentration` | e.g., "250 g/L", "50 g/L" |
| FORMULATION TYPE | `formulation_type` | EC, SC, WP, etc. |
| USE/S | `type` | HERBICIDE, INSECTICIDE, FUNGICIDE |
| TOXICITY CATEGORY | `category` | Values: 2, 3, 4 (safety-critical field) |
| REGISTRATION NO. | `fpa_registration_number` | Primary key for FPA record |
| EXPIRY DATE | `fpa_registration_expires_at` | Stored as Excel date serial — must convert to ISO date during import |
| MODE OF ENTRY | `mode_of_entry` | CONTACT, SYSTEMIC, SELECTIVE (PRE-EMERGENCE), POST-EMERGENT, etc. — store verbatim |
| CROPS | `registered_crops` | Normalized to separate table (one-to-many) |
| PESTS / WEEDS / DISEASES | `pests` | |
| RECOMMENDED RATE | `dosage_rate` | |
| MRL (Proposed) | `mrl` | Maximum Residue Limit |
| PHI | `pre_harvest_interval` | |
| RE-ENTRY PERIOD | `re_entry_period` | Should surface on farmer scan alongside PHI |

**Import normalization requirement:** The spreadsheet is denormalized. "1st OPTION 25 EC" appears 4 times for 4 crops. Import job must group by `REGISTRATION NO.` and aggregate CROPS into a `product_crops` child table. One `products` row, many `product_crops` rows.

**EXPIRY DATE conversion:** Excel date serials (e.g., 45090) must be converted to ISO dates during import. Formula: Excel serial → subtract 25569 → multiply by 86400 → Unix timestamp → ISO date.

### 10.3 Fields NOT in FPA Spreadsheet

These fields must be sourced via OCR from product label image (primary) or manual CRM entry (fallback):

| Field | DB Field Name | Safety-Critical? |
|---|---|---|
| Brand name (if different from product name) | `brand_name` | No |
| Distributor | `distributor` | No |
| Formulated by | `formulated_by` | No |
| Imported by | `imported_by` | No |
| Timing of application | `timing_of_application` | No |
| Note to physician / antidote | `note_to_physician` | **YES** |
| IRAC/FRAC/HRAC group (mode of action) | `mode_of_action_group` | No — manual entry or v2 |

**Note on `mode_of_entry` vs `mode_of_action_group`:** These are different fields.
- `mode_of_entry` = the FPA spreadsheet's MODE OF ENTRY column (CONTACT, SYSTEMIC, PRE-EMERGENCE, etc.) — in the spreadsheet, store verbatim
- `mode_of_action_group` = IRAC/FRAC/HRAC biochemical resistance group classification — NOT in the FPA spreadsheet, requires manual CRM entry or v2

**Note on `timing_of_application`:** Partially derivable from `mode_of_entry` (PRE-EMERGENCE / POST-EMERGENT). Can be stored separately via OCR or manual entry. Not blocked on v1.

### 10.4 Product Data Ingestion — Dual Path

**Path 1: FPA Spreadsheet Import (monthly)**
1. GABS admin downloads FPA monthly export
2. Uploads to CRM import tool
3. System converts Excel date serials, deduplicates, groups by REGISTRATION NO.
4. Upserts into `products` table + `product_crops` child table
5. Sets `fpa_last_imported_at` timestamp

**Path 2: Label OCR Ingestion (per product registration)**
1. Operator uploads product label image in CRM
2. Vision LLM (Gemini / Claude) extracts all visible fields
3. Extracted fields presented in human review UI — operator corrects errors
4. **Hard gate for safety-critical fields:** operator must explicitly confirm `note_to_physician` and `category` before product status becomes active
5. Extracted fields merged into the product record (alongside FPA-imported fields)
6. Manual input available as fallback for any field OCR fails to extract

Both paths write to the same `products` table. FPA import covers 16 fields; OCR covers the remainder.

### 10.5 Product Schema Summary

| Field | Source |
|---|---|
| `product_name` | FPA spreadsheet |
| `brand_name` | OCR / manual |
| `company` | FPA spreadsheet |
| `active_ingredient` | FPA spreadsheet |
| `concentration` | FPA spreadsheet |
| `formulation_type` | FPA spreadsheet |
| `type` (herbicide/insecticide/fungicide) | FPA spreadsheet (USE/S column) |
| `category` (2/3/4) | FPA spreadsheet — **safety-critical, mandatory human verification** |
| `fpa_registration_number` | FPA spreadsheet |
| `fpa_registration_expires_at` | FPA spreadsheet (converted from Excel serial) |
| `fpa_last_imported_at` | Set by import job |
| `mode_of_entry` | FPA spreadsheet (verbatim) |
| `dosage_rate` | FPA spreadsheet |
| `mrl` | FPA spreadsheet |
| `pre_harvest_interval` | FPA spreadsheet |
| `re_entry_period` | FPA spreadsheet |
| `distributor` | OCR / manual |
| `formulated_by` | OCR / manual |
| `imported_by` | OCR / manual |
| `timing_of_application` | OCR / manual / derived from mode_of_entry |
| `note_to_physician` | OCR / manual — **safety-critical, mandatory human verification** |
| `mode_of_action_group` | Manual CRM entry (IRAC/FRAC/HRAC) — not in FPA |

**Container-level fields (per-container, not per-product):**
| Field | Source |
|---|---|
| `uuid` | Generated at CRM QR batch creation |
| `hmac` | Computed server-side at generation |
| `manufacture_date` | Entered at CRM registration |
| `formulation_expires_at` | `manufacture_date + 2 years` |
| `batch_number` | Entered at CRM registration |
| `state` | Managed by state machine |
| `purchased_by_user_id` | Set at farmer scan (step 2 of purchase) |
| `dealer_id` (original) | Set at dealer scan (step 1 of purchase) |
| `return_dealer_id` | Set at dealer scan at return (may differ from original dealer) |

**Child table:** `product_crops` (one-to-many: product → crop rows)
| Field | Source |
|---|---|
| `product_id` | FK to products |
| `crop` | FPA spreadsheet (CROPS column) |
| `pests` | FPA spreadsheet (PESTS column) |

---

## 11. Security Architecture

### 11.1 Supabase Row Level Security (RLS)
- **Primary DB-layer guard**
- Every table has RLS policies enforced
- Farmers can only read their own scan history and wallet
- Dealers can only access their own accounts and associated containers
- Brand admins scoped to their own products
- GABS admins have full platform access
- No row is accessible without a valid authenticated session matching RLS policy

### 11.2 HMAC-Signed QR URLs
- Prevents UUID enumeration attacks
- HMAC secret is server-side only, never exposed to client
- Signature verification is the first check on every scan request — before any DB lookup

### 11.3 `scan_attempts` Table
- Every scan attempt — valid or invalid — is logged
- Fields: `uuid`, `actor_id`, `actor_type` (farmer/dealer), `timestamp`, `hmac_valid`, `auth_valid`, `step` (purchase_dealer / purchase_farmer / return_dealer / return_farmer), `outcome`, `ip_address`
- Purpose: forensic trail for abuse detection, compliance reporting, security audit
- Invalid attempts trigger alert after configurable threshold

### 11.4 Authentication
- Supabase Auth for all users (farmers, dealers, admins)
- Mobile app: account required to scan (no anonymous scanning)
- CRM: role-based access control (RBAC) via Supabase Auth + custom role claims

### 11.5 Dealer Scan Authentication Gate
- Dealer scan (step 1 of purchase, step 1 of return) requires a verified dealer account
- Only registered dealers can create `pending_purchase` or initiate the return compliance event
- This is the primary exploit guard against aisle-scanning: without a dealer-initiated scan, no state transition is possible

### 11.6 OCR Safety Gate
- Product records with OCR-extracted safety fields (`note_to_physician`, `category`) remain in `draft` status until operator explicitly confirms those fields
- Draft products do not appear in scan results — containers registered against draft products return "product registration pending"

---

## 12. Open Questions

Questions still requiring Rick's decision before the tech spec can be finalized:

| # | Question | Owner | Blocking |
|---|---|---|---|
| 1 | What is the points structure for rewards? (points per return, conversion rate, cap) | Rick | Reward feature spec |
| 2 | What is the farmer mobile app auth model? (phone number / email / social sign-in) | Rick | Mobile app spec |
| 3 | Is there an offline mode for the farmer mobile app? (low connectivity rural areas) | Rick | Mobile arch decision |
| 4 | What is the dealer region/territory model? (provincial, municipal, dealer-defined) | Rick | CRM data model |
| 5 | Pi Network integration — what is the target phase/timeline? | Rick | Roadmap |
| 6 | What is the points redemption model? (cash out, discount vouchers, in-app store) | Rick | Reward feature spec |
| 7 | Will GAIA issue QR labels retroactively for products already in the market? | Rick | Rollout strategy |
| 8 | Who onboards manufacturers — GABS admin manually, or is there a self-serve flow? | Rick | CRM onboarding spec |
| 9 | Should `re_entry_period` surface on the farmer scan result alongside PHI? | Rick | Mobile UI spec |
| 10 | Is `mode_of_action_group` (IRAC/FRAC/HRAC) required for v1 or deferred to v2? | Rick | Product schema |

---

## 13. Stack Decisions — Final

| Layer | Technology | Decision Basis |
|---|---|---|
| **Website** | Next.js (App Router), rebuilt from Lovable prototype | Vercel deployment, consistency with CRM |
| **CRM** | Next.js (App Router) | Team familiarity, Supabase integration |
| **Mobile App** | Expo / React Native | Cross-platform iOS + Android, one codebase |
| **Database** | Supabase (Postgres) | Auth, RLS, realtime, storage — all in one |
| **Deployment** | Vercel (web/CRM) + Expo EAS (mobile) | Standard Supabase stack deployment |
| **Scan Endpoint** | Surface-agnostic REST API | CRM and mobile both call same endpoint; no rework when mobile ships |
| **QR Generation** | Server-side (CRM API route) | UUID + HMAC must be server-side only |
| **Label Format** | Zebra ZPL or PDF export | Zebra thermal transfer printer compatibility |
| **OCR / Label Extraction** | Vision LLM (Gemini or Claude) via CRM API route | Automates non-FPA field ingestion from product label images |

---

## 14. What Is Explicitly Out of Scope for v1

| Item | Reason |
|---|---|
| Pi Network integration | Architecture-ready but not in demo — Phase 2 |
| On-chain / blockchain traceability | Same — Phase 2 |
| Live FPA API integration | FPA doesn't expose a live API |
| Offline-first mobile scanning | Decision pending (see §12 #3) |
| Manufacturer self-serve onboarding | Decision pending (see §12 #8) |
| SMS-based alerts | Not discussed, not in scope |
| Consumer web scan (non-app) | Mobile app is the scan surface |
| IRAC/FRAC/HRAC group auto-import | Not in FPA spreadsheet — manual CRM entry when needed |
| Rewards retry after window expiry | No retry path by design; expired = no reward |

---

## 15. Prototype Analysis — GABI Steward

Reviewed: `preview--gabi-steward.lovable.app` (screenshot, 2026-04-24)

### Confirmed Design Directions
- **Primary palette:** Deep green (#1A3D2E range) + warm cream/off-white backgrounds
- **Typography:** Bold serif for hero headlines; sans-serif body
- **Hero headline confirmed:** "Authentic inputs. Rewarded farmers. Audit-ready stewardship."
- **Product card shown:** GoldGrow Macroscure 24@35L — confirms scan result card layout
- **4-step lifecycle visual:** Shelf → Scan → Return → Compliance Report
- **4-role grid:** confirmed (see §4)
- **Stats shown (prototype numbers, not production):** 50%+, millions, 1.2M, 184K, 3.4K, 612

### Pi Network Banner (Prototype)
Section header: *"Pi Network & on-chain traceability — in the architecture, not on the demo."*
This section will remain in the informational website to signal technical credibility.

### CTA (Prototype)
- Primary: "Open demo" — links to live demo/pilot
- Secondary: "Talk to the team" — contact/sales

---

## 16. Decisions Log — Chronological

| # | Decision | Made By |
|---|---|---|
| 1 | 4 surfaces: website, CRM, mobile app, Supabase backend | Rick |
| 2 | v1 MVP target: website + CRM + backend first, mobile follows | Rick / Light |
| 3 | QR code: UUID only, no embedded data | Rick (after Lisa's recommendation) |
| 4 | HMAC-signed QR URLs: `gaia.ph/scan/<uuid>.<hmac>` | Rick ✓ |
| 5 | Stack: Next.js + Supabase + Vercel + Expo | Rick |
| 6 | Rewards: return stage only, no purchase-stage rewards | Rick |
| 7 | Both farmer AND dealer earn points at return | Rick |
| 8 | Both rewards require both scans (dealer + farmer) at return | Rick ✓ |
| 9 | FPA integration: monthly spreadsheet import, not live API | Rick |
| 10 | Auth + expiry check on every scan, always | Rick |
| 11 | `scan_attempts` forensic table | Rick ✓ |
| 12 | Supabase RLS as primary DB-layer exploit guard | Rick ✓ |
| 13 | Pi Network deferred to Phase 2 | Rick |
| 14 | CRM includes QR batch generation + Zebra label export | Rick |
| 15 | Zebra thermal transfer printer + polypropylene labels | Rick |
| 16 | GAIA generates labels → ships to manufacturers → manufacturers apply | Rick |
| 17 | Dual-confirmation purchase flow: dealer scans first, farmer scans within 60 min | Rick ✓ (Tony's model) |
| 18 | 60-minute window for pending_purchase | Rick ✓ |
| 19 | Lazy evaluation for expired pending records (no cron cleanup job) | Rick ✓ |
| 20 | Expired pending_purchase → rewards not eligible, container reverts to in_distribution | Rick ✓ |
| 21 | Dual-scan return flow: dealer scans first (compliance fires), farmer scans within 60 min (rewards fire) | Rick ✓ |
| 22 | Compliance event fires on dealer scan alone — never blocked by farmer connectivity | Tony / Rick ✓ |
| 23 | Return: co-presence expected, same 60-minute window | Rick ✓ |
| 24 | Cross-dealer returns allowed — any registered dealer can process, rewards follow container UUID | Rick (via Lisa's recommendation) |
| 25 | Dealer-first at both purchase and return — dealer is the authority on physical condition | Tony / Rick ✓ |
| 26 | Two separate expiration types: formulation (2 years) + FPA registration (3 years) | Rick |
| 27 | Remaining formulation months surfaces on farmer scan | Rick |
| 28 | FPA registration expiry behavior: hard block at dealer scan (in_distribution), warning only at farmer scan (purchased) | Rick (Option 3) |
| 29 | FPA check runs at dealer scan step (purchase step 1) as well as farmer scan step | Lisa / Rick ✓ |
| 30 | OCR via vision LLM for non-FPA product fields (label image upload in CRM) | Rick |
| 31 | Manual input as fallback for OCR | Rick ✓ |
| 32 | Mandatory human verification gate for safety-critical fields: note_to_physician + category | Rick ✓ |
| 33 | Website requires full rebuild from Lovable prototype (not Lovable export) | Rick |
| 34 | Scan endpoint is surface-agnostic REST API — same endpoint for CRM and mobile | Lisa / Rick ✓ |
| 35 | FPA spreadsheet confirmed in hand (as of April 1, 2026) | Rick |
| 36 | mode_of_entry (FPA column) ≠ mode_of_action_group (IRAC/FRAC/HRAC) — separate fields | Okabe / Rick ✓ |
| 37 | Dealer requires CRM-connected device at point of sale | Rick (expected) |
| 38 | product_crops normalized as child table (one product, many crop rows) — import groups by REGISTRATION NO. | Lisa |
| 39 | EXPIRY DATE in FPA spreadsheet stored as Excel date serial — requires conversion during import | Lisa |

---

## 17. Next Steps

1. **PRD** — Write full PRD for GAIA v1 covering all 4 surfaces (discovery complete)
2. **Tech Spec** — Database schema (products + product_crops + containers + scan_attempts + pending tables), API spec, state machine implementation
3. **Resolve Open Questions** — Rick to answer items in §12 before tech spec is finalized (especially points structure, auth model, territory model)
4. **Design Brief** — Handoff to design: confirm palette, typography, component library from Lovable prototype
5. **FPA Import Script** — Write import job with denormalization + Excel date conversion (spreadsheet in hand)
6. **QR Label Design** — Finalize label template (GABI branding + product fields + QR + UUID human-readable)
7. **OCR Integration** — Select vision LLM (Gemini vs Claude) for label field extraction, build review UI

---

*Document compiled by Lisa Hayes — GAIA Discovery Session, 2026-04-24*
*Updated v2 post-session with all final decisions, full scan flow, product schema, and FPA spreadsheet analysis*
*Source: Macross discovery room transcripts + FPA spreadsheet review (UPDATED-LIST-OF-REGISTERED-PRODUCTS-As-of-April-1-2026-PMID.xlsx)*
