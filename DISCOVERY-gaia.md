# GAIA / GABI 2.0 — Discovery Document
**Session:** Discovery Room v1 · 2026-04-24
**Scribe:** Lisa Hayes
**Status:** COMPLETE — all decisions finalized unless noted as open

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

### 2.4 Hero Copy (Prototype-Confirmed)
> "Authentic inputs. Rewarded farmers. Audit-ready stewardship."

This headline confirms all three problem vectors: authenticity verification, farmer reward, and regulatory audit trail.

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
- Public-facing marketing and information site
- Target audience: farmers, FPA regulators, brand representatives, the general public
- Content: what GAIA is, how the scan flow works, why it exists, how to get on the platform
- Includes CTA: demo access, dealer onboarding contact, team contact
- Does NOT handle scan logic or data — links to mobile app

### 5.2 CRM
- Internal operational surface for dealers, brand owners, and platform admins
- Features confirmed for v1:
  - Dealer account management (create, invite, suspend)
  - Team member management (role assignment)
  - Product registration + FPA registry verification
  - QR code batch generation (linked to registered products)
  - QR label export (Zebra-compatible format)
  - Scan history and audit trail per product/container
  - Return approvals (dealer confirms return → triggers reward)
  - FPA monthly spreadsheet import tool
  - Basic compliance reporting (export for FPA / DENR / EMB)

### 5.3 Farmer Mobile App
- Expo (React Native) — cross-platform iOS + Android
- Primary function: QR code scanning
- Secondary function: wallet / rewards points balance and history
- Farmer-facing scan result: product verification status, product details, current state
- If return eligible: prompts farmer to bring container to registered dealer
- Authentication: account-based (no anonymous scans)

### 5.4 Backend (Supabase)
- Postgres database (shared by all surfaces)
- Supabase Auth (user accounts for CRM users and farmers)
- Supabase RLS (Row Level Security) enforced at the database layer — primary exploit guard
- Supabase Storage (if label assets or compliance docs are stored)
- Supabase Edge Functions or Next.js API routes for scan logic
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
After HMAC verification and DB lookup, the scan result displays all 9 product fields:

| Field | Source |
|---|---|
| Product name | DB — products table |
| Product code / SKU | DB — products table |
| Manufacturer / brand | DB — manufacturers table |
| Batch / lot number | DB — containers table |
| Manufacturing date | DB — containers table |
| Expiry date | DB — containers table |
| FPA registration number | DB — fpa_registrations table |
| Current distribution status | DB — containers.state |
| Registered dealer / distributor | DB — containers → dealer FK |

**All 9 fields are also printed as human-readable text on the physical label sticker alongside the QR**, so the product can be visually verified even without scanning.

### QR Generation Workflow (CONFIRMED)
1. Brand/manufacturer registers product in CRM + submits FPA registration number
2. FPA number verified against FPA registry (see §9)
3. GAIA generates unique UUID per container (batch generation for production runs)
4. HMAC computed for each UUID
5. QR code + human-readable label designed and exported in Zebra-compatible format
6. GAIA ships label print files to manufacturer
7. Manufacturer prints labels using Zebra thermal transfer printer
8. Labels applied to product containers at manufacturing/packaging stage

### QR Printing Hardware (CONFIRMED)
- **Printer:** Zebra thermal transfer printer
- **Label stock:** Weatherproof polypropylene — survives field conditions, chemical exposure, moisture
- **Label contains:** QR code + UUID (human-readable) + 9 product data fields in plain text + GABI branding

---

## 7. Container State Machine

### States (CONFIRMED)
```
in_distribution → purchased → returned
```

| State | Meaning | Set By |
|---|---|---|
| `in_distribution` | Container registered, in dealer/distributor hands | CRM — QR generation |
| `purchased` | Farmer confirmed product, scan recorded | Mobile app scan |
| `returned` | Empty container returned at dealer, dealer approved | CRM — dealer action |

### Scan Events
- **Scan 1 (Purchase):** Farmer scans at point of purchase or first use. State: `in_distribution → purchased`. No reward issued.
- **Scan 2 (Return):** Farmer brings empty to dealer. Dealer confirms return in CRM. State: `purchased → returned`. **Reward issued to both farmer AND dealer.**

### Invalid Scan Handling
Any scan that fails authentication or HMAC verification:
- Logged to `scan_attempts` table (forensic trail)
- No state change
- No reward
- Farmer sees: "Product could not be verified. Please contact your dealer."

---

## 8. Scan Flow — Full Sequence

Every scan, every time, in this exact order:

