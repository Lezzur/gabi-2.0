# GAIA (GABI Steward 2.0) — UI Design Document

**Date:** 2026-04-24  
**Surfaces:** Website (Next.js SSG), CRM (Next.js), Mobile App (Expo React Native)  
**Stitch Project:** 4037061963743505139 (mockup generation deferred — auth unavailable in pipeline environment)  
**Status:** Complete — design spec ready for implementation

---

## Design System

### Color Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `green-primary` | `#1A3D2E` | Brand, navigation backgrounds, headers |
| `cream-bg` | `#F5EDD8` | Website + mobile backgrounds |
| `gold-accent` | `#C8952A` | CTAs, active states, reward highlights |
| `green-dark` | `#122B1F` | Pressed states, deep backgrounds |
| `cream-deep` | `#EDE5CC` | Card surfaces on cream backgrounds |
| `state-success` | `#2E7D4F` | ✅ SUCCESS states (distinct mid-green — NOT brand green) |
| `state-warning` | `#B8690A` | ⚠️ WARNING / FPA expired (amber-brown) |
| `state-blocked` | `#B91C1C` | 🚫 BLOCKED / HMAC invalid / FPA hard block |
| `state-pending` | `#1E6A8A` | ⏱ PENDING / countdown active |
| `text-primary` | `#1A1A1A` | Body text |
| `text-secondary` | `#5A5A5A` | Secondary text, labels |
| `text-on-dark` | `#F5EDD8` | Text on green/dark backgrounds |

> **Design Decision — Brand Green vs Success Green:** Brand primary `#1A3D2E` is a deep forest green used for chrome, navigation, and identity. Success state uses `#2E7D4F` (mid-green), which is distinctly lighter and reads as "feedback" not "brand." Traffic-light semantics use the dedicated state tokens above — never the brand green.

### Typography

| Role | Font | Weight | Size (Desktop) | Size (Mobile) |
|------|------|--------|---------------|--------------|
| Hero H1 | Playfair Display | 700 | 56px | 36px |
| H2 | Playfair Display | 600 | 40px | 28px |
| H3 | Inter | 600 | 24px | 20px |
| Body | Inter | 400 | 16px | 15px |
| Label / Meta | Inter | 500 | 12px | 11px |
| Mono / Code | JetBrains Mono | 400 | 13px | 12px |
| CTA Button | Inter | 600 | 15px | 14px |

### Spacing Scale

`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96px` — 8px base unit.

### Border Radius

- Cards: `12px`
- Buttons: `8px`
- Badges/chips: `999px` (pill)
- Input fields: `8px`
- Alert banners: `8px`

---

## Surface 1 — Website (`apps/website`)

### Screen Inventory

| # | Route | Purpose | Key Components | Entry Point |
|---|-------|---------|---------------|-------------|
| W1 | `/` | Homepage — primary conversion + stakeholder education | Hero, Lifecycle steps, Four Roles grid, Stats, Pi Network section, Footer | Direct URL, all CTAs |
| W2 | `/how-it-works` | Farmer-facing scan flow explanation | Step-by-step illustrated sequence, scan diagram, FAQ accordion | Hero CTA, footer nav |
| W3 | `/for-brands` | Manufacturer value proposition | EPR compliance benefit blocks, audit report preview, label service description, contact CTA | Role grid, nav |
| W4 | `/for-dealers` | Dealer value proposition | Rewards mechanics, return processing flow, compliance dashboard preview, invite CTA | Role grid, nav |
| W5 | `/contact` | Lead capture + team inquiry | Contact form (name, company, role, message), Resend integration | Multiple CTAs throughout site |
| W6 | `/privacy` | Legal compliance | Privacy policy content (placeholder, legally reviewed pre-launch) | Footer link |

---

### W1 — Homepage

**Layout:** Single-page scroll, sections stacked vertically. Desktop: max-width 1280px centered container with 96px horizontal padding. Mobile: 24px horizontal padding.

#### Navigation Bar
- Background: `#1A3D2E` (green-primary)
- Logo: leaf icon + "GAIA" wordmark in `#F5EDD8`
- Links: Home, How It Works, For Brands, For Dealers, Contact — text `#F5EDD8`, hover underline in `#C8952A`
- CTA button: "Open Demo" — gold fill `#C8952A`, dark text, `8px` radius
- Mobile: hamburger icon (three lines), slide-down menu on tap

