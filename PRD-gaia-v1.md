# GAIA / GABI Steward 2.0 — Product Requirements Document

**Author:** Lisa Hayes
**Status:** Draft
**Last Updated:** 2026-04-24
**Reviewers:** Rick (Ruzzel Maestro), Tony Stark (Engineering), Winry (Design)
**Source:** [DISCOVERY-gaia.md](./DISCOVERY-gaia.md) — 53 decisions, session 2026-04-24

---

## 1. Overview

GAIA (GABI Steward 2.0) is a four-surface traceability and EPR compliance platform for the Philippine agrochemical market. It gives farmers a mobile app to scan and verify products at purchase, tracks every container from manufacturer to dealer to farmer to empty return, rewards both farmers and dealers for verified returns, and produces audit-ready compliance reports for FPA and DENR/EMB regulatory requirements. The platform is built on a dual-confirmation scan flow with HMAC-signed QR codes, a lazy-evaluated state machine, and an offline-capable mobile app for low-connectivity rural markets.

---

## 2. Target Users

### Primary Persona: Rico the Rice Farmer
- **What they care about:** Buying the right product at the right price, not getting scammed with counterfeits, earning back something for the empty containers they're stuck with
- **Context:** Standing at a dealer's counter in a rural agri-supply store, product in hand, unsure if it's genuine, no signal or one bar of LTE
- **Trigger:** Dealer asks them to open the GABI app and scan the product
- **Success looks like:** Scan confirms product is genuine, shows what it treats, how many days before harvest they need to stop applying, and tells them there's a reward waiting when they bring back the empty
- **What makes them leave:** App requires internet to function; scan takes more than 3 taps; they don't understand what the result means

### Secondary Persona: Dino the Dealer
- **What they care about:** Moving product, keeping farmers coming back, not accidentally selling expired-registration stock that creates legal liability, getting paid for return compliance
- **Context:** At the POS counter, completing a sale, or accepting empty containers from a farmer at the end of the season
- **Trigger:** New product batch arrives and needs QR registration; farmer is buying or returning
- **Success looks like:** Checking out a product takes one extra scan on their CRM device; return processing is equally simple; reward credits arrive automatically
- **What makes them leave:** CRM is slow or requires multiple screens to complete a transaction; return approval is manual and labor-intensive

### Tertiary Persona: Brand / Manufacturer Representative
- **What they care about:** FPA compliance documentation, EPR container return rates, product authenticity protection, visibility into the supply chain
- **Context:** Monthly compliance reporting cycle, FPA audit preparation, new batch registration
- **Trigger:** New production batch needs QR labels; FPA audit requires container return data
- **Success looks like:** Generates a compliance report in one click; new batch QR labels export to Zebra format without manual data entry
- **What makes them leave:** Product registration takes more than 15 minutes per SKU; reports don't match FPA data

### Anti-Persona: Bulk Agricultural Input Importer (Gray Market)
- **Who this is:** Importers of unregistered or parallel-imported agrochemicals who do not have FPA registration
- **Why excluded:** Designing for unregistered products on the platform would undermine the core compliance value proposition. Every product on GAIA must be FPA-registered. Accommodating unregistered products as a "later" feature would require architecture compromises (optional FPA fields, bypass paths) that create exploit vectors.

---

## 3. Problem Statement

- **The problem:** A Filipino farmer has no reliable way to verify that the pesticide or fertilizer they're holding is genuine, FPA-registered, and hasn't expired — and no economic incentive to return empty containers when they're done.
- **Who experiences it:** ~50%+ of agrochemicals in the Philippine market have traceability gaps; farmers purchasing from rural dealers; brand owners trying to document EPR compliance for DENR/EMB
- **Current workaround:** Farmers rely on dealer trust and printed batch numbers. EPR compliance is documented via manual dealer spreadsheets. Container returns are largely untracked.
- **Cost of inaction:** Farmers apply counterfeit or expired products, reducing yields or causing crop damage. Brand owners cannot prove EPR compliance, risking penalties under RA 11898. Dealers accumulate containers with no structured return pathway.
- **Evidence:** Prototype positioned directly against this gap — "Authentic inputs. Rewarded farmers. Audit-ready stewardship." FPA spreadsheet contains 31,990 registered product-crop combinations, indicating a large registered product base that currently lacks field-level verification.

---

## 4. Proposed Solution

- **Product type:** Four surfaces — web app (informational website), web app (CRM), iOS/Android mobile app (farmer), shared API backend
- **Architecture shape:** Next.js server-rendered web apps; Expo React Native mobile app with offline queue + sync; Supabase Postgres backend with Row Level Security; surface-agnostic REST scan endpoint
- **Core interaction model:** Scan-first on mobile (farmer); form + dashboard on CRM (dealer, brand, admin); scan endpoint is stateless and symmetric (same endpoint for all scan types)
- **Key differentiator:** Dual-confirmation at both purchase and return eliminates aisle-scanning exploits and fraud without adding device pairing or hardware dependencies. Offline-first mobile handles the rural connectivity reality. Compliance fires independently of rewards — EPR audit trail is never contingent on farmer connectivity.

---

## 5. Feature Inventory

### Surface 1: Informational Website

#### Feature: Hero Section
- **Purpose:** Convert visitors into demo requests and dealer sign-ups within 10 seconds
- **Behavior:** Full-viewport hero with headline, subheadline, product scan preview card (static/animated), and two CTAs
- **Copy (confirmed from prototype):** "Authentic inputs. Rewarded farmers. Audit-ready stewardship."
- **States:**
  - Default: Hero rendered with CTAs visible above the fold on all viewport sizes
  - No loading or empty states (static content)