```
1. Farmer opens mobile app
2. Farmer scans QR
3. App sends UUID + HMAC to server
4. Server: HMAC verification → FAIL = reject + log attempt
5. Server: Auth check → is farmer logged in? → FAIL = prompt login
6. Server: DB lookup by UUID
7. Server: Expiry check → is product expired? → if YES, display warning + reject
8. Server: FPA check → is product currently FPA-registered? → if NO, display warning
9. Server: State check → what is container's current state?
10. Display product details (all 9 fields)
11. If state = purchased AND farmer initiating return: prompt dealer confirmation flow
12. Dealer confirms return in CRM → state = returned → rewards issued
```

**Authentication and expiry checks are ALWAYS active on every scan without exception.**

---

## 9. Reward Model

### Decision: Return-Stage Only (CONFIRMED)
Rewards are issued ONLY at the return stage. No rewards at purchase/scan-1.

**Rationale:** Rewards at purchase-stage create a replay attack vector (scan and claim without buying). Return-stage rewards require physical presence at dealer, making gaming the system logistically expensive.

### Who Gets Rewarded (CONFIRMED)
**Both farmer AND dealer earn points when a return is completed.**

- Farmer: brings empty container to dealer
- Dealer: confirms return in CRM
- Both parties earn points simultaneously when dealer approves the return

### Points Structure
*(Open — see §12)*

### Pi Network Integration
- Deferred. Will be in the architecture but NOT in the v1 demo.
- Prototype copy confirmed: *"Pi Network & on-chain traceability — in the architecture, not on the demo."*
- The rewards system in v1 will use GAIA's own internal points wallet
- Pi Network bridge is a Phase 2 feature

---

## 10. FPA (Fertilizer and Pesticide Authority) Integration

### Decision: Monthly Spreadsheet Import (CONFIRMED)
GAIA does not have a live API into FPA systems. FPA publishes a monthly registry of registered products.

| Field | Value |
|---|---|
| **Source** | FPA monthly export (spreadsheet) |
| **Import method** | CRM admin tool — upload + process |
| **Key fields stored** | FPA registration number, product name, manufacturer, registration status |
| **Staleness tracking** | `last_verified_at` timestamp on every FPA record |
| **Scan behavior** | If `last_verified_at` > 30 days, flag as "FPA verification pending" |

### Import Workflow
1. FPA publishes monthly registry (PDF/Excel)
2. GABS admin uploads to CRM import tool
3. System parses, deduplicates, and upserts into `fpa_registrations` table
4. Products with `last_verified_at` > 30 days ago show "unverified" flag on scan

---

## 11. Security Architecture

### 11.1 Supabase Row Level Security (RLS)
- **Primary DB-layer guard**
- Every table has RLS policies enforced
- Farmers can only read their own scan history
- Dealers can only read their own region's data
- Admins have scoped access per tier
- No row is accessible without a valid authenticated session matching RLS policy

### 11.2 HMAC-Signed QR URLs
- Prevents UUID enumeration attacks
- HMAC secret is server-side only, never exposed to client
- Signature verification is the first check on every scan request

### 11.3 `scan_attempts` Table
- Every scan attempt — valid or invalid — is logged
- Fields: `uuid`, `farmer_id`, `timestamp`, `hmac_valid`, `auth_valid`, `outcome`, `ip_address`
- Purpose: forensic trail for abuse detection, compliance reporting, security audit
- Invalid attempts trigger alert after threshold (configurable)

### 11.4 Authentication
- Supabase Auth for all users (farmers, dealers, admins)
- Mobile app: account required to scan (no anonymous scanning)
- CRM: role-based access control (RBAC) via Supabase Auth + custom role claims

---

## 12. Open Questions

These items were identified during discovery but require Rick's input before they can be specified.

| # | Question | Owner | Blocking |
|---|---|---|---|
| 1 | What is the points structure for rewards? (how many points per return? is there a conversion rate?) | Rick | Reward feature spec |
| 2 | How does dealer approval work in the mobile UX? Does the farmer get a confirmation screen? Does dealer scan something? | Rick | Mobile app spec |
| 3 | What is the farmer's mobile app auth model? (phone number / email / social?) | Rick | Mobile app spec |
| 4 | Is there an offline mode for the farmer mobile app? (low connectivity areas) | Rick | Mobile arch decision |
| 5 | What happens on scan if product is NOT FPA-registered? (block entirely, warn-and-allow, or warn-only?) | Rick | Scan flow spec |
| 6 | What is the dealer region/territory model? (provincial, municipal, dealer-defined?) | Rick | CRM data model |
| 7 | Pi Network integration — what is the target phase/timeline? | Rick | Roadmap |
| 8 | What is the points redemption model? (cash out, discount vouchers, in-app store?) | Rick | Reward feature spec |
| 9 | Will GAIA issue QR labels retroactively for products already in the market? | Rick | Rollout strategy |
| 10 | Who onboards manufacturers — GABS admin manually, or self-serve? | Rick | CRM onboarding spec |