#### Hero Section
- Background: `#1A3D2E` (full-bleed green)
- H1 (Playfair Display 700): **"Authentic inputs. Rewarded farmers. Audit-ready stewardship."**
  - Text: `#F5EDD8`
  - Desktop: 56px, max 720px wide
  - Mobile: 36px, full width
- Subheadline (Inter 400, 18px): 2-sentence description — `rgba(245,237,216,0.8)`
- CTAs (horizontal row):
  - Primary: "Open Demo" — `#C8952A` fill, `#1A1A1A` text, 56px height, `8px` radius
  - Secondary: "Talk to the team" — ghost, `#F5EDD8` border + text
- Mobile: CTAs stack vertically, full width

#### Lifecycle Section (4 Cards)
- Background: `#F5EDD8`
- Section heading (H2, Playfair Display): "From shelf to compliance — automatically."
- Desktop: 4-column card grid. Mobile: vertical stack.
- Card template:
  - Icon (24px, `#C8952A`)
  - Step number (Inter 700, 12px, monospace, muted)
  - Title (Inter 600, 18px, `#1A3D2E`)
  - Description (Inter 400, 15px, `#5A5A5A`, 2 sentences)
  - Card background: `#EDE5CC`, `12px` radius, no border

Cards (in order):
1. **Verify Products** — Leaf + checkmark icon. "Farmers scan QR codes at purchase to verify FPA registration and formulation freshness."
2. **Earn Rewards** — Star/coin icon. "Return empty containers to earn points redeemable for discount vouchers at partnered dealers."
3. **Return Container** — Recycle icon. "Dealers process container returns, confirming safe disposal and triggering EPR compliance events."
4. **Audit-Ready Reporting** — Document icon. "Every scan writes a forensic record. Compliance reports export in one click."

#### Four Roles Section
- Background: white
- 2×2 grid desktop / stacked mobile
- Same card template as lifecycle, slightly larger icons

Roles:
1. **Farmer** — Person icon. "Verify what you're buying, track your containers, earn rewards for responsible disposal."
2. **Regulator** — Shield icon. "Access audit-ready compliance data. Every EPR event is logged and exportable."
3. **Brand / Manufacturer** — Building icon. "Get FPA registration management, label generation, and real return-rate analytics."
4. **GABS Admin** — Key icon. "Full platform control — product activation, dealer onboarding, wallet management, system configuration."

#### Stats Section
- Background: `#1A3D2E`
- 3 large stats (number + label) — white text on green
- Placeholder: "31,990+ FPA-registered products", "60-minute purchase window", "100% audit trail"
- Stat number: Playfair Display 700, 48px
- Label: Inter 400, 14px, `rgba(245,237,216,0.7)`

#### Pi Network Section
- Background: `#F5EDD8`
- Heading (H2): **"Pi Network & on-chain traceability — in the architecture, not on the demo."** (exact copy)
- Body: 2–3 sentences on v2 roadmap. Subtle Pi logo icon.
- Visual: "Coming in Phase 3" badge in `#C8952A`

#### Footer
- Background: `#122B1F`
- Links: Privacy, How It Works, For Brands, For Dealers, Contact
- Copyright, `#F5EDD8` at 50% opacity

---

### W5 — Contact Form

**States:**

| State | Visual |
|-------|--------|
| Default | Fields empty, "Send message" CTA enabled |
| Focused | Field border `#C8952A`, label floats |
| Submitting | All fields disabled, button shows spinner + "Sending…" |
| Success | Green checkmark, "We'll be in touch." message, form hidden |
| Error | "Something went wrong — try again." banner in `state-blocked` red |
| Rate limited | "Too many requests. Please wait before sending again." |

---

## Surface 2 — CRM (`apps/crm`)

### Design System Adaptation for CRM

> **Design Decision — CRM Design System:** The warm cream `#F5EDD8` background is used for the main content area. Sidebar background uses `#1A3D2E` (brand green) for strong navigation anchor. Data tables use a white background within cream content area for maximum contrast. This preserves brand identity without sacrificing the legibility that data-dense operational interfaces require.

### Layout Shell

```
┌──────────────────────────────────────────────────────┐
│  HEADER: logo + user menu + role badge               │
├──────────────────────────────────────────────────────┤
│ SIDEBAR │                MAIN CONTENT                │
│ 240px   │                ~1040px                     │
│ green   │                cream bg                    │
│ fixed   │                scrollable                  │
└──────────────────────────────────────────────────────┘
```