- **Responsive behavior:**
  - Desktop (≥1024px): Two-column layout — copy left, product card visual right
  - Mobile (<1024px): Single-column, copy above card, CTAs full-width

#### Feature: How It Works (4-Stage Lifecycle)
- **Purpose:** Explain the closed loop in under 60 seconds without requiring a demo
- **Behavior:** Four numbered stages with icon and one-line description each. Stages: (1) Verify products, (2) Auditing & rewards, (3) Returns container, (4) Customer compliance
- **States:**
  - Default: All 4 stages visible as a horizontal strip (desktop) or vertical list (mobile)
- **Responsive behavior:**
  - Desktop: Horizontal 4-column grid
  - Mobile: Vertical stacked list

#### Feature: Four Trusted Roles
- **Purpose:** Show each actor (farmer, sight checker, brand, admin) where they fit
- **Behavior:** 4-card grid. Each card: role name, one-line description, icon
- **States:**
  - Default: Static grid, no interaction required
- **Responsive behavior:**
  - Desktop: 4-column grid
  - Mobile: 2×2 grid

#### Feature: Pi Network Section
- **Purpose:** Signal technical credibility to sophisticated stakeholders and regulators without shipping the Pi integration
- **Behavior:** Static section with header "Pi Network & on-chain traceability — in the architecture, not on the demo." followed by 3–5 architecture bullet points
- **States:** Static — no interaction
- **Note:** This section is informational only. Pi Network is not wired up in v1.

#### Feature: Primary CTA — Open Demo
- **Purpose:** Convert interested visitors to demo-qualified leads
- **Behavior:** Button links to demo environment or booking flow. Label: "Open demo"
- **States:**
  - Default: Primary button style
  - Hover: Darkened/elevated state
- **Responsive:** Full-width on mobile

#### Feature: Secondary CTA — Talk to the Team
- **Purpose:** Capture leads who want a guided conversation before demo
- **Behavior:** Button or link opens contact form or links to booking calendar
- **States:** Default + hover
- **Responsive:** Full-width on mobile, below primary CTA

---

### Surface 2: CRM

The CRM serves four role tiers with scoped access. All roles authenticate via Supabase Auth + custom role claims.

| Role | Access Scope |
|---|---|
| Dealer | Own account, own containers, own territory, return approvals, point wallet |
| Brand Admin | Own brand's products, containers, compliance reports |
| Sight Checker | Read-only scan history across assigned area |
| GABS Admin | Full platform access |

#### Feature: Authentication — Login
- **Purpose:** Role-aware login that routes users to the correct CRM view
- **Behavior:** Email + password login. On success, redirects to role-appropriate dashboard. OTP/2FA optional for admin tier.
- **States:**
  - Default: Email + password fields + submit button
  - Loading: Submit disabled, spinner
  - Error: Inline error (invalid credentials, account suspended)
  - Success: Redirect to dashboard
- **Responsive:** Centered card, max-width 420px, full-width on mobile

#### Feature: Product Registration — FPA Import
- **Purpose:** Auto-populate product records from the FPA monthly registry
- **Behavior:** GABS admin uploads FPA spreadsheet (.xlsx). System parses, converts Excel date serials to ISO dates, groups rows by REGISTRATION NO., aggregates crops into child rows, upserts into products + product_crops tables. Sets `fpa_last_imported_at`.
- **States:**
  - Default: Upload zone with "Import FPA Registry" label
  - Uploading: Progress bar with row count
  - Processing: "Parsing N rows…" with spinner
  - Success: "Imported X products, updated Y, skipped Z duplicates"
  - Error: Row-level error list (malformed dates, missing required fields)