---

## 13. Stack Decisions — Final

| Layer | Technology | Decision Basis |
|---|---|---|
| **Website** | Next.js (App Router) | Consistency with CRM, Vercel deployment |
| **CRM** | Next.js (App Router) | Team familiarity, Supabase integration |
| **Mobile App** | Expo / React Native | Cross-platform iOS + Android, one codebase |
| **Database** | Supabase (Postgres) | Auth, RLS, realtime, storage — all in one |
| **Deployment** | Vercel (web/CRM) + Expo EAS (mobile) | Standard Supabase stack deployment |
| **QR Generation** | Server-side (CRM API route) | UUID + HMAC must be server-side only |
| **Label Format** | Zebra ZPL or PDF export | Zebra thermal transfer printer compatibility |

---

## 14. What Is Explicitly Out of Scope for v1

| Item | Reason |
|---|---|
| Pi Network integration | Architecture-ready but not in demo |
| On-chain / blockchain traceability | Same — architecture decision, Phase 2 feature |
| Live FPA API integration | FPA doesn't expose a live API |
| Offline-first mobile scanning | Decision pending (see Open Questions) |
| Manufacturer self-serve onboarding | Decision pending |
| SMS-based alerts | Not discussed, not in scope |
| Consumer web scan (non-app) | Not discussed; mobile app is the scan surface |

---

## 15. Prototype Analysis — GABI Steward

Reviewed: `preview--gabi-steward.lovable.app` (screenshot, 2026-04-24)

### Confirmed Design Directions
- **Primary palette:** Deep green (#1A3D2E range) + warm cream/off-white backgrounds
- **Typography:** Bold serif for hero headlines; sans-serif body
- **Hero headline confirmed:** "Authentic inputs. Rewarded farmers. Audit-ready stewardship."
- **Product card shown in prototype:** GoldGrow Macroscure 24@35L — used as a representative sample product, confirms what a scan result card looks like
- **4-step lifecycle visual:** Shelf → Scan → Return → Compliance Report
- **4-role grid:** confirmed (see §4)
- **Stats shown (prototype numbers, not production):** 50%+, millions, 1.2M, 184K, 3.4K, 612

### Pi Network Banner (Prototype)
Section header: *"Pi Network & on-chain traceability — in the architecture, not on the demo."*
Followed by a list of 4–5 technical architecture bullets (RLS, on-chain verification, etc.)
This section will remain in the informational website to signal technical credibility without shipping the feature.

### CTA (Prototype)
- Primary: "Open demo" — links to live demo/pilot
- Secondary: "Talk to the team" — contact/sales

---

## 16. Decisions Log — Chronological

| # | Decision | Made By |
|---|---|---|
| 1 | 4 surfaces: website, CRM, mobile app, Supabase backend | Rick |
| 2 | v1 MVP same day if possible | Rick |
| 3 | QR code: UUID only, no embedded data | Rick (after Lisa's recommendation) |
| 4 | HMAC-signed QR URLs: `gaia.ph/scan/<uuid>.<hmac>` | Rick ✓ |
| 5 | Stack: Next.js + Supabase + Vercel + Expo | Rick |
| 6 | Rewards: return stage only, no purchase-stage rewards | Rick |
| 7 | Both farmer AND dealer earn points at return | Rick |
| 8 | Dealer must approve return in CRM to trigger rewards | Rick |
| 9 | FPA integration: monthly spreadsheet import, not live API | Rick |
| 10 | Auth + expiry check on every scan, always | Rick |
| 11 | `scan_attempts` forensic table | Rick ✓ |
| 12 | Supabase RLS as primary DB-layer exploit guard | Rick ✓ |
| 13 | Pi Network deferred to Phase 2 | Rick |
| 14 | CRM includes QR batch generation + Zebra label export | Rick |
| 15 | Zebra thermal transfer printer + polypropylene labels | Rick |
| 16 | GAIA generates labels → ships to manufacturers → manufacturers apply | Rick |
| 17 | 9 data fields in DB, printed as human-readable text on label | Rick |

---

## 17. Next Steps

1. **PRD** — Write full PRD for GAIA v1 (4 surfaces)
2. **Tech Spec** — Database schema, API spec, state machine implementation
3. **Resolve Open Questions** — Rick to answer items in §12 before tech spec is finalized
4. **Design Brief** — Handoff to design: confirm palette, typography, component library from prototype
5. **FPA Data** — Rick to supply initial FPA registry spreadsheet for import testing
6. **QR Label Design** — Finalize label template (GABI branding + 9 fields + QR layout)

---

*Document compiled by Lisa Hayes — GAIA Discovery Session, 2026-04-24*
*Source: Macross discovery room transcripts + prototype review*