**Sidebar:**
- Background: `#1A3D2E`
- Logo top-left: leaf icon + "GAIA" in cream
- Nav items: Products, Containers, Dealers, Manufacturers, Reports, Settings
- Active state: `#C8952A` left border (4px) + item background `rgba(200,149,42,0.15)`
- Text: `#F5EDD8`, inactive at 70% opacity
- Role-scoped: items not accessible to current role appear dimmed with lock icon (not hidden)
- Bottom: user avatar + name + role badge + logout

**Header:**
- Background: white
- Height: 64px
- Left: breadcrumb (current section > subsection)
- Right: notification bell + user avatar dropdown

### CRM Screen Inventory

| # | Screen | Purpose | Key Components |
|---|--------|---------|---------------|
| C1 | Products List | Browse, filter, manage product catalog | Table, filters, status badges, import CTA |
| C2 | Product Detail | View/edit product fields, activate via OCR | Field display, edit form, OCR flow entry, status indicator |
| C3 | OCR Flow — Step 1 | Label image upload | Drag-and-drop area, file picker, requirements |
| C4 | OCR Flow — Step 2 | Review extracted fields | Two-column review layout, confidence badges, edit-in-place |
| C5 | OCR Flow — Step 3 | Safety confirmation gate | Safety panel, two explicit confirmation checkboxes, submit |
| C6 | OCR Flow — Step 4 | Activation success | Success state, product now active |
| C7 | FPA Import | Upload + progress + summary | Upload area, multi-stage progress, summary table |
| C8 | Containers List | Browse containers by state/batch/product | Table, filters, batch generation CTA |
| C9 | Container Detail | Full scan history for single container | Timeline of scan_attempts, state badge, product summary |
| C10 | Batch Generation | Generate QR batch for active product | Form, product selector, quantity, download |
| C11 | Dealer Scan — Purchase | Full-screen QR scanner for dealer purchase flow | Camera, result card, countdown timer |
| C12 | Dealer Scan — Return | Full-screen QR scanner for dealer return flow | Camera, condition dialog, result card, countdown |
| C13 | Dealer List | Manage dealer accounts | Table, verification status, invite CTA |
| C14 | Dealer Detail | Edit dealer, verify, view wallet | Profile, territory, wallet balance, verify button |
| C15 | Reports | Compliance data, CSV export | Date filters, metric cards, table, export button |
| C16 | Wallet | Dealer wallet balance + transactions | Balance card, transaction history, voucher list |
| C17 | Settings | Platform configuration, reward_config | Config forms grouped by category |

---

### C1 — Products List

**Layout:** Full-width table in white card on cream background.