- **Edge cases:**
  - File > 50MB: Reject with "File too large — max 50MB"
  - Non-.xlsx format: Reject with format error
  - Duplicate REGISTRATION NO.: Upsert (update existing, don't duplicate)

#### Feature: Product Registration — Label OCR
- **Purpose:** Populate non-FPA fields (distributor, formulated_by, imported_by, timing_of_application, note_to_physician, mode_of_action_group) from a product label image
- **Behavior:** GABS admin or Brand admin uploads product label image (JPEG/PNG/WEBP, max 10MB). Vision LLM extracts all visible fields. Extracted fields pre-fill a review form. Operator corrects any errors. Submit saves to product record.
- **States:**
  - Default: Image upload zone
  - Uploading: Progress indicator
  - Processing: "Extracting fields from label…" spinner
  - Review: Form pre-populated with extracted values, each field editable
  - Safety gate: `note_to_physician` and `category` fields shown with a red "CONFIRM REQUIRED" badge — form cannot submit until operator explicitly checks these two fields
  - Success: "Label fields saved" — product status advances from `draft` to `active` (if both safety fields confirmed)
  - Error: OCR failed — form shown empty with manual entry prompt
- **Manual fallback:** Each field has a "Enter manually" link that shows the field in editable state without OCR
- **Edge cases:**
  - Blurry/unreadable label: OCR returns low-confidence values, flagged with "Low confidence — verify"
  - Label in Filipino or mixed language: LLM should handle; low-confidence fields flagged for manual review

#### Feature: Safety Field Verification Gate
- **Purpose:** Prevent products with unverified antidote or toxicity category from going live
- **Behavior:** Product records stay in `draft` status until `note_to_physician` and `category` are explicitly confirmed by an authorized operator. Draft products do not appear in any scan result — containers linked to draft products return "Product registration pending."
- **States:**
  - Draft: Yellow "Draft — safety fields unconfirmed" banner on product detail page
  - Active: No banner, product live
- **Responsive:** Banner full-width on all sizes

#### Feature: Container / Batch Management
- **Purpose:** Register production batches, generate UUIDs and QR labels
- **Behavior:** Brand admin or GABS admin creates a batch linked to a registered (active) product. Specifies: batch number, manufacture date, container count. System generates one UUID per container, computes HMAC for each, stores `formulation_expires_at` = manufacture_date + 2 years.
- **States:**
  - Default: "New Batch" form
  - Generating: "Generating N QR codes…" spinner
  - Success: Batch record created, "Export Labels" button appears
  - Error: Product not active (draft) — cannot create batch

#### Feature: QR Label Export
- **Purpose:** Produce print-ready Zebra-compatible label files for manufacturer printing
- **Behavior:** Exports a ZIP containing: one label per container (UUID, HMAC URL, human-readable product fields, GABI branding). Format: Zebra ZPL or PDF (operator selects). Label includes: QR code, UUID (human-readable), product name, active ingredient, concentration, manufacturer, batch number, manufacture date, formulation expiry date, FPA registration number, FPA registration expiry, PHI, re-entry period, category, note to physician, dosage rate.
- **States:**
  - Generating: "Preparing N labels…" progress
  - Success: Download link
  - Error: Batch has containers already in `purchased` or `returned` state — warn operator

#### Feature: Dealer Scan — Purchase Initiation (CRM)
- **Purpose:** Step 1 of dual-confirmation purchase flow — dealer initiates at checkout
- **Behavior:** Dealer opens QR scanner in CRM (camera access). Scans product QR. System: (1) HMAC verify, (2) dealer auth check, (3) FPA registration expiry check, (4) state check (must be `in_distribution`). On pass: creates `pending_purchase` record with 60-min expiry. On fail: shows reason.
- **States:**
  - Scanner: Camera viewfinder with scan target
  - Scanning: Processing spinner
  - FPA Hard Block: "FPA registration expired — cannot sell this product. Contact your supplier." (container stays `in_distribution`)
  - Formulation Warning: "Product formulation expires in N months — inform customer" (non-blocking, scan proceeds)
  - Success: "Scan confirmed. Customer has 60 minutes to scan their copy." + countdown timer visible
  - Error (already purchased): "Container already purchased by another customer"
  - Error (HMAC fail): "QR code could not be verified. Do not sell this product."
- **Responsive:** Scanner full-screen on mobile CRM view

#### Feature: Return Processing (CRM)
- **Purpose:** Step 1 of dual-scan return flow — dealer scans empty container, fires EPR compliance event
- **Behavior:** Dealer opens QR scanner. Scans returned container. System: (1) HMAC verify, (2) dealer auth, (3) state check (must be `purchased`). Dealer shown condition checklist: Clean? Punctured? Dealer checks both and submits. On confirm: state → `returned` (compliance fires immediately), `pending_return_reward` record created (60-min expiry).
- **States:**
  - Scanner: Camera viewfinder
  - Condition Check: "Confirm container condition: ☐ Clean ☐ Punctured — both required"
  - Processing: Spinner
  - Success: "Return registered. Compliance recorded. Customer must scan within 60 minutes to receive rewards." + countdown
  - Warning (window expired for farmer): If farmer doesn't scan within 60 min, dealer sees "Reward window closed — compliance still recorded"
  - Error (wrong state): "Container is not in purchased state — cannot process return"
  - Cross-dealer note: Any registered dealer can process; container UUID determines farmer ownership

#### Feature: Compliance Reporting
- **Purpose:** Give brand admins and GABS admins exportable compliance data for FPA / DENR / EMB reporting
- **Behavior:** Date-range filter + product/brand filter. Report shows: containers registered, containers purchased, containers returned, return rate %, by product and by dealer. Export as CSV or PDF.
- **States:**
  - Loading: Skeleton rows
  - Empty: "No data for selected period"
  - Populated: Table + export buttons
- **Performance:** Report generation < 5 seconds for date ranges up to 12 months

#### Feature: Dealer Account Management (GABS Admin)
- **Purpose:** Create, invite, suspend dealer accounts
- **Behavior:** Create dealer account (name, territory description, contact). Sends email invite. Dealer completes signup. GABS admin can suspend (disables CRM access and purchase initiation).
- **States:** List view with status badges (active/suspended/pending invite)

#### Feature: Dealer Territory (Self-Defined)
- **Purpose:** Allow dealers to define their own coverage area without requiring geographic API integration
- **Behavior:** Dealer inputs a free-text territory description (e.g., "Cabanatuan City and surrounding barangays"). Stored as text, displayed on dealer profile. Used for compliance report filtering.
- **States:** Editable text field in dealer profile settings

#### Feature: Points Wallet (Dealer)
- **Purpose:** Show dealer their earned points and available voucher balance
- **Behavior:** Dashboard widget: total points earned, points available for redemption, history of earning events (each return event), history of redemptions
- **States:**
  - Loading: Skeleton
  - Empty: "No points yet — process your first return to earn"
  - Populated: Balance + transaction list

---

### Surface 3: Farmer Mobile App

#### Feature: Onboarding — Phone Number Authentication
- **Purpose:** Get farmers authenticated with minimal friction; phone number is the primary identity
- **Behavior:** Enter phone number → receive OTP via SMS → enter OTP → authenticated. On first login: name entry prompt (optional). OTP expires in 10 minutes. Max 3 OTP attempts before 5-minute lockout.
- **States:**
  - Phone entry: Phone number field + "Send OTP" button
  - OTP sent: 6-digit code entry field + resend timer (60 sec before resend allowed)
  - Verifying: Spinner
  - Success: Redirect to home screen
  - Error (invalid OTP): "Incorrect code — N attempts remaining"
  - Error (expired): "Code expired — request a new one"
  - Lockout: "Too many attempts. Try again in 5 minutes."
- **Offline behavior:** Authentication requires connectivity. Subsequent scans may operate offline after initial auth.

#### Feature: QR Scanner — Purchase Confirmation (Scan Step 2)
- **Purpose:** Farmer confirms product ownership after dealer initiates; records purchase data; hooks farmer into the return reward loop
- **Behavior:** Farmer taps "Scan" on home screen. Camera opens. Farmer scans QR. App sends request to scan endpoint. If online: server processes immediately. If offline: scan queued locally with `local_scan_ts`, `device_id`, `last_online_ts` captured at scan time. Sync on next connectivity.
- **States:**
  - Scanner: Camera viewfinder, no tap required after QR enters frame
  - Online success: Product detail screen with verification badge + reward teaser ("Bring back the empty to earn N points")
  - Offline queued: "Scan saved — will sync when you're back online." + offline badge
  - Sync success (delayed): Notification when queued scan is confirmed server-side
  - No pending_purchase: "No active checkout found. Ask your dealer to scan this product first."
  - FPA warning (purchased state): "This product's FPA registration is expired. It may still be used as purchased, but verify with your dealer for future purchases."
  - Already claimed: "This container was already claimed. Contact your dealer if this is a mistake."
  - HMAC failure: "Product could not be verified. Do not use — contact your dealer."
  - Formulation expiry warning: "This product's effectiveness may be reduced — it expires in N months."
- **Offline sync logic:**
  - `local_scan_ts` = device system clock at scan time
  - `last_online_ts` = last successful API response timestamp (stored locally)
  - On sync: server accepts if `local_scan_ts` within pending window OR if container still unclaimed (state IN (`in_distribution`, `pending_purchase`) AND `purchased_by_user_id IS NULL`)
  - 7-day hard cap: sync rejected if `sync_ts - local_scan_ts > 7 days`
  - Cannot backdate: `local_scan_ts` must be ≥ `last_online_ts`
  - Late syncs (>5 min): flagged `sync_delayed=true` on scan_attempts record

#### Feature: Product Detail Screen
- **Purpose:** Show complete product information after a successful scan
- **Behavior:** Full product data card. Always shown after any successful scan.
- **Content displayed:**
  - Product name + brand name
  - Active ingredient + concentration + formulation type
  - Type (Herbicide / Insecticide / Fungicide) + category badge (2 / 3 / 4)
  - Mode of entry (CONTACT / SYSTEMIC / PRE-EMERGENCE / POST-EMERGENT)
  - FPA Registration number + registration expiry date + status badge (VALID / EXPIRING SOON / EXPIRED)
  - Formulation expiry date + **remaining months of efficacy** (e.g., "14 months remaining")
  - Registered crops (list)
  - Target pests / diseases
  - Dosage rate
  - Pre-harvest interval (PHI)
  - Re-entry period
  - Note to physician / antidote
  - Timing of application
  - Distributor / formulated by / imported by
  - Current container state badge (In Distribution / Purchased / Returned)
- **States:**
  - Loading: Skeleton
  - Populated: Full card
  - FPA expired warning: Orange banner at top
  - Formulation expiry warning: Yellow banner if < 3 months remaining

#### Feature: QR Scanner — Return Scan (Scan Step 2 at Return)
- **Purpose:** Farmer completes the return event after dealer has scanned; triggers reward for both parties
- **Behavior:** Same scanner flow as purchase. Farmer scans empty container QR at dealer's location. If `pending_return_reward` found and valid: rewards fire for both farmer and dealer. If window expired: rewards not paid, container stays `returned`.
- **States:**
  - Success (rewards paid): Confetti animation + "N points added to your wallet! Bring back more empties to earn more."
  - Window expired: "The reward window has passed. Compliance was still recorded — bring more next time."
  - Wrong state: "This container doesn't have a pending return reward."

#### Feature: Offline Queue Manager
- **Purpose:** Ensure scans made without connectivity are not lost
- **Behavior:** Background queue. All scan attempts stored locally in encrypted on-device storage. Automatic sync on connectivity restore (network change event or app foreground). User can see pending syncs in a "Pending Syncs" tray accessible from home screen.
- **States:**
  - No pending syncs: Tray hidden or empty state
  - Pending syncs: Badge count on home screen + list of pending scans with local timestamps
  - Syncing: Progress indicator per item
  - Sync success: Item removed from tray, notification pushed
  - Sync rejected (7-day cap): Item marked "Sync failed — too late. Contact dealer."
  - Sync rejected (already claimed): Item marked "Already claimed by another customer."

#### Feature: Points Wallet
- **Purpose:** Show farmer their earned points and available voucher balance
- **Behavior:** Home screen wallet card: total points, points available for redemption, recent transactions. Redemption: select voucher type (in v1: dealer discount voucher), confirm, voucher code generated and shown.
- **States:**
  - Empty: "No points yet — scan your next product to start earning"
  - Populated: Balance + transaction list
  - Redemption flow: Voucher selection → confirm → code display
- **Configurable:** Points per return event is a system-level configuration parameter (value set by GABS admin, not hardcoded)

---

### Surface 4: Backend API

#### Feature: Scan Endpoint — `POST /api/scan`
- **Purpose:** Single surface-agnostic endpoint handling all scan types; called by both CRM and mobile app
- **Behavior:** Accepts `{ uuid, hmac, actor_type, actor_id, scan_type, local_scan_ts?, device_id?, last_online_ts? }`. Processes in strict order:
  1. HMAC verification (fail → 401 + log attempt)
  2. Actor authentication (fail → 401)
  3. DB lookup by UUID
  4. FPA registration expiry check (behavior varies by actor_type and container state)
  5. Formulation expiry check (non-blocking warning)
  6. State check + pending record lookup
  7. Atomic state transition (UPDATE...RETURNING — if RETURNING empty → 409)
  8. Reward trigger (if both scans complete within window)
  9. Response with product data + scan result
- **All scan attempts logged** to `scan_attempts` regardless of outcome (including HMAC failures)
- **Offline sync:** Accepts `local_scan_ts` from mobile. Validates against 7-day hard cap and backdate prevention. Sets `sync_delayed=true` if `sync_ts - local_scan_ts > 5 minutes`.

#### Feature: FPA Import Endpoint — `POST /api/admin/fpa-import`
- **Purpose:** Process FPA spreadsheet upload
- **Behavior:** Accepts .xlsx file. Converts Excel date serials (subtract 25569, multiply by 86400). Groups rows by REGISTRATION NO. Upserts products table. Upserts product_crops child table. Returns import summary.
- **Access:** GABS admin only

#### Feature: OCR Extraction Endpoint — `POST /api/products/ocr-extract`
- **Purpose:** Extract product label fields via vision LLM
- **Behavior:** Accepts image file. Sends to vision LLM (Gemini or Claude — configurable). Returns structured extraction of all product fields with per-field confidence scores. Low-confidence fields flagged.
- **Access:** GABS admin + Brand admin

#### Feature: QR Generation Endpoint — `POST /api/batches/generate`
- **Purpose:** Generate UUID + HMAC pairs for a new container batch
- **Behavior:** Accepts `{ product_id, batch_number, manufacture_date, container_count }`. Generates UUID v4 per container. Computes HMAC (HMAC-SHA256, server secret). Sets `formulation_expires_at` = manufacture_date + 2 years. Stores in containers table. Returns batch_id.
- **Access:** Brand admin + GABS admin

#### Feature: Label Export — `GET /api/batches/:id/export`
- **Purpose:** Generate Zebra-compatible label files for a batch
- **Behavior:** Generates one label per container. Format: ZPL or PDF (query param). Label content: QR code image, UUID, HMAC URL, all product fields, GABI branding.
- **Access:** Brand admin + GABS admin

---

## 6. User Flows

### Flow 1: Farmer Purchases a Product (Full Online)
- **Entry:** Farmer and dealer are co-present at the dealer's counter
1. Dealer opens CRM on their device, navigates to "New Sale" → "Scan Product"
2. Dealer scans product QR. CRM calls scan endpoint (dealer auth, purchase_initiation scan type).
3. Server verifies HMAC → checks FPA registration → checks state (`in_distribution`) → creates `pending_purchase` (60 min) → returns product details.
4. Dealer sees: product name, FPA status, 60-min countdown. Dealer hands product to farmer.
5. Farmer opens GABI mobile app, taps "Scan"
6. Farmer scans same QR. App calls scan endpoint (farmer auth, purchase_confirmation scan type).
7. Server finds `pending_purchase` → checks it's within 60-min window AND container state unclaimed → atomic UPDATE sets state → `purchased`, `purchased_by_user_id` = farmer.
8. Farmer sees: Product Detail Screen with all fields, formulation months remaining, FPA status, "Bring back the empty container to earn N points."
- **Decision points:**
  - Step 2, FPA expired: Hard block. Dealer sees "Cannot sell — FPA registration expired." Flow ends.
  - Step 6, pending expired: "No active checkout — ask dealer to re-scan." Farmer goes back to dealer.
  - Step 6, HMAC fail: "Product could not be verified." Flow ends, attempt logged.
- **Terminal states:**
  - Success: Container → `purchased`, farmer linked, purchase data captured
  - Blocked: Container stays `in_distribution`, scan logged as failed

### Flow 2: Farmer Purchases a Product (Offline — Farmer Has No Signal)
- **Entry:** Same co-present situation; farmer's phone has no connectivity
1–4. Dealer scan happens identically (dealer has CRM connectivity).
5. Farmer opens app, taps "Scan"
6. App captures scan with `local_scan_ts` = device time, stores in offline queue
7. Farmer sees: "Scan saved — will confirm when online. Product is pending."
8. App shows cached product data if available, or "Full details available when synced"
9. When connectivity restored: app syncs offline queue → server processes with `local_scan_ts`
10. If container still unclaimed: state → `purchased`, notification sent to farmer
11. If already claimed (race): notification "This container was claimed by another customer"
- **Terminal states:**
  - Sync success: Identical outcome to Flow 1
  - Sync rejected (7-day cap): Farmer notified "Scan too old to process — contact dealer"
  - Sync rejected (already claimed): Farmer notified with winning claim timestamp

### Flow 3: Farmer Returns Empty Container
- **Entry:** Farmer brings empty container to any registered dealer (may differ from original dealer)
1. Dealer opens CRM, navigates to "Process Return" → "Scan Container"
2. Dealer scans QR. Server verifies HMAC → checks state (`purchased`) → proceeds.
3. CRM shows: product name, original purchase date, farmer name. Dealer sees condition checklist: "Clean? Punctured?"
4. Dealer checks both boxes, submits.
5. Server: state → `returned` (compliance event fires, EPR record created). `pending_return_reward` created (60 min).
6. Dealer sees: "Return registered. Compliance recorded. Customer must scan within 60 minutes."
7. Dealer prompts farmer to open app and scan.
8. Farmer opens app, scans QR.
9. Server finds `pending_return_reward`, validates window, fires rewards for both parties atomically.
10. Farmer sees: reward animation + "N points added." Dealer's wallet updated.
- **Decision points:**
  - Step 4, container already `returned`: "Already processed. Cannot return again."
  - Step 9, window expired: Rewards not paid. Container stays `returned`. Compliance intact.
  - Step 9, farmer offline: Offline queue + local_ts sync applies same as Flow 2
- **Terminal states:**
  - Both scanned within window: Compliance + rewards
  - Dealer only: Compliance only, no rewards

### Flow 4: GABS Admin Registers a New Product
1. GABS admin logs into CRM, navigates to Products → "Register New Product"
2. Admin selects: "Import from FPA Registry" OR "Register manually with OCR"
3. **FPA path:** Enters FPA registration number → system looks up in imported FPA data → pre-fills 16 fields
4. **OCR path:** Uploads product label image → LLM extracts fields → review form shown
5. Admin reviews all fields, corrects any errors
6. Admin reaches `note_to_physician` and `category` — must explicitly check "I confirm this is correct" for each
7. Admin submits → product status = `active`
8. Admin navigates to Batches → "New Batch" → links to this product → enters batch number, manufacture date, container count
9. System generates UUIDs and HMACs → batch record created
10. Admin downloads label export (ZPL or PDF) → sends to manufacturer
- **Terminal state:** Active product with batch, QR labels ready for printing and shipping

### Flow 5: Monthly FPA Import
1. GABS admin receives FPA monthly spreadsheet
2. Navigates to CRM → Admin → "FPA Registry Import"
3. Uploads .xlsx file
4. System processes: converts Excel date serials, groups by REGISTRATION NO., upserts records
5. Summary shown: "Imported: 8,450 products. Updated: 1,200. Expired registrations flagged: 340."
6. Products with now-expired registrations automatically get `fpa_registration_expires_at < today` — next dealer scan on these will trigger hard block

---

## 7. Tech Stack

| Category | Choice | Version | Rationale |
|---|---|---|---|
| Language | TypeScript | 5.x | Type safety across all surfaces |
| Website Framework | Next.js (App Router) | 14.x | SSR for SEO, consistency with CRM |
| CRM Framework | Next.js (App Router) | 14.x | Shared infrastructure, Supabase SSR client |
| Mobile Framework | Expo / React Native | SDK 51+ | Cross-platform iOS + Android, single codebase |
| Database | Supabase (Postgres) | — | Auth, RLS, realtime, storage in one service |
| Authentication | Supabase Auth | — | Phone OTP (farmers), email/password (CRM), custom role claims |
| Deployment — Web | Vercel | — | Next.js native platform, preview environments |
| Deployment — Mobile | Expo EAS | — | OTA updates, App Store + Play Store submission |
| Vision LLM (OCR) | Gemini Vision or Claude (configurable) | Latest | Label field extraction; configurable to allow provider switching |
| QR Generation | `qrcode` (Node.js) | — | Server-side generation, no client dependency |
| HMAC | Node.js `crypto` (HMAC-SHA256) | Built-in | No additional dependency |
| Label Export | Zebra ZPL template or `pdfkit` | — | ZPL for Zebra printers, PDF fallback |

**Rejected alternatives:**
- Embedded QR data: Rejected — cannot be revoked, bypasses state machine, enables forgery
- Client-side QR generation: Rejected — HMAC secret must never leave the server
- Live FPA API: Rejected — FPA does not expose a real-time API
- Cron-based pending cleanup: Rejected — lazy evaluation on scan is simpler and sufficient
- Bluetooth/NFC co-presence: Rejected — hardware dependency incompatible with rural device landscape

---

## 8. Data Structures

### Product
```typescript
interface Product {
  id: string;                          // UUID
  status: 'draft' | 'active';
  // FPA-sourced fields
  fpa_registration_number: string;
  fpa_registration_expires_at: string; // ISO date
  fpa_last_imported_at: string;        // ISO datetime
  product_name: string;
  company: string;
  active_ingredient: string;
  concentration: string;
  formulation_type: string;            // EC, SC, WP, etc.
  type: 'HERBICIDE' | 'INSECTICIDE' | 'FUNGICIDE';
  category: 2 | 3 | 4;                // Toxicity category — safety-critical
  mode_of_entry: string;               // CONTACT, SYSTEMIC, PRE-EMERGENCE, etc. (verbatim)
  dosage_rate: string;
  mrl?: string;                        // Maximum Residue Limit
  pre_harvest_interval: string;
  re_entry_period: string;
  // OCR / manual fields
  brand_name?: string;
  distributor?: string;
  formulated_by?: string;
  imported_by?: string;
  timing_of_application?: string;
  note_to_physician: string;           // Antidote — safety-critical
  mode_of_action_group?: string;       // IRAC/FRAC/HRAC group — manual CRM entry
  // Safety gate tracking
  note_to_physician_confirmed: boolean;
  category_confirmed: boolean;
  // Timestamps
  created_at: string;
  updated_at: string;
}
```

### ProductCrop (child table)
```typescript
interface ProductCrop {
  id: string;
  product_id: string;     // FK → products.id
  crop: string;
  pests: string;
}
```

### Container
```typescript
type ContainerState = 'in_distribution' | 'pending_purchase' | 'purchased' | 'returned' | 'rewards_paid';

interface Container {
  id: string;                             // UUID — this is the QR payload
  hmac: string;                           // HMAC-SHA256 of id
  product_id: string;                     // FK → products.id
  batch_id: string;                       // FK → batches.id
  batch_number: string;
  manufacture_date: string;               // ISO date
  formulation_expires_at: string;         // manufacture_date + 2 years
  state: ContainerState;
  purchased_by_user_id?: string;          // FK → users.id — set at purchase confirmation
  purchased_at?: string;                  // ISO datetime (local_scan_ts from farmer)
  original_dealer_id?: string;            // FK → dealers.id — set at purchase initiation
  return_dealer_id?: string;              // FK → dealers.id — may differ from original
  returned_at?: string;                   // ISO datetime
  rewards_paid_at?: string;              // ISO datetime
  created_at: string;
  updated_at: string;
}
```

### PendingPurchase
```typescript
interface PendingPurchase {
  id: string;
  container_id: string;         // FK → containers.id
  dealer_id: string;            // FK → users.id
  created_at: string;
  expires_at: string;           // created_at + 60 minutes
  // Audit fields — record kept permanently after expiry
  fulfilled_at?: string;        // Set when farmer scan completes
  expired: boolean;             // Lazy-evaluated on read
}
```

### PendingReturnReward
```typescript
interface PendingReturnReward {
  id: string;
  container_id: string;         // FK → containers.id
  return_dealer_id: string;     // FK → users.id
  farmer_id: string;            // FK → users.id
  created_at: string;
  expires_at: string;           // created_at + 60 minutes
  fulfilled_at?: string;
  expired: boolean;
}
```

### ScanAttempt
```typescript
type ActorType = 'farmer' | 'dealer' | 'admin';
type ScanType = 'purchase_initiation' | 'purchase_confirmation' | 'return_initiation' | 'return_confirmation';
type ScanOutcome = 'success' | 'hmac_fail' | 'auth_fail' | 'state_fail' | 'fpa_blocked' | 'already_claimed' | 'sync_rejected_too_old' | 'sync_rejected_already_claimed';

interface ScanAttempt {
  id: string;
  container_id?: string;         // null if HMAC fails (UUID unknown)
  actor_id: string;
  actor_type: ActorType;
  scan_type: ScanType;
  outcome: ScanOutcome;
  hmac_valid: boolean;
  auth_valid: boolean;
  fpa_status?: 'valid' | 'expired' | 'expiring_soon';
  formulation_months_remaining?: number;
  // Offline sync fields
  local_scan_ts?: string;        // Device-claimed timestamp (ISO)
  sync_ts: string;               // Server receive time (ISO)
  device_id?: string;
  last_online_ts?: string;       // Device's last successful sync timestamp
  sync_delayed: boolean;         // True if sync_ts - local_scan_ts > 5 minutes
  // Metadata
  ip_address: string;
  created_at: string;
}
```

### Reward Transaction
```typescript
interface RewardTransaction {
  id: string;
  container_id: string;
  farmer_id: string;
  dealer_id: string;
  points_farmer: number;    // Configurable system parameter
  points_dealer: number;    // Configurable system parameter
  event_type: 'return';
  created_at: string;
}
```

### Points Wallet
```typescript
interface PointsWallet {
  user_id: string;
  total_points_earned: number;
  points_available: number;
  updated_at: string;
}
```

### Voucher
```typescript
interface Voucher {
  id: string;
  user_id: string;
  points_cost: number;
  value: string;        // e.g., "₱50 off next purchase"
  code: string;
  redeemed: boolean;
  redeemed_at?: string;
  expires_at: string;
  created_at: string;
}
```

### Scan Endpoint API Contract

**POST /api/scan**
```typescript
interface ScanRequest {
  uuid: string;
  hmac: string;
  actor_type: ActorType;
  scan_type: ScanType;
  local_scan_ts?: string;    // ISO datetime, mobile only
  device_id?: string;
  last_online_ts?: string;
}

interface ScanResponse {
  success: boolean;
  outcome: ScanOutcome;
  product?: Product;
  container?: Pick<Container, 'state' | 'formulation_expires_at' | 'purchased_at'>;
  formulation_months_remaining?: number;
  fpa_status: 'valid' | 'expired' | 'expiring_soon';
  fpa_expires_at?: string;
  pending_window_expires_at?: string;   // For purchase initiation
  reward_points?: number;               // For return confirmation (both parties)
  error_code?: string;
  error_message?: string;
}
```

---

## 9. Design Requirements

### Color Palette
| Name | Hex | Usage |
|---|---|---|
| Primary (Deep Green) | #1A3D2E | Primary buttons, headers, active nav states |
| Primary Hover | #143024 | Button hover, link hover |
| Accent (Warm Amber) | #C8963E | Reward states, earnings highlights, CTAs on dark bg |
| Background (Cream) | #F5F0E8 | Page background, card backgrounds |
| Surface (White) | #FFFFFF | Card foreground, modal backgrounds |
| Success Green | #2E7D32 | Valid FPA status, scan success |
| Warning Amber | #F57C00 | Expiring soon, formulation warning |
| Error Red | #C62828 | FPA hard block, HMAC failure, scan rejected |
| Text Primary | #1C1C1C | Body text, labels |
| Text Secondary | #6B6B6B | Metadata, timestamps, helper text |
| Border | #E0D8CC | Card borders, dividers |

### Typography
| Element | Font | Weight | Size |
|---|---|---|---|
| Hero Headline | Playfair Display (or equivalent serif) | 700 | 48px desktop / 32px mobile |
| Section Headline | Playfair Display | 600 | 32px desktop / 24px mobile |
| Card Title | Inter | 600 | 18px |
| Body | Inter | 400 | 16px |
| Caption | Inter | 400 | 13px |
| Button | Inter | 600 | 15px |
| Monospace (UUIDs, codes) | JetBrains Mono | 400 | 13px |

### Spacing Scale
Base unit: 4px. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96px.

### Breakpoints
| Name | Min Width | Layout |
|---|---|---|
| Mobile | 0px | Single column, full-width components |
| Tablet | 768px | 2-column grids |
| Desktop | 1024px | Standard multi-column layouts |
| Wide | 1280px | Max content width 1200px, centered |

### Component Specifications

**Primary Button:**
- Background: #1A3D2E, Text: #FFFFFF, Font: Inter 600 15px
- Padding: 12px 24px, Border radius: 6px
- Hover: #143024
- Disabled: opacity 40%, no pointer events
- Loading: Spinner replaces label, width preserved

**Status Badges:**
- FPA Valid: Background #E8F5E9, Text #2E7D32, Border #2E7D32
- FPA Expired: Background #FFEBEE, Text #C62828, Border #C62828
- FPA Expiring: Background #FFF3E0, Text #F57C00, Border #F57C00
- Container state badges: Same pattern with corresponding semantic colors

**Scan Result Card (Mobile):**
- White card, 16px padding, 8px border radius, 1px border #E0D8CC
- Product name: Inter 600 18px
- Status badge top-right
- Fields in labeled rows: label 13px #6B6B6B, value 15px #1C1C1C
- Reward teaser: Full-width amber bar at bottom

### Accessibility
- WCAG 2.1 AA minimum
- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text
- Touch targets: minimum 44×44px on mobile
- Keyboard navigation: full tab order on CRM; focus rings visible
- Screen reader: all images have alt text, all icons have aria-labels
- `prefers-reduced-motion`: disable animations and transitions

---

## 10. Performance Requirements

| Metric | Target | Context |
|---|---|---|
| Scan endpoint P95 response time | < 500ms | Online scan |
| Scan endpoint P95 (offline sync) | < 1000ms | Sync with queue processing |
| Product detail screen load | < 2s on LTE | Mobile |
| CRM dashboard load | LCP < 2.5s | Desktop |
| FPA import (31,990 rows) | < 60s | Batch operation, background acceptable |
| QR batch generation (1,000 containers) | < 10s | Batch operation |
| Label export (1,000 containers) | < 30s | Batch operation |
| Offline queue sync on reconnect | < 5s for ≤ 20 queued scans | Mobile background sync |
| CLS | < 0.1 | All web surfaces |
| Lighthouse Performance Score | ≥ 85 | Website + CRM |

---

## 11. Security Requirements

| Requirement | Specification |
|---|---|
| HMAC signing | HMAC-SHA256; secret in server env only; verified before any DB lookup |
| UUID enumeration prevention | HMAC signature required on every request; unsigned UUID requests return 401 |
| Supabase RLS | Every table has RLS policies; no row accessible without matching session |
| Scan attempt logging | 100% of scan attempts logged (valid and invalid) |
| Invalid scan alerting | Configurable threshold (default: 10 invalid HMAC attempts per UUID per hour → alert) |
| Offline trust | local_scan_ts ≥ last_online_ts enforced; 7-day hard cap on sync delay |
| OCR safety gate | Products with unverified note_to_physician or category stay in `draft` state — not visible on scan |
| Race condition | Atomic UPDATE...RETURNING on containers table; concurrent claims return 409 |
| Phone OTP | 10-minute expiry, max 3 attempts, 5-minute lockout after exhaustion |
| RBAC | CRM role claims verified server-side on every request; client role claims not trusted |

---

## 12. Out of Scope for v1

| Item | Reason |
|---|---|
| Pi Network / blockchain integration | Architecture-ready; not in demo — Phase 3+ |
| Device time attestation (TPM / Play Integrity) | Overkill for MVP; deferred until fraud evidence warrants |
| Bluetooth/NFC co-presence proof | Hardware dependency incompatible with rural device landscape |
| Live FPA API integration | FPA does not expose a live API |
| Manufacturer self-serve onboarding | GAIA staff handles onboarding |
| QR retrofitting for existing shelf stock | New production batches only |
| SMS-based alerts | Not in scope |
| Consumer web scan (non-app) | Mobile app is the scan surface |
| AI-app store redemption | v2 roadmap — v1 is discount vouchers |
| Cryptographic pending-nonce handshake | Deferred until fraud shows up at scale |

---

## 13. Success Metrics

| Metric | Target | When Measurable |
|---|---|---|
| Container scan rate (purchases with farmer confirmation) | ≥ 70% of dealer-initiated purchases | 60 days post-launch |
| Return rate (returned / purchased) | ≥ 30% within 90 days of purchase | 90 days post-launch |
| Offline sync success rate | ≥ 98% of queued scans sync successfully | At launch |
| Scan endpoint error rate | < 1% (excluding intentional HMAC failures) | At launch |
| FPA hard block events | Logged and reportable within 24 hours of import | Monthly |
| Product OCR review time | Operator confirms fields in < 5 minutes per product | At launch |
| Compliance report generation | < 5 seconds for 12-month range | At launch |

---

## 14. Open Items (Not Blocking PRD)

| # | Item | Owner |
|---|---|---|
| 1 | Exact points per return (farmer) — currently configurable parameter | Rick to set before launch |
| 2 | Exact points per return (dealer) — same | Rick to set before launch |
| 3 | Voucher value and denomination options | Rick to define |
| 4 | Specific vision LLM provider for OCR (Gemini vs Claude) | Engineering decision |

---

*Product Requirements Document — GAIA / GABI Steward 2.0*
*Author: Lisa Hayes · 2026-04-24*
*Source: DISCOVERY-gaia.md (53 decisions, session 2026-04-24)*