**Filters bar (above table):**
- Search input (product name / company / reg #)
- Status dropdown: All / Active / Draft / Suspended
- Type dropdown: All / Herbicide / Insecticide / Fungicide / etc.
- Company text filter
- "Import FPA" button (gold, right-aligned) — `gabs_admin` only

**Table columns:**
- Product Name (link to detail)
- Company
- FPA Reg # (monospace, truncated)
- FPA Expiry (color-coded: green if valid, amber if expiring within 90 days, red if expired)
- Status badge (pill: Active = `state-success` green, Draft = amber, Suspended = gray)
- Last Updated

**Pagination:** 50/page, page selector at bottom right.

**States:**

| State | Visual |
|-------|--------|
| Loading | Skeleton rows (gray shimmer, 50 rows) |
| Loaded | Full table with realistic data |
| Empty | Centered: leaf icon + "No products yet" + "Import FPA Spreadsheet" gold CTA |
| Error | Error banner + "Retry" button, table area shows placeholder |
| Filtered / no results | "No products match your filters" + "Clear filters" link |

---

### C4 — OCR Flow Step 2: Review Extracted Fields

**Layout:** Two-column split.
- Left (40%): label image preview (zoomable, scrollable for long labels)
- Right (60%): extracted fields form

**Field row pattern:**
```
[Field Label]                    [Confidence Badge]
[Editable Input — pre-filled]
```

- Confidence badge: "Extracted" (green pill) or "Not found" (gray pill)
- Inputs: fully editable regardless of confidence
- Fields with non-null values: cream background `#EDE5CC`
- Fields with null values: white background, placeholder "Not found — enter manually"
- Top banner: ⚠️ "All values extracted by AI — please verify against the physical label before confirming."

**"Fill manually" mode:** collapses the left panel, expands form to full width.

---

### C5 — OCR Flow Step 3: Safety Confirmation Gate

> **Design Decision — Safety Confirmation Friction:** The PRD requires explicit confirmation of `note_to_physician` and `category` (toxicity) before product activation. Standard checkboxes are insufficient for safety-critical medical information. This screen uses friction-by-design: the operator must read the exact extracted value within the checkbox label — not just click blindly. The submit button is visually and functionally disabled until both fields are confirmed. The panel uses a distinct visual treatment (amber border, warning icon) to signal elevated stakes.

**Layout:** Dedicated full-width panel, amber `#B8690A` border (2px), `12px` radius.

**Panel header:**
- ⚠️ warning icon (24px, amber)
- Heading: "Safety Confirmation Required" (Inter 700, 18px)
- Subtext: "These fields carry medical safety information. Verify each against the physical label before confirming."

**Checkbox 1 — Toxicity Category:**
```
[ ] I confirm the Toxicity Category for this product is:
    Category [VALUE] — [LABEL e.g. "Moderately Hazardous"]
    This value has been verified on the physical label.
```
- Checkbox must be a real `<input type="checkbox">` — not styled away
- The exact value is rendered inline in the label (not a separate field)
- If value is null: checkbox disabled, shows "This field was not extracted. Enter the value manually before confirming." in red

**Checkbox 2 — Note to Physician / Antidote:**
```
[ ] I confirm the Note to Physician / Antidote for this product is:
    "[EXTRACTED VALUE — full text, multi-line if needed]"
    This text has been verified on the physical label.
```
- Same treatment as above

**Submit button:**
- Disabled state: gray fill, "Confirm and Activate" — cursor-not-allowed
- Enabled state (both checked): `#C8952A` gold fill, "Confirm and Activate"
- No intermediate partial-check state that enables the button

**Below panel:** "Back to field review" text link.

---

### C7 — FPA Import Page

> **Design Decision — Multi-Stage Import Progress:** A 120-second wait with a single spinner is hostile. The import progress shows four distinct stages with a visual step indicator to communicate that work is happening, not hanging.

**Upload area:**
- Dashed border, leaf icon, "Drag .xlsx here or click to browse"
- File type restriction: `.xlsx` only, 50MB max
- On file selected: shows filename + size + "Import" button

**Progress (four stages with step indicator):**

```
[1 Uploading] ──► [2 Parsing] ──► [3 Importing] ──► [4 Done]
     ✓                ●                 ○                ○
```

- Stage 1 — Uploading: progress bar (determinate, byte-level upload)
- Stage 2 — Parsing: indeterminate progress bar + "Reading 31,990 rows…"
- Stage 3 — Importing: batch counter "Importing batch 12 of 64…" (updates as batches complete)
- Stage 4 — Done: green checkmark

**Post-import summary table:**

| Metric | Value |
|--------|-------|
| Inserted | N new products |
| Updated | N existing products refreshed |
| Skipped | N rows (empty registration number) |
| Errors | N rows — expandable list with row number + reason |

---

### C11 — Dealer Scan: Purchase

**Layout:** Full-screen. Camera occupies full viewport. Overlay elements on top.

**Camera area:**
- Full-screen QR viewfinder
- Centered targeting square (white corner brackets, 200×200px)
- Scan instructions: "Align QR code within the frame" (Inter 400, 14px, white with text shadow)

**Context toggle (top center):**
- "Purchase" | "Return" segmented control
- Active pill: `#C8952A` gold
- Inactive: white at 60% opacity

**Result cards (slide up from bottom, ~50% screen height):**

**Success — green card:**
- Green `#2E7D4F` header strip: "✓ Container Verified"
- Product name (Inter 700, 20px)
- Company + FPA Reg # (mono, 13px)
- Countdown timer component:
  - Large digits: "58:43" — Inter 700, 36px
  - Below: "Customer must scan within this window"
  - Timer updates every second via `setInterval`
  - Below 5:00: digits turn `state-blocked` red
  - At 0:00: digits show "EXPIRED" — card header turns red, "Window has closed. Ask customer to return later."
  - **Zero-state (after expiry):** Card remains visible (does not auto-dismiss). Shows "Re-scan to start a new window" CTA button. This resolves the countdown dead-end.

**FPA Blocked — red card:**
- Red `#B91C1C` header strip: "✗ FPA Registration Expired"
- Product name
- "FPA Expiry: [DATE]"
- "This product cannot be sold. The FPA registration has lapsed."
- No CTA — hard block, no retry path

**State Mismatch — amber card:**
- Amber `#B8690A` header strip: "⚠ Cannot Process"
- "This container is not available for sale."
- "Expected state: In Distribution. Current state: [STATE]"

---

### C12 — Dealer Scan: Return (Condition Confirmation)

Before submitting the return scan, a confirmation modal appears:

**Modal:**
- Title: "Confirm Container Condition"
- Body: "Before processing this return, confirm the container has been:"
  - ✓ Emptied completely
  - ✓ Rinsed (triple-rinse method)
  - ✓ Punctured or crushed to prevent reuse
- Two buttons: "Confirm & Process Return" (gold) | "Cancel" (ghost)
- This modal fires BEFORE the API call — the `condition_confirmed: true` flag is only sent after explicit confirmation.

---

## Surface 3 — Mobile App (`apps/mobile`)

### Design System Adaptation for Mobile

- Background: `#F5EDD8` (cream) for all screens
- Bottom tab navigation: 4 tabs (Scan, Wallet, History, Profile)
- Tab bar background: `#1A3D2E` (green), active tab icon `#C8952A`, inactive `rgba(245,237,216,0.5)`
- All interactive targets: minimum 44×44pt (required for rural farmers with larger hands, outdoor use)
- Text minimum: 15px — no text below 13px except legal labels

### Mobile Screen Inventory

| # | Screen | Purpose | Key Components |
|---|--------|---------|---------------|
| M1 | Splash / Onboarding Welcome | First launch, brand introduction | Logo, tagline, "Get Started" |
| M2 | Phone Number Entry | OTP auth step 1 | Phone input, +63 prefix, "Send code" CTA |
| M3 | OTP Verification | Auth step 2 | 6-digit OTP input, resend timer, "Verify" |
| M4 | Scan Screen (default) | QR camera — core app function | Fullscreen camera, context toggle, offline badge |
| M5 | Scan Result — Purchase Success | Purchased container details | Product card, safety info, formulation status |
| M6 | Scan Result — Return Success | Rewards confirmation | Points earned card, confetti, wallet CTA |
| M7 | Scan Result — Window Expired | 60-min window missed | Error card, instructions |
| M8 | Scan Result — FPA Warning | FPA expired product (non-blocking) | Yellow banner + product card |
| M9 | Scan Result — Counterfeit Warning | HMAC invalid | Full-screen red warning |
| M10 | Scan Result — Product Draft | Product not activated | Informational card |
| M11 | Offline Queue Banner | Pending syncs notification | Sticky banner, count, sync button |
| M12 | Wallet Screen | Points balance + transactions | Balance card, history list |
| M13 | Voucher Redemption | Redeem points for discount vouchers | Available vouchers, points cost |
| M14 | Active Vouchers | Show QR for dealer scan | Voucher card with QR code |
| M15 | Scan History | Past scan log | List with outcome badges |
| M16 | Product Detail | Full product info from scan | All safety and registration fields |
| M17 | Profile Screen | Account, logout, app info | Phone (masked), logout, version |

---

### M4 — Scan Screen

**Full-screen camera view.**

**Top overlay:**
- GAIA leaf icon (white, 24px)
- Context toggle: "Buying" / "Returning" — `#C8952A` gold active pill

**Center overlay:**
- QR targeting frame: 220×220px, white corner brackets (no fill), `2px` white stroke
- Below frame: "Align QR code here" (Inter 400, 13px, white, text shadow)

**Bottom overlay (on camera):**
- If offline queue non-empty: amber badge "● 2 pending sync" — tappable, leads to queue list
- "Enter manually" text link (for damaged QR codes)

**Loading state (API call in progress):**
- Scanner dims to 40% opacity
- Centered spinner (`#C8952A`)
- "Verifying…" label

**Offline state:**
- Persistent banner at top of screen: orange `#B8690A` bg, "You're offline — scans will queue automatically"
- Camera remains active — user can still scan and queue

---

### M5 — Scan Result: Purchase Success

**Product card (white card on cream background):**

**Header (green `#1A3D2E` strip):**
- ✓ icon + "Verified Purchase"
- Product name (Playfair Display, 22px, cream)

**Body:**
- Company (Inter 500, 14px)
- FPA Reg # (monospace, 13px)
- "Registered by FPA"

**Safety section (amber `#B8690A` tinted background strip):**
- Toxicity Category icon (skull/symbol per WHO category)
- Pre-Harvest Interval: "X days"
- Re-Entry Period: "X hours"
- Note: "⚠ Note to Physician: [extracted text]" — scrollable if long

**Formulation status bar:**
- "Formulation expires in X months" — green if > 6mo, amber if 2-6mo, red if < 2mo
- Progress bar showing remaining months

**FPA status badge:**
- "FPA Valid" (green pill) / "FPA Expiring Soon" (amber) / "FPA Expired — Use with caution" (red)

**CTA:** "Back to Scanner" (gold button, full width)

---

### M9 — Counterfeit Warning Screen

> **Design Decision — Counterfeit Warning for Rural Philippines Farmers:** This is a high-stakes alert. The target user may have limited English literacy and is using a mid-range Android in outdoor conditions. The design uses icon-first legibility (large symbol, no reliance on text to convey the primary message), a full-screen red background for urgency, and placeholder i18n architecture for Filipino/Tagalog localization. The English copy is direct and non-technical.

**Full-screen layout:**
- Background: `#B91C1C` (state-blocked red) — full bleed
- No tab bar visible

**Top section (60% of screen, centered):**
- Large warning icon: ⚠️ or "STOP" hand symbol — 80×80px, white
- Below icon: "PEKE" (Tagalog for "FAKE/COUNTERFEIT") in large white text, Inter 900, 48px
  - i18n key: `scan.counterfeit.headline` (English fallback: "COUNTERFEIT")

**Middle section:**
- English: "This QR code may be counterfeit. Do not use this product." — Inter 600, 18px, white
- Filipino: "Ang QR code na ito ay maaaring peke. Huwag gamitin ang produktong ito." — Inter 400, 16px, `rgba(255,255,255,0.85)` — displayed below English on all devices (bilingual, not toggled)

**Bottom section:**
- "Report this product" button — white outline, `#B91C1C` text
- "Cancel" text link — white, 14px

**Animation:** Screen enters with a short pulse (0.2s scale 1.05 → 1.0) to draw immediate attention.

---

### M11 — Offline Queue Management

**Persistent banner (when queue non-empty):**
- Background: `#B8690A` amber
- "⟳ 3 scans pending sync" (Inter 600, 14px, white)
- "Sync now" button (white text, transparent bg, right-aligned)
- Tapping the banner opens a bottom sheet with the queue list

**Queue bottom sheet:**
- Header: "Pending Scans (3)"
- Each item: product UUID (truncated) + "Buying/Returning" + local timestamp
- "Sync All" gold button at bottom
- Individual items can be dismissed (swipe left → "Remove" red CTA)

**After sync:**
- For each successfully synced item: shows result card (success or failure)
- Banner dismisses when queue reaches zero

---

## Component Patterns

### Status Badges

| Status | Color | Usage |
|--------|-------|-------|
| Active | `state-success` green pill | Product/container in valid active state |
| Draft | Amber `#B8690A` pill | Awaiting safety confirmation |
| Suspended | Gray pill | Manually suspended |
| In Distribution | `state-pending` blue pill | Container not yet sold |
| Purchased | `state-success` green pill | Container sold to farmer |
| Returned | `state-pending` blue pill | Container returned, rewards not yet paid |
| Rewards Paid | Gold `#C8952A` pill | Full lifecycle complete |
| FPA Expired | `state-blocked` red pill | FPA registration lapsed |
| FPA Expiring | Amber pill | Within 90 days of expiry |

### Data Tables (CRM)

All tables follow this pattern:
- White background table within cream content area
- Column headers: Inter 600, 12px uppercase, `text-secondary` gray
- Row dividers: `1px solid rgba(0,0,0,0.06)`
- Hover state: `rgba(26,61,46,0.04)` green tint
- Row click → navigates to detail page
- Checkbox column for bulk selection (left)
- Actions column with `…` overflow menu (right) — Edit, View, Deactivate

### Scan Result Cards (CRM)

All scan result cards share a base:
- `12px` radius, subtle `box-shadow`
- Header strip: full-width, 48px height, icon + outcome label
- Body: product info, details, countdown if applicable
- Footer: CTA button (full width, `8px` radius)

### Countdown Timer Component

Used in: CRM dealer scan (purchase + return).

- Display: `MM:SS` format, Inter 700, 36px
- Updates: `setInterval(1000)` on mount, `clearInterval` on unmount
- Color states: `text-primary` → amber at 5:00 → `state-blocked` red at 0:00
- At 0:00: replaces digits with "EXPIRED" text, stops interval
- **Post-expiry state:** card header turns red, shows "Window has closed" message + "Re-scan" CTA. Card does NOT auto-dismiss or auto-clear. Dealer must explicitly tap "Re-scan" to return to camera.

### OCR Confidence Badge

- "Extracted" (green pill, `state-success`) — LLM returned a non-null value
- "Not found" (gray pill) — null returned
- "Edited" (blue pill) — operator has modified the extracted value
- Confidence is display-only. It does not prevent editing.

### Toast Notifications (CRM)

- Position: top-right, 16px from edges
- Auto-dismiss: 4 seconds
- Types: Success (green left border), Error (red left border), Warning (amber left border), Info (blue left border)
- Content: Icon + message text + optional "Undo" link

---

## Responsive Behavior

### Website

| Breakpoint | Behavior |
|-----------|---------|
| < 768px (mobile) | Hamburger nav, all grids stack to 1 column, hero H1 36px, CTAs full-width stacked |
| 768–1024px (tablet) | 2-column grids, nav visible but compressed, hero H1 44px |
| > 1024px (desktop) | Full layout, 4-column grids, 56px H1, CTAs inline |

### CRM

| Breakpoint | Behavior |
|-----------|---------|
| < 1024px | Sidebar collapses to icon-only (32px wide), tooltips on hover |
| 1024–1280px | Sidebar 200px, reduced table column count |
| > 1280px | Full layout, 240px sidebar |

> **Note:** CRM is desktop-first. Mobile CRM not in v1 scope.

### Mobile App

- Primary target: 375px wide (iPhone SE / mid-range Android)
- Max tested width: 430px (iPhone Pro Max)
- All layouts tested at both bounds
- Bottom tab bar stays fixed regardless of screen height
- Scan result cards: full-width, scrollable if content overflows

---

## State Coverage

### Universal States (All Surfaces)

| Screen Type | Loading | Empty | Error | Success |
|------------|---------|-------|-------|---------|
| Data tables (CRM) | Skeleton rows (shimmer) | Icon + message + CTA | Error banner + retry | Full table |
| Forms | — | Default fields | Inline field errors + banner | Toast + next step |
| Scan results | Spinner overlay on camera | — | Outcome-specific card | Outcome-specific card |
| Detail pages | Skeleton layout | — | Error + retry | Full content |

### CRM-Specific States

**Product list:** Loading (skeleton 50 rows) | Loaded | Empty ("No products — import FPA spreadsheet") | Filter empty ("No matching products — clear filters") | Error + retry

**OCR Step 2 (review):** Loading extraction (spinner, "Analyzing label image…") | Extracted (fields pre-filled) | OCR failed (all fields empty, "Extraction failed — fill manually" banner) | LLM timeout ("AI timed out — fill manually") | Manual mode (OCR fields hidden, clean empty form)

**FPA import:** Idle | Uploading (progress bar) | Parsing | Importing (batch counter) | Complete (summary) | Error (row-level errors + failed summary)

**Countdown timer:** Active → Warning (< 5:00, amber) → Expired (red "EXPIRED" text) → Post-expiry (re-scan CTA)

### Mobile-Specific States

**Scan screen:** Camera active | Loading (API in flight) | Success (result card) | Error (outcome card) | Offline (queue badge visible, scans queue silently)

**Wallet:** Loading (skeleton) | Loaded | Empty ("Scan container returns to earn your first points")

**Offline queue:** Empty (no banner) | 1+ items (amber banner) | Syncing (spinner) | Sync complete (all results shown) | Sync partial failure (failed items remain in list)

---

## Interaction Patterns

### Navigation Flows

**CRM — OCR Activation Flow:**
```
Product List → Product Detail → "Add from Label" →
  Step 1: Upload → Step 2: Review → Step 3: Safety Confirm → Step 4: Active
  (Back navigation available between all steps)
  (Step 3 → back goes to Step 2, not Step 1)
```

**CRM — Dealer Purchase Scan:**
```
Dealer Scan Page (camera active) → QR detected → API call →
  Success: result card + countdown → (60 min expires → "EXPIRED" state → re-scan)
  FPA Block: blocked card (no path forward — go back or try different container)
  State Mismatch: yellow card → back to camera
```

**Mobile — Purchase Flow:**
```
Scan Screen → QR detected → (online: API immediately) (offline: queue + "Scan saved") →
  Success: product card → "Back to Scanner"
  Error: error card → "Try Again" → back to camera
```

**Mobile — OTP Onboarding:**
```
Welcome → Phone Entry → OTP Verification → (valid: Home/Scan tab) → (invalid: OTP field error + retry)
```

**Mobile — Return Flow:**
```
Scan Screen (toggle to "Returning") → QR detected → API →
  Dealer has not scanned: "Window Expired" or "Not in returned state" card
  Within window: "+100 Points" confetti card → wallet balance updates
```

### Modal Behavior

- **CRM condition confirmation dialog (return scan):** Rendered as center modal with backdrop `rgba(0,0,0,0.5)`. Cannot be dismissed by clicking backdrop — only by explicit "Confirm" or "Cancel" button. This is intentional friction.
- **Mobile bottom sheets:** Slide up from bottom, dismissible by swipe down or tap backdrop. Wallet voucher selection, offline queue management.
- **CRM toast notifications:** Non-blocking, auto-dismiss 4 seconds. No modal.

### Transitions

- **CRM scan result card:** Slides up from bottom of viewport (300ms ease-out) — does not replace the camera, overlays it.
- **Mobile scan result screen:** Full-screen push navigation (300ms slide-left from right).
- **OCR steps:** Cross-fade (200ms) between steps — not a slide, to signal same-context progression.
- **Countdown timer digits:** No animation — raw number update every second (animation would cause distraction during an operational moment).
- **Mobile counterfeit warning:** Fade in on full-screen red (150ms) + single pulse scale animation (200ms, 1.0 → 1.05 → 1.0).

---

## Open Design Questions

1. **CRM dark mode:** Not scoped for v1. Sidebar is already dark-on-green; main content area dark mode would require significant token additions. Post-launch.
2. **Manufacturer portal screens:** Not in v1 scope (onboarding is GAIA staff only). Screens to be designed when self-serve manufacturer portal is added.
3. **Pi Network wallet UI (mobile):** Designed as a disabled "Coming Soon" tab placeholder in v1. Full design deferred to Phase 3.
4. **Label design (Zebra export):** Physical label typography, layout, and toxicity symbol placement are not covered in this document — separate print design artifact required before Phase 6 implementation.
5. **Push notification design:** Not in v1 scope.

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | CRM uses cream `#F5EDD8` background (not white) | Maintains brand consistency across surfaces. White table cards within cream area provide sufficient contrast for data-dense tables without abandoning the design system. |
| D2 | Brand green `#1A3D2E` ≠ success state green `#2E7D4F` | Brand primary is dark and would be ambiguous as a traffic-light signal. Success uses a distinctly lighter mid-green that reads as "feedback" at a glance. Blocked uses red; warning uses amber. All three are perceptually distinct from brand colors. |
| D3 | OCR safety confirmation uses friction-by-design (exact value in checkbox label) | Standard checkboxes allow clicking without reading. Embedding the extracted value inside the checkbox label forces operator to read the specific value before confirming. Submit button disabled until both checked — enforced at UI level, also enforced at API level (belts + suspenders). |
| D4 | Countdown timer zero-state shows "EXPIRED" + re-scan CTA (does not auto-clear) | PRD says display "Expired" at 0:00 but leaves the after-state undefined. Auto-clearing would silently remove important operational context. Showing the expired card with explicit "Re-scan" CTA keeps the dealer informed and gives them a clear next action. |
| D5 | Counterfeit warning screen is bilingual (English + Filipino) on all devices | Target user is a rural Filipino farmer who may not read English fluently. Dual-language display is safer than a language toggle — no farmer should have to navigate a UI to read a safety warning. i18n keys present throughout; bilingual display is the v1 default for this screen only. |
| D6 | FPA import shows 4-stage progress (Upload → Parse → Import → Done) instead of spinner | A 120-second indeterminate spinner is hostile UX. Stage progression (with batch counter in Stage 3) communicates that the process is advancing, not frozen. Deterministic upload progress (byte-level) in Stage 1 gives the operator immediate feedback before the slow processing begins. |
| D7 | Return condition confirmation modal cannot be dismissed by clicking backdrop | This is a safety-critical confirmation. Accidental dismissal would allow a return to be processed without confirming container condition. Only explicit button action can close the modal. |
| D8 | Mobile tab bar uses brand green background | Keeps the shell navigation anchored to brand identity. Cream background tabs would create too little visual separation between content and navigation chrome. |
| D9 | Mobile minimum text size: 15px body, 44×44pt touch targets | Outdoor use on mid-range Android in bright sunlight. Larger text and touch targets reduce misscans and frustration for users who may be operating the phone with gloved or muddy hands. |
| D10 | OCR confidence badges are display-only — do not block editing | Confidence is a hint, not a gate. Every field is always editable. Blocking edits on "high confidence" fields would create false trust. The safety gate is at confirmation, not at field level. |

---

*UI Design document produced 2026-04-24 for GAIA (GABI Steward 2.0). All design decisions align with PRD decisions 1–53. Power's flagged UX moments (brand green conflict, OCR safety gate, countdown zero-state, counterfeit warning accessibility, FPA import progress) are addressed explicitly in Design Decisions D2–D6.*
