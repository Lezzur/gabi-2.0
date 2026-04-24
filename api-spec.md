# GAIA API Reference

**Version:** 1.0  
**Base URL:** `https://<crm-domain>/api` (Vercel-hosted Next.js API routes)  
**Authentication:** Supabase JWT Bearer token  
**Content-Type:** `application/json` (except file uploads: `multipart/form-data`)  
**Date:** 2026-04-24  
**Authors:** Ayanokoji (spec), Tony Stark (tech spec input)  
**Source:** PRD v3 (53 decisions), TECH-SPEC-gaia-2026-04-24

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Common Response Formats](#2-common-response-formats)
3. [Pagination](#3-pagination)
4. [Rate Limits](#4-rate-limits)
5. [Versioning](#5-versioning)
6. [Endpoints — Scan](#6-endpoints--scan)
7. [Endpoints — Products](#7-endpoints--products)
8. [Endpoints — Containers](#8-endpoints--containers)
9. [Endpoints — Dealers](#9-endpoints--dealers)
10. [Endpoints — Wallets](#10-endpoints--wallets)
11. [Endpoints — Scan History](#11-endpoints--scan-history)
12. [Endpoints — Reward Config](#12-endpoints--reward-config)
13. [Endpoints — Contact](#13-endpoints--contact)
14. [OpenAPI 3.1 Appendix](#14-openapi-31-appendix)
15. [Decisions](#15-decisions)
16. [Review Checklist](#16-review-checklist)

---

## 1. Authentication

Two auth methods, depending on the user surface:

### 1.1 Farmer (Mobile App) — Phone OTP

Farmer auth uses Supabase Phone OTP via Twilio. The mobile app calls Supabase Auth SDK directly — no custom auth endpoints.

```
POST https://<supabase-project>.supabase.co/auth/v1/otp
{ "phone": "+639171234567" }
```

After OTP verification, the Supabase SDK returns a JWT. All subsequent API calls include:

```
Authorization: Bearer <supabase-jwt>
```

### 1.2 CRM Users (Dealer, Brand Admin, GABS Admin) — Email/Password

CRM users authenticate via Supabase email/password. Onboarding uses magic-link invites. The CRM app uses `@supabase/ssr` for session-aware server components with httpOnly cookies.

### 1.3 Role Resolution

The JWT contains `app_metadata.role` which maps to one of:

| Role | Surfaces | Capabilities |
|------|----------|-------------|
| `farmer` | Mobile app | Scan (purchase_farmer, return_farmer), view own wallet, view own history |
| `dealer` | CRM | Scan (purchase_dealer, return_dealer), view own containers, view own wallet |
| `brand_admin` | CRM | View/edit own products, view reports |
| `gabs_admin` | CRM | Full access — all CRUD, imports, generation, reports |

### 1.4 Service Role

Backend-to-Supabase calls use the service role key for privileged operations (state transitions, reward crediting). This key never appears in client bundles or API responses.

---

## 2. Common Response Formats

### 2.1 Success Response

```json
{
  "data": { ... },
  "meta": {
    "request_id": "req_7f3a9b2c"
  }
}
```

### 2.2 Error Response

Every error uses this shape. No exceptions.

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "i18n:errors.validation_failed",
    "details": [
      { "field": "uuid", "issue": "Required" }
    ],
    "request_id": "req_7f3a9b2c"
  }
}
```

### 2.3 Error Codes (Global)

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `VALIDATION_FAILED` | Zod schema validation failed |
| 400 | `INVALID_INPUT` | Request body malformed or missing required fields |
| 401 | `AUTH_REQUIRED` | Missing or expired JWT |
| 403 | `FORBIDDEN` | Authenticated but insufficient role |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Resource state conflict (e.g., already claimed) |
| 422 | `UNPROCESSABLE` | Valid request but business rule prevents action |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### 2.4 i18n Message Convention

All `message` fields in error and success responses use i18n keys (dot-namespaced, domain-first). Examples: `i18n:scan.purchase.farmer_confirmed`, `i18n:errors.hmac_invalid`. Clients resolve these keys against `packages/shared/i18n/en.json`.

---

## 3. Pagination

All list endpoints use **cursor-based pagination**. Cursors are opaque base64-encoded strings containing `(sort_key, id)`. Clients must not parse or construct cursors — treat them as opaque tokens.

### 3.1 Request Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | — | Opaque cursor from previous response |
| `limit` | integer | No | 20 | Items per page (min: 1, max: 100) |

### 3.2 Response Envelope

```json
{
  "data": [ ... ],
  "pagination": {
    "next_cursor": "eyJjIjoiMjAyNi0wNC0yNFQxMDowMDowMFoiLCJpIjoiYTFiMmMzIn0=",
    "has_more": true
  },
  "meta": {
    "request_id": "req_7f3a9b2c"
  }
}
```

When `has_more` is `false`, `next_cursor` is `null`.

### 3.3 Cursor Shape (Internal — Not Exposed to Clients)

```json
// base64 of:
{ "c": "<sort_key_value>", "i": "<row_id>" }
```

Default sort: `created_at DESC`. Changing sort order does not break existing cursors because the cursor encodes the actual sort value.

---

## 4. Rate Limits

### 4.1 Global Rate Limit

| Scope | Limit | Window | Key Dimension |
|-------|-------|--------|---------------|
| All endpoints | 60 requests | per minute | Source IP |

### 4.2 Endpoint-Specific Rate Limits

| Endpoint | Limit | Window | Key Dimension | Notes |
|----------|-------|--------|---------------|-------|
| `POST /api/scan` (invalid HMAC) | 10 invalid HMACs | per hour | Container UUID | Prevents QR UUID enumeration. After 10 invalid HMACs for a UUID, that UUID returns 429 for 1 hour. |
| `POST /api/contact` | 5 submissions | per hour | Source IP | Website contact form spam prevention |
| `POST /api/products/ocr` | 10 requests | per minute | Authenticated user | Vision LLM cost control |

### 4.3 Rate Limit Response

HTTP 429 with headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1714003200
Retry-After: 45
```

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "i18n:errors.rate_limited",
    "details": {
      "retry_after": 45
    },
    "request_id": "req_7f3a9b2c"
  }
}
```

---

## 5. Versioning

**Strategy:** No URL path version prefix in v1. All endpoints are unversioned (`/api/scan`, not `/api/v1/scan`).

**Rationale:** Single-tenant platform with controlled clients (CRM + mobile app, both built by us). No third-party consumers. Adding `/v1/` prefix when v2 is actually needed is a one-time routing change.

**Deprecation policy (future):** When a v2 endpoint is introduced, v1 continues to work for 6 months with a `Sunset` header. Clients receive a `Deprecation: true` header on v1 calls during the sunset period.

---

## 6. Endpoints — Scan

### 6.1 Process Scan

```
POST /api/scan
```

**Purpose:** Surface-agnostic scan handler for CRM (dealer) and mobile (farmer). All four scan steps route through this single endpoint. This is the core state machine.

**Auth:** Required. Role must match the `step` parameter (dealer steps require `dealer` role; farmer steps require `farmer` role).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uuid` | string (UUID) | Yes | Container UUID from QR code |
| `hmac` | string | Yes | First 16 hex characters of HMAC-SHA256 |
| `step` | string (enum) | Yes | `purchase_dealer` \| `purchase_farmer` \| `return_dealer` \| `return_farmer` |
| `local_scan_ts` | string (ISO 8601) | Yes | Device-local timestamp of scan |
| `device_id` | string | Yes | Unique device identifier |
| `last_online_ts` | string (ISO 8601) | Yes | Device's last confirmed online timestamp |
| `condition_confirmed` | boolean | Conditional | Required and must be `true` for `return_dealer` step |

**Example Request:**

```json
{
  "uuid": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
  "hmac": "bf2a8c16b30e7e9f",
  "step": "purchase_farmer",
  "local_scan_ts": "2026-04-24T11:05:13+08:00",
  "device_id": "expo:android:a52:7f39",
  "last_online_ts": "2026-04-24T09:47:02+08:00",
  "condition_confirmed": false
}
```

**Response — Tagged Union by `outcome`:**

The response shape varies by outcome. The `outcome` field is the discriminator.

#### Outcome: `success` (purchase_dealer)

HTTP 200

```json
{
  "data": {
    "outcome": "success",
    "container": {
      "id": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
      "state": "pending_purchase"
    },
    "product": null,
    "message": "i18n:scan.purchase.dealer_confirmed",
    "rewards_credited": null,
    "fpa_warning": false,
    "pending_expires_at": "2026-04-24T12:05:13+08:00"
  },
  "meta": { "request_id": "req_scan_001" }
}
```

#### Outcome: `success` (purchase_farmer)

HTTP 200

```json
{
  "data": {
    "outcome": "success",
    "container": {
      "id": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
      "state": "purchased",
      "formulation_expires_at": "2028-06-12",
      "formulation_months_remaining": 26
    },
    "product": {
      "product_name": "Macho 600 OD",
      "brand_name": "Agri-Sure",
      "company": "BASF Philippines",
      "active_ingredient": "Glyphosate",
      "concentration": "480 g/L",
      "formulation_type": "SC",
      "type": "HERBICIDE",
      "category": "3",
      "fpa_registration_number": "K-1234",
      "fpa_registration_expires_at": "2028-12-31",
      "fpa_status": "valid",
      "mode_of_entry": "SYSTEMIC",
      "mode_of_action_group": "HRAC Group 9",
      "dosage_rate": "2-3 L/ha",
      "pre_harvest_interval": "21 days",
      "re_entry_period": "24 hours",
      "note_to_physician": "Induce vomiting; administer activated charcoal.",
      "registered_crops": [
        { "crop": "Rice", "pests": "Barnyard grass, Echinochloa" },
        { "crop": "Corn", "pests": "Broadleaf weeds" },
        { "crop": "Sugarcane", "pests": "Grasses" }
      ]
    },
    "message": "i18n:scan.purchase.farmer_confirmed",
    "rewards_credited": null,
    "fpa_warning": false,
    "pending_expires_at": null
  },
  "meta": { "request_id": "req_scan_002" }
}
```

#### Outcome: `success` (return_dealer)

HTTP 200

```json
{
  "data": {
    "outcome": "success",
    "container": {
      "id": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
      "state": "returned"
    },
    "product": null,
    "message": "i18n:scan.return.dealer_confirmed",
    "rewards_credited": null,
    "fpa_warning": false,
    "pending_expires_at": "2026-04-24T12:05:13+08:00"
  },
  "meta": { "request_id": "req_scan_003" }
}
```

#### Outcome: `success` (return_farmer)

HTTP 200

```json
{
  "data": {
    "outcome": "success",
    "container": {
      "id": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
      "state": "rewards_paid"
    },
    "product": null,
    "message": "i18n:scan.return.rewards_paid",
    "rewards_credited": {
      "farmer_points": 100,
      "dealer_points": 50
    },
    "fpa_warning": false,
    "pending_expires_at": null
  },
  "meta": { "request_id": "req_scan_004" }
}
```

#### Error Outcomes

| HTTP | `outcome` | When | Client Action |
|------|-----------|------|---------------|
| 401 | `hmac_invalid` | HMAC verification failed | Show counterfeit warning (red screen) |
| 401 | `auth_required` | Missing/expired JWT | Redirect to login |
| 403 | `fpa_blocked` | Dealer purchase scan on FPA-expired product | Hard block — "FPA registration expired" |
| 409 | `already_claimed` | Concurrent offline claim lost race | "Already claimed by another customer" |
| 410 | `window_expired` | 60-min window elapsed, offline criteria not met | "Ask dealer to re-initiate" |
| 422 | `state_mismatch` | Container not in expected state for this step | Context-specific message |
| 422 | `condition_rejected` | `return_dealer` without `condition_confirmed=true` | Re-prompt dealer for condition check |
| 422 | `product_draft` | Safety fields unconfirmed on the product | "Product registration pending" |
| 429 | `rate_limited` | 10+ invalid HMAC attempts per UUID per hour | Back off |

**Error response example (hmac_invalid):**

```json
{
  "error": {
    "code": "hmac_invalid",
    "message": "i18n:errors.hmac_invalid",
    "details": {},
    "request_id": "req_scan_005"
  }
}
```

**Idempotency:** Not natively idempotent (each call is a real side effect). Deduplication: the server checks `scan_attempts` for a matching `(device_id, container_id, step, local_scan_ts)` row created within the last 10 minutes. If found, the server returns the same outcome without re-executing the state transition. This handles mobile retries after a 200 response lost in transit.

**Processing Order:**
1. Zod-validate request body
2. HMAC verify (`crypto.timingSafeEqual`) — reject immediately on mismatch
3. JWT verify — reject on failure
4. Resolve container by UUID
5. Lazy-delete any expired `pending_purchase` / `pending_return_reward`
6. Branch by `step` — execute state machine

---

## 7. Endpoints — Products

### 7.1 List Products

```
GET /api/products
```

**Auth:** Required. `gabs_admin` and `brand_admin` see all; `dealer` and `farmer` see only `status = 'active'`.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | — | Pagination cursor |
| `limit` | integer | No | 20 | Items per page (1–100) |
| `status` | string | No | — | Filter by `draft` \| `active` \| `suspended` |
| `type` | string | No | — | Filter by product_type enum |
| `formulation_type` | string | No | — | Filter by formulation_type enum |
| `company` | string | No | — | Partial match on company name |
| `search` | string | No | — | pg_trgm search across `product_name`, `company`, `active_ingredient` |

**Response (200):**

```json
{
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "product_name": "Macho 600 OD",
      "company": "BASF Philippines",
      "active_ingredient": "Glyphosate",
      "concentration": "480 g/L",
      "formulation_type": "SC",
      "type": "HERBICIDE",
      "category": "3",
      "fpa_registration_number": "K-1234",
      "fpa_registration_expires_at": "2028-12-31",
      "status": "active",
      "updated_at": "2026-04-20T08:30:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJjIjoiMjAyNi0wNC0yMFQwODozMDowMFoiLCJpIjoiYTFiMmMzZDQifQ==",
    "has_more": true
  },
  "meta": { "request_id": "req_prod_001" }
}
```

### 7.2 Get Product

```
GET /api/products/{id}
```

**Auth:** Required. Same visibility rules as list.

**Response (200):**

```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "product_name": "Macho 600 OD",
    "brand_name": "Agri-Sure",
    "company": "BASF Philippines",
    "active_ingredient": "Glyphosate",
    "concentration": "480 g/L",
    "formulation_type": "SC",
    "type": "HERBICIDE",
    "category": "3",
    "fpa_registration_number": "K-1234",
    "fpa_registration_expires_at": "2028-12-31",
    "fpa_last_imported_at": "2026-04-01T00:00:00Z",
    "mode_of_entry": "SYSTEMIC",
    "mode_of_action_group": "HRAC Group 9",
    "dosage_rate": "2-3 L/ha",
    "mrl": "0.1 mg/kg",
    "pre_harvest_interval": "21 days",
    "re_entry_period": "24 hours",
    "distributor": "BASF PH Distribution",
    "formulated_by": "BASF SE",
    "imported_by": null,
    "timing_of_application": "Post-emergence",
    "note_to_physician": "Induce vomiting; administer activated charcoal.",
    "pests": "Barnyard grass, broadleaf weeds",
    "status": "active",
    "category_confirmed_by": "user-uuid-123",
    "category_confirmed_at": "2026-04-15T10:00:00Z",
    "note_to_physician_confirmed_by": "user-uuid-123",
    "note_to_physician_confirmed_at": "2026-04-15T10:02:00Z",
    "label_image_storage_path": "labels/a1b2c3d4/1714000000.jpg",
    "crops": [
      { "id": "crop-1", "crop": "Rice", "pests": "Barnyard grass" },
      { "id": "crop-2", "crop": "Corn", "pests": "Broadleaf weeds" }
    ],
    "created_at": "2026-04-01T00:00:00Z",
    "updated_at": "2026-04-20T08:30:00Z"
  },
  "meta": { "request_id": "req_prod_002" }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `NOT_FOUND` | Product does not exist or not visible to role |

### 7.3 Update Product

```
PATCH /api/products/{id}
```

**Auth:** Required. `gabs_admin` only. `brand_admin` can update own products (where `company` matches their manufacturer account).

**Request Body:** Partial update — only include fields to change.

```json
{
  "mode_of_action_group": "HRAC Group 9",
  "timing_of_application": "Post-emergence, 2-3 leaf stage"
}
```

**Response (200):** Updated product object (same shape as GET).

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 403 | `FORBIDDEN` | Insufficient role |
| 404 | `NOT_FOUND` | Product not found |
| 422 | `UNPROCESSABLE` | Cannot set `status = 'active'` without confirmed safety fields |

### 7.4 Import FPA Spreadsheet

```
POST /api/products/import-fpa
```

**Auth:** Required. `gabs_admin` only.

**Content-Type:** `multipart/form-data`

**Request:** Single `.xlsx` file, max 50MB.

**Response (200):**

```json
{
  "data": {
    "inserted": 4823,
    "updated": 312,
    "skipped": 45,
    "errors": [
      { "row": 1247, "reason": "Unparseable EXPIRY DATE: 'TBD'" },
      { "row": 8901, "reason": "Empty REGISTRATION NO." }
    ],
    "file_hash": "sha256:a3f9b2c1d4e5..."
  },
  "meta": { "request_id": "req_fpa_001" }
}
```

**Behavior:**
- Parses sheet `'LIST'`, header row index 5, data starts row 6.
- Converts Excel date serials to ISO dates: `(serial - 25569) * 86400` → Unix → ISO.
- Groups by `REGISTRATION NO.`, one product per unique registration.
- Upserts via `ON CONFLICT (fpa_registration_number) DO UPDATE`.
- Preserves OCR-sourced fields (`note_to_physician`, `brand_name`, `distributor`, `formulated_by`, `imported_by`, `mode_of_action_group`) on conflict — does not overwrite.
- Processes in 500-row batches.
- SHA256 short-circuit: if file hash matches last import, returns immediately with `{ inserted: 0, updated: 0, skipped: 0, errors: [], file_hash: "..." }`.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_INPUT` | Not an .xlsx file or exceeds 50MB |
| 403 | `FORBIDDEN` | Non-gabs_admin role |

**Timeout:** 180s (Vercel Pro `maxDuration`).

### 7.5 OCR Label Extraction

```
POST /api/products/ocr
```

**Auth:** Required. `gabs_admin` only.

**Content-Type:** `multipart/form-data`

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label_image` | file | Yes | JPEG/PNG/WEBP, max 10MB |
| `product_id` | string (UUID) | No | Existing product to enrich |

**Response (202 Accepted):**

```json
{
  "data": {
    "job_id": "ocr_job_7f3a9b2c",
    "status": "processing",
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  },
  "meta": { "request_id": "req_ocr_001" }
}
```

**Rationale for 202:** Vision LLM latency is 3–15 seconds. Synchronous response would risk HTTP timeouts, especially under load. The client polls for results.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_INPUT` | Invalid file type or exceeds 10MB |
| 403 | `FORBIDDEN` | Non-gabs_admin role |
| 429 | `RATE_LIMITED` | 10+ OCR requests per minute |

### 7.6 Poll OCR Job

```
GET /api/products/ocr-jobs/{job_id}
```

**Auth:** Required. `gabs_admin` only.

**Response — Job Processing (200):**

```json
{
  "data": {
    "job_id": "ocr_job_7f3a9b2c",
    "status": "processing",
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  },
  "meta": { "request_id": "req_ocr_002" }
}
```

**Response — Job Complete (200):**

```json
{
  "data": {
    "job_id": "ocr_job_7f3a9b2c",
    "status": "completed",
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "fields": {
      "brand_name": { "value": "Agri-Sure", "confidence": "extracted" },
      "distributor": { "value": "BASF PH Distribution", "confidence": "extracted" },
      "formulated_by": { "value": "BASF SE", "confidence": "extracted" },
      "imported_by": { "value": null, "confidence": "not_found" },
      "timing_of_application": { "value": "Post-emergence", "confidence": "extracted" },
      "note_to_physician": { "value": "Induce vomiting; administer activated charcoal.", "confidence": "extracted" },
      "mode_of_action_group": { "value": "HRAC Group 9", "confidence": "extracted" },
      "concentration": { "value": "480 g/L", "confidence": "extracted" },
      "active_ingredient": { "value": "Glyphosate", "confidence": "extracted" },
      "dosage_rate": { "value": "2-3 L/ha", "confidence": "extracted" },
      "pre_harvest_interval": { "value": "21 days", "confidence": "extracted" },
      "re_entry_period": { "value": "24 hours", "confidence": "extracted" },
      "product_name": { "value": "Macho 600 OD", "confidence": "extracted" },
      "company": { "value": "BASF Philippines", "confidence": "extracted" }
    },
    "null_count": 1,
    "provider": "gemini"
  },
  "meta": { "request_id": "req_ocr_003" }
}
```

**Response — Job Failed (200):**

```json
{
  "data": {
    "job_id": "ocr_job_7f3a9b2c",
    "status": "failed",
    "failure_reason": "ocr_timeout",
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  },
  "meta": { "request_id": "req_ocr_004" }
}
```

**Possible `status` values:** `processing` | `completed` | `failed`

**Possible `failure_reason` values:** `ocr_timeout` | `ocr_rate_limited` | `ocr_parse_failed` | `ocr_unavailable`

**Polling recommendation:** Client polls every 2 seconds for up to 30 seconds. After 30 seconds, show "Extraction taking longer than expected — you can fill fields manually."

**Alternative (Supabase Realtime):** Clients can subscribe to `ocr_jobs` table changes via Supabase Realtime instead of polling. The table row updates from `processing` → `completed` / `failed`.

### 7.7 Confirm OCR Results (Safety Gate)

```
POST /api/products/ocr/confirm
```

**Auth:** Required. `gabs_admin` only.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product_id` | string (UUID) | Yes | Target product |
| `fields` | object | Yes | Operator-reviewed field values (all 14 OCR fields) |
| `category_confirmed` | boolean | Yes | Must be `true` |
| `note_to_physician_confirmed` | boolean | Yes | Must be `true` |

**Example Request:**

```json
{
  "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "fields": {
    "brand_name": "Agri-Sure",
    "distributor": "BASF PH Distribution",
    "formulated_by": "BASF SE",
    "imported_by": null,
    "timing_of_application": "Post-emergence",
    "note_to_physician": "Induce vomiting; administer activated charcoal.",
    "mode_of_action_group": "HRAC Group 9",
    "concentration": "480 g/L",
    "active_ingredient": "Glyphosate",
    "dosage_rate": "2-3 L/ha",
    "pre_harvest_interval": "21 days",
    "re_entry_period": "24 hours",
    "product_name": "Macho 600 OD",
    "company": "BASF Philippines"
  },
  "category_confirmed": true,
  "note_to_physician_confirmed": true
}
```

**Response (200):**

```json
{
  "data": {
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "active",
    "category_confirmed_at": "2026-04-24T14:30:00Z",
    "note_to_physician_confirmed_at": "2026-04-24T14:30:00Z"
  },
  "meta": { "request_id": "req_ocr_005" }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_FAILED` | `category_confirmed` or `note_to_physician_confirmed` is missing or `false` |
| 404 | `NOT_FOUND` | Product not found |

---

## 8. Endpoints — Containers

### 8.1 List Containers

```
GET /api/containers
```

**Auth:** Required. `gabs_admin` sees all. `dealer` sees own (where `dealer_id` or `return_dealer_id` matches). `farmer` sees own (where `purchased_by_user_id` matches).

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | — | Pagination cursor |
| `limit` | integer | No | 20 | Items per page (1–100) |
| `product_id` | string (UUID) | No | — | Filter by product |
| `state` | string | No | — | Filter by container_state enum |
| `batch_number` | string | No | — | Filter by batch |
| `dealer_id` | string (UUID) | No | — | Filter by sale dealer |

**Response (200):**

```json
{
  "data": [
    {
      "id": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
      "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "product_name": "Macho 600 OD",
      "batch_number": "BATCH-2026-04-A",
      "state": "in_distribution",
      "manufacture_date": "2026-04-01",
      "formulation_expires_at": "2028-04-01",
      "created_at": "2026-04-10T08:00:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJjIjoiMjAyNi0wNC0xMCIsImkiOiJjNmU0YjJmMyJ9",
    "has_more": true
  },
  "meta": { "request_id": "req_cont_001" }
}
```

### 8.2 Get Container

```
GET /api/containers/{id}
```

**Auth:** Required. Same visibility rules as list. Includes full scan history.

**Response (200):**

```json
{
  "data": {
    "id": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "product_name": "Macho 600 OD",
    "hmac": "bf2a8c16b30e7e9f4a2d...",
    "batch_number": "BATCH-2026-04-A",
    "manufacture_date": "2026-04-01",
    "formulation_expires_at": "2028-04-01",
    "state": "purchased",
    "purchased_by_user_id": "farmer-uuid-456",
    "dealer_id": "dealer-uuid-789",
    "return_dealer_id": null,
    "purchased_at": "2026-04-24T11:05:13Z",
    "returned_at": null,
    "rewards_paid_at": null,
    "scan_history": [
      {
        "id": "scan-001",
        "step": "purchase_dealer",
        "outcome": "success",
        "actor_type": "dealer",
        "sync_delayed": false,
        "created_at": "2026-04-24T11:00:00Z"
      },
      {
        "id": "scan-002",
        "step": "purchase_farmer",
        "outcome": "success",
        "actor_type": "farmer",
        "sync_delayed": false,
        "created_at": "2026-04-24T11:05:13Z"
      }
    ],
    "created_at": "2026-04-10T08:00:00Z",
    "updated_at": "2026-04-24T11:05:13Z"
  },
  "meta": { "request_id": "req_cont_002" }
}
```

**Note:** `hmac` field is only visible to `gabs_admin`. Dealer and farmer responses omit it.

### 8.3 Generate Container Batch

```
POST /api/containers/generate
```

**Auth:** Required. `gabs_admin` only.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product_id` | string (UUID) | Yes | Must reference an `active` product |
| `batch_number` | string | Yes | Batch identifier |
| `manufacture_date` | string (ISO date) | Yes | e.g., `"2026-04-01"` |
| `quantity` | integer | Yes | 1–10,000 |

**Example Request:**

```json
{
  "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "batch_number": "BATCH-2026-04-A",
  "manufacture_date": "2026-04-01",
  "quantity": 100
}
```

**Response (201):**

```json
{
  "data": {
    "batch_number": "BATCH-2026-04-A",
    "product_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "quantity": 100,
    "containers": [
      {
        "uuid": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
        "url": "https://gaia.ph/scan/c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22.bf2a8c16b30e7e9f"
      },
      {
        "uuid": "d7f5c3g4-8f93-5b62-0d3b-4c9b2g1d6f33",
        "url": "https://gaia.ph/scan/d7f5c3g4-8f93-5b62-0d3b-4c9b2g1d6f33.c93b7d27e41f8a0g"
      }
    ]
  },
  "meta": { "request_id": "req_gen_001" }
}
```

**Note:** Response truncated for readability. Actual response contains all `quantity` containers.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_FAILED` | `quantity` out of range, missing fields |
| 400 | `INVALID_INPUT` | Product is `draft` or `suspended` |
| 403 | `FORBIDDEN` | Non-gabs_admin role |
| 404 | `NOT_FOUND` | Product not found |

### 8.4 Export Labels

```
POST /api/containers/export-labels
```

**Auth:** Required. `gabs_admin` only.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `container_ids` | string[] (UUID[]) | Yes | Container UUIDs to export |
| `format` | string | Yes | `pdf` \| `zpl` |

**Example Request:**

```json
{
  "container_ids": [
    "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
    "d7f5c3g4-8f93-5b62-0d3b-4c9b2g1d6f33"
  ],
  "format": "pdf"
}
```

**Response (200):** Binary file download.

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="labels-BATCH-2026-04-A-2026-04-24.pdf"
```

Each label (4x6 inch) contains: QR code (300x300px encoding scan URL), product name, company, active ingredient, concentration, formulation type, FPA registration number, FPA expiry, batch number, manufacture date, formulation expiry, PHI, re-entry period, toxicity category symbol.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_FAILED` | Empty `container_ids` array or invalid `format` |
| 403 | `FORBIDDEN` | Non-gabs_admin role |
| 404 | `NOT_FOUND` | One or more container IDs not found |

---

## 9. Endpoints — Dealers

### 9.1 List Dealers

```
GET /api/dealers
```

**Auth:** Required. `gabs_admin` sees all. `dealer` cannot list other dealers. `farmer` cannot access.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | — | Pagination cursor |
| `limit` | integer | No | 20 | Items per page (1–100) |
| `is_verified` | boolean | No | — | Filter by verification status |

**Response (200):**

```json
{
  "data": [
    {
      "id": "dealer-uuid-789",
      "user_id": "auth-user-uuid",
      "business_name": "Agri-Parts Tarlac",
      "territory_notes": "Central Luzon — Tarlac, Pangasinan",
      "is_verified": true,
      "verified_at": "2026-04-15T10:00:00Z",
      "created_at": "2026-04-10T08:00:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJjIjoiMjAyNi0wNC0xMCIsImkiOiJkZWFsZXItdXVpZC03ODkifQ==",
    "has_more": false
  },
  "meta": { "request_id": "req_dealer_001" }
}
```

### 9.2 Get Dealer

```
GET /api/dealers/{id}
```

**Auth:** Required. `gabs_admin` sees any. `dealer` sees own only.

**Response (200):** Same shape as list item, plus `updated_at`.

### 9.3 Verify Dealer

```
PATCH /api/dealers/{id}/verify
```

**Auth:** Required. `gabs_admin` only.

**Request Body:** None required.

**Response (200):**

```json
{
  "data": {
    "id": "dealer-uuid-789",
    "is_verified": true,
    "verified_by": "admin-user-uuid",
    "verified_at": "2026-04-24T15:00:00Z"
  },
  "meta": { "request_id": "req_dealer_002" }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `NOT_FOUND` | Dealer not found |
| 409 | `CONFLICT` | Dealer already verified |

### 9.4 Invite Dealer

```
POST /api/dealers/invite
```

**Auth:** Required. `gabs_admin` only.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Dealer's email address |
| `business_name` | string | Yes | Dealer business name |
| `territory_notes` | string | No | Territory description |

**Example Request:**

```json
{
  "email": "dealer@agriparts.ph",
  "business_name": "Agri-Parts Tarlac",
  "territory_notes": "Central Luzon — Tarlac, Pangasinan"
}
```

**Response (201):**

```json
{
  "data": {
    "id": "dealer-uuid-new",
    "email": "dealer@agriparts.ph",
    "business_name": "Agri-Parts Tarlac",
    "is_verified": false,
    "invite_sent": true
  },
  "meta": { "request_id": "req_dealer_003" }
}
```

Sends a Supabase Auth magic-link invite to the email. On first login, the user's `user_profiles.role` is set to `dealer` and a `dealer_accounts` row is created.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 409 | `CONFLICT` | Email already registered |

---

## 10. Endpoints — Wallets

### 10.1 Get My Wallet

```
GET /api/wallets/me
```

**Auth:** Required. Any authenticated user.

**Response (200):**

```json
{
  "data": {
    "id": "wallet-uuid-001",
    "user_id": "farmer-uuid-456",
    "balance_points": 350,
    "transactions": [
      {
        "id": "tx-001",
        "container_id": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
        "points": 100,
        "description": "Return reward — Macho 600 OD",
        "created_at": "2026-04-24T12:00:00Z"
      },
      {
        "id": "tx-002",
        "container_id": "d7f5c3g4-8f93-5b62-0d3b-4c9b2g1d6f33",
        "points": 100,
        "description": "Return reward — Shield 500 EC",
        "created_at": "2026-04-22T09:30:00Z"
      }
    ],
    "vouchers": [
      {
        "id": "voucher-001",
        "points_cost": 500,
        "discount_value": 50.00,
        "description": "PHP 50 discount at participating dealers",
        "redeemed": false,
        "expires_at": "2026-07-24T23:59:59Z"
      }
    ],
    "updated_at": "2026-04-24T12:00:00Z"
  },
  "meta": { "request_id": "req_wallet_001" }
}
```

**Note:** `transactions` returns the 20 most recent by default. For full history, use `GET /api/wallets/me/transactions` with cursor pagination.

### 10.2 List Wallet Transactions

```
GET /api/wallets/me/transactions
```

**Auth:** Required. Returns own transactions only. `gabs_admin` can use `GET /api/wallets/{user_id}/transactions` to view any user's transactions.

**Query Parameters:** Standard cursor pagination (`cursor`, `limit`).

**Response (200):** Paginated transaction list.

### 10.3 Redeem Voucher

```
POST /api/wallets/redeem
```

**Auth:** Required. Any authenticated user with sufficient balance.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `voucher_type_id` | string (UUID) | Yes | Voucher type to redeem |

**Response (201):**

```json
{
  "data": {
    "voucher_id": "voucher-002",
    "points_deducted": 500,
    "new_balance": 150,
    "discount_value": 50.00,
    "expires_at": "2026-07-24T23:59:59Z",
    "qr_data": "voucher:voucher-002"
  },
  "meta": { "request_id": "req_redeem_001" }
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_FAILED` | Invalid voucher type |
| 422 | `UNPROCESSABLE` | Insufficient balance |

### 10.4 Get Wallet (Admin)

```
GET /api/wallets/{user_id}
```

**Auth:** Required. `gabs_admin` only.

**Response (200):** Same shape as `GET /api/wallets/me`.

---

## 11. Endpoints — Scan History

### 11.1 My Scan History (Farmer)

```
GET /api/scans/me
```

**Auth:** Required. Returns the authenticated user's scan attempts.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | — | Pagination cursor |
| `limit` | integer | No | 20 | Items per page (1–100) |
| `step` | string | No | — | Filter by scan step |

**Response (200):**

```json
{
  "data": [
    {
      "id": "scan-002",
      "container_id": "c6e4b2f3-7e92-4a51-9c2a-3b8a1f0c5e22",
      "step": "purchase_farmer",
      "outcome": "success",
      "product_name": "Macho 600 OD",
      "sync_delayed": false,
      "created_at": "2026-04-24T11:05:13Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJjIjoiMjAyNi0wNC0yNCIsImkiOiJzY2FuLTAwMiJ9",
    "has_more": false
  },
  "meta": { "request_id": "req_history_001" }
}
```

### 11.2 Scan Attempts (CRM Forensics)

```
GET /api/scan-attempts
```

**Auth:** Required. `gabs_admin` sees all. `dealer` sees own (`actor_id` matches).

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | string | No | — | Pagination cursor |
| `limit` | integer | No | 20 | Items per page (1–100) |
| `outcome` | string | No | — | Filter by scan_outcome enum |
| `container_id` | string (UUID) | No | — | Filter by container |
| `actor_id` | string (UUID) | No | — | Filter by actor |
| `sync_delayed` | boolean | No | — | Filter for offline-synced scans |
| `date_from` | string (ISO date) | No | — | Filter by `created_at >= date_from` |
| `date_to` | string (ISO date) | No | — | Filter by `created_at <= date_to` |

**Response (200):**

```json
{
  "data": [
    {
      "id": "scan-005",
      "container_id": null,
      "actor_id": "unknown-user-uuid",
      "actor_type": "farmer",
      "step": "purchase_farmer",
      "outcome": "hmac_invalid",
      "hmac_valid": false,
      "auth_valid": true,
      "ip_address": "203.177.xxx.xxx",
      "local_scan_ts": "2026-04-24T14:00:00+08:00",
      "sync_ts": "2026-04-24T14:00:01Z",
      "device_id": "expo:android:a52:unknown",
      "sync_delayed": false,
      "created_at": "2026-04-24T14:00:01Z"
    }
  ],
  "pagination": {
    "next_cursor": "...",
    "has_more": true
  },
  "meta": { "request_id": "req_forensics_001" }
}
```

### 11.3 Export Scan Attempts (CSV)

```
GET /api/scan-attempts/export
```

**Auth:** Required. `gabs_admin` only.

**Query Parameters:** Same filters as `GET /api/scan-attempts` (no cursor/limit — exports all matching rows).

**Response (200):** CSV file download.

```
Content-Type: text/csv
Content-Disposition: attachment; filename="scan-attempts-2026-04-01-to-2026-04-24.csv"
```

Columns: `timestamp`, `container_uuid`, `product_name`, `fpa_registration_number`, `actor_type`, `outcome`, `step`, `sync_delayed`, `ip_address`.

---

## 12. Endpoints — Reward Config

### 12.1 Get Reward Config

```
GET /api/reward-config
```

**Auth:** Required. Any authenticated role.

**Response (200):**

```json
{
  "data": {
    "farmer_points_per_return": 100,
    "dealer_points_per_return": 50,
    "updated_by": "admin-user-uuid",
    "updated_at": "2026-04-01T00:00:00Z"
  },
  "meta": { "request_id": "req_config_001" }
}
```

### 12.2 Update Reward Config

```
PATCH /api/reward-config
```

**Auth:** Required. `gabs_admin` only.

**Request Body:**

```json
{
  "farmer_points_per_return": 150,
  "dealer_points_per_return": 75
}
```

**Response (200):** Updated config object.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 403 | `FORBIDDEN` | Non-gabs_admin role |

---

## 13. Endpoints — Contact

### 13.1 Submit Contact Form

```
POST /api/contact
```

**Auth:** None required (public endpoint).

**Rate Limit:** 5 submissions per IP per hour.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Sender name (1–200 chars) |
| `email` | string | Yes | Valid email address |
| `company` | string | No | Company/organization |
| `message` | string | Yes | Message body (1–5000 chars) |

**Example Request:**

```json
{
  "name": "Maria Santos",
  "email": "maria@agriteam.ph",
  "company": "AgriTeam Philippines",
  "message": "We're interested in GAIA for our agrochemical distribution network. Can we schedule a demo?"
}
```

**Response (200):**

```json
{
  "data": {
    "submitted": true,
    "message": "i18n:contact.success"
  },
  "meta": { "request_id": "req_contact_001" }
}
```

Delivers email to `CONTACT_EMAIL` env var via Resend.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_FAILED` | Missing/invalid fields |
| 429 | `RATE_LIMITED` | 5+ submissions from this IP in the last hour |

---

## 14. OpenAPI 3.1 Appendix

```yaml
openapi: "3.1.0"
info:
  title: "GAIA — Agrochemical Traceability API"
  version: "1.0.0"
  description: >
    Surface-agnostic REST API for the GAIA platform. Handles QR-based container
    scanning (purchase + return), FPA product registry import, OCR label extraction,
    container batch generation, label export, wallet management, and compliance reporting.
  contact:
    name: "GAIA Engineering"

servers:
  - url: "https://crm.gaia.ph/api"
    description: "Production"
  - url: "https://crm-staging.gaia.ph/api"
    description: "Staging"

security:
  - SupabaseJWT: []

components:
  securitySchemes:
    SupabaseJWT:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: "Supabase-issued JWT. Obtain via Phone OTP (farmer) or email/password (CRM)."

  schemas:
    Error:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message, request_id]
          properties:
            code:
              type: string
              example: "VALIDATION_FAILED"
            message:
              type: string
              example: "i18n:errors.validation_failed"
            details:
              oneOf:
                - type: array
                  items:
                    type: object
                    properties:
                      field:
                        type: string
                      issue:
                        type: string
                - type: object
            request_id:
              type: string
              example: "req_abc123"

    Pagination:
      type: object
      properties:
        next_cursor:
          type: string
          nullable: true
          example: "eyJjIjoiMjAyNi0wNC0yNCIsImkiOiJhMWIyYzNkNCJ9"
        has_more:
          type: boolean

    ScanRequest:
      type: object
      required: [uuid, hmac, step, local_scan_ts, device_id, last_online_ts]
      properties:
        uuid:
          type: string
          format: uuid
        hmac:
          type: string
          minLength: 16
          maxLength: 16
          description: "First 16 hex characters of HMAC-SHA256"
        step:
          type: string
          enum: [purchase_dealer, purchase_farmer, return_dealer, return_farmer]
        local_scan_ts:
          type: string
          format: date-time
        device_id:
          type: string
        last_online_ts:
          type: string
          format: date-time
        condition_confirmed:
          type: boolean
          description: "Required and must be true for return_dealer step"

    ScanOutcome:
      type: string
      enum:
        - success
        - hmac_invalid
        - auth_required
        - fpa_blocked
        - already_claimed
        - window_expired
        - state_mismatch
        - condition_rejected
        - product_draft
        - rate_limited

    ContainerSummary:
      type: object
      properties:
        id:
          type: string
          format: uuid
        state:
          type: string
          enum: [in_distribution, pending_purchase, purchased, returned, rewards_paid]
        formulation_expires_at:
          type: string
          format: date
          nullable: true
        formulation_months_remaining:
          type: integer
          nullable: true

    ProductDetail:
      type: object
      properties:
        product_name:
          type: string
        brand_name:
          type: string
          nullable: true
        company:
          type: string
        active_ingredient:
          type: string
        concentration:
          type: string
          nullable: true
        formulation_type:
          type: string
          enum: [EC, SC, WP, WG, SL, GR, DP, ULV, OTHER]
          nullable: true
        type:
          type: string
          enum: [HERBICIDE, INSECTICIDE, FUNGICIDE, RODENTICIDE, NEMATICIDE, ACARICIDE, OTHER]
          nullable: true
        category:
          type: string
          enum: ["1", "2", "3", "4"]
          nullable: true
        fpa_registration_number:
          type: string
          nullable: true
        fpa_registration_expires_at:
          type: string
          format: date
          nullable: true
        fpa_status:
          type: string
          enum: [valid, expiring_soon, expired]
        mode_of_entry:
          type: string
          nullable: true
        mode_of_action_group:
          type: string
          nullable: true
        dosage_rate:
          type: string
          nullable: true
        pre_harvest_interval:
          type: string
          nullable: true
        re_entry_period:
          type: string
          nullable: true
        note_to_physician:
          type: string
          nullable: true
        registered_crops:
          type: array
          items:
            type: object
            properties:
              crop:
                type: string
              pests:
                type: string
                nullable: true

    RewardsCredit:
      type: object
      properties:
        farmer_points:
          type: integer
        dealer_points:
          type: integer

    ScanSuccessResponse:
      type: object
      properties:
        data:
          type: object
          required: [outcome, message]
          properties:
            outcome:
              $ref: "#/components/schemas/ScanOutcome"
            container:
              $ref: "#/components/schemas/ContainerSummary"
              nullable: true
            product:
              $ref: "#/components/schemas/ProductDetail"
              nullable: true
            message:
              type: string
            rewards_credited:
              $ref: "#/components/schemas/RewardsCredit"
              nullable: true
            fpa_warning:
              type: boolean
            pending_expires_at:
              type: string
              format: date-time
              nullable: true
        meta:
          type: object
          properties:
            request_id:
              type: string

paths:
  /scan:
    post:
      operationId: processScan
      summary: "Process a QR container scan"
      description: >
        Surface-agnostic scan endpoint. Handles all four scan steps:
        purchase_dealer, purchase_farmer, return_dealer, return_farmer.
        HMAC verification runs first. State transitions are atomic.
      tags: [Scan]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ScanRequest"
      responses:
        "200":
          description: "Scan processed successfully"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ScanSuccessResponse"
        "401":
          description: "HMAC invalid or auth required"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "403":
          description: "FPA blocked"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "409":
          description: "Already claimed"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "410":
          description: "Window expired"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "422":
          description: "State mismatch / condition rejected / product draft"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "429":
          description: "Rate limited (HMAC flood on UUID)"
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"

  /products:
    get:
      operationId: listProducts
      summary: "List products with filtering and pagination"
      tags: [Products]
      parameters:
        - name: cursor
          in: query
          schema: { type: string }
        - name: limit
          in: query
          schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
        - name: status
          in: query
          schema: { type: string, enum: [draft, active, suspended] }
        - name: type
          in: query
          schema: { type: string }
        - name: search
          in: query
          schema: { type: string }
      responses:
        "200":
          description: "Paginated product list"

  /products/{id}:
    get:
      operationId: getProduct
      summary: "Get product detail with crops"
      tags: [Products]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: "Product detail"
        "404":
          description: "Not found"
    patch:
      operationId: updateProduct
      summary: "Update product fields"
      tags: [Products]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: "Updated product"
        "403":
          description: "Forbidden"
        "404":
          description: "Not found"

  /products/import-fpa:
    post:
      operationId: importFPA
      summary: "Import FPA spreadsheet"
      description: "Upload .xlsx, batch-upsert products. gabs_admin only. 180s timeout."
      tags: [Products]
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                file:
                  type: string
                  format: binary
      responses:
        "200":
          description: "Import summary"
        "400":
          description: "Invalid file"
        "403":
          description: "Forbidden"

  /products/ocr:
    post:
      operationId: submitOCR
      summary: "Submit label image for OCR extraction"
      description: "Async. Returns 202 with job_id. Poll /products/ocr-jobs/{job_id}."
      tags: [Products]
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                label_image:
                  type: string
                  format: binary
                product_id:
                  type: string
                  format: uuid
      responses:
        "202":
          description: "Job accepted"
        "400":
          description: "Invalid file"
        "403":
          description: "Forbidden"

  /products/ocr-jobs/{job_id}:
    get:
      operationId: pollOCRJob
      summary: "Poll OCR job status"
      tags: [Products]
      parameters:
        - name: job_id
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: "Job status (processing / completed / failed)"

  /products/ocr/confirm:
    post:
      operationId: confirmOCR
      summary: "Confirm OCR results with safety gate"
      description: "Both category_confirmed and note_to_physician_confirmed must be true."
      tags: [Products]
      responses:
        "200":
          description: "Product activated"
        "400":
          description: "Safety flags missing"

  /containers:
    get:
      operationId: listContainers
      summary: "List containers with filtering"
      tags: [Containers]
      parameters:
        - name: cursor
          in: query
          schema: { type: string }
        - name: limit
          in: query
          schema: { type: integer, default: 20 }
        - name: product_id
          in: query
          schema: { type: string, format: uuid }
        - name: state
          in: query
          schema: { type: string }
        - name: batch_number
          in: query
          schema: { type: string }
      responses:
        "200":
          description: "Paginated container list"

  /containers/{id}:
    get:
      operationId: getContainer
      summary: "Get container detail with scan history"
      tags: [Containers]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: "Container detail"
        "404":
          description: "Not found"

  /containers/generate:
    post:
      operationId: generateContainers
      summary: "Generate a batch of QR containers"
      description: "gabs_admin only. Product must be active."
      tags: [Containers]
      responses:
        "201":
          description: "Generated containers with URLs"
        "400":
          description: "Product not active or quantity out of range"

  /containers/export-labels:
    post:
      operationId: exportLabels
      summary: "Export label PDF or ZPL for printing"
      tags: [Containers]
      responses:
        "200":
          description: "Binary file download"

  /dealers:
    get:
      operationId: listDealers
      summary: "List dealer accounts"
      tags: [Dealers]
      responses:
        "200":
          description: "Paginated dealer list"

  /dealers/{id}:
    get:
      operationId: getDealer
      summary: "Get dealer detail"
      tags: [Dealers]
      responses:
        "200":
          description: "Dealer detail"

  /dealers/{id}/verify:
    patch:
      operationId: verifyDealer
      summary: "Verify a dealer account"
      tags: [Dealers]
      responses:
        "200":
          description: "Dealer verified"

  /dealers/invite:
    post:
      operationId: inviteDealer
      summary: "Invite dealer via magic link"
      tags: [Dealers]
      responses:
        "201":
          description: "Invite sent"

  /wallets/me:
    get:
      operationId: getMyWallet
      summary: "Get current user's wallet balance and recent transactions"
      tags: [Wallets]
      responses:
        "200":
          description: "Wallet data"

  /wallets/me/transactions:
    get:
      operationId: listMyTransactions
      summary: "Paginated transaction history"
      tags: [Wallets]
      responses:
        "200":
          description: "Transaction list"

  /wallets/redeem:
    post:
      operationId: redeemVoucher
      summary: "Redeem points for a voucher"
      tags: [Wallets]
      responses:
        "201":
          description: "Voucher created"
        "422":
          description: "Insufficient balance"

  /wallets/{user_id}:
    get:
      operationId: getWalletAdmin
      summary: "Get any user's wallet (admin)"
      tags: [Wallets]
      security:
        - SupabaseJWT: []
      responses:
        "200":
          description: "Wallet data"

  /scans/me:
    get:
      operationId: myScanHistory
      summary: "Farmer's scan history"
      tags: [Scan History]
      responses:
        "200":
          description: "Paginated scan list"

  /scan-attempts:
    get:
      operationId: listScanAttempts
      summary: "CRM forensic scan log"
      tags: [Scan History]
      parameters:
        - name: outcome
          in: query
          schema: { type: string }
        - name: container_id
          in: query
          schema: { type: string, format: uuid }
        - name: date_from
          in: query
          schema: { type: string, format: date }
        - name: date_to
          in: query
          schema: { type: string, format: date }
      responses:
        "200":
          description: "Paginated scan attempts"

  /scan-attempts/export:
    get:
      operationId: exportScanAttempts
      summary: "Export scan attempts as CSV"
      tags: [Scan History]
      responses:
        "200":
          description: "CSV file download"

  /reward-config:
    get:
      operationId: getRewardConfig
      summary: "Get current reward point values"
      tags: [Config]
      responses:
        "200":
          description: "Reward config"
    patch:
      operationId: updateRewardConfig
      summary: "Update reward point values"
      tags: [Config]
      responses:
        "200":
          description: "Updated config"

  /contact:
    post:
      operationId: submitContact
      summary: "Website contact form"
      description: "Public endpoint. Rate limited 5/IP/hour."
      tags: [Contact]
      security: []
      responses:
        "200":
          description: "Submitted"
        "429":
          description: "Rate limited"
```

---

## 15. Decisions

Decisions made during API spec authoring. These propagate to downstream stages (UI design, build plan).

| # | Decision | Rationale / Alternative Rejected |
|---|---|---|
| API-01 | No URL version prefix in v1 (`/api/scan`, not `/api/v1/scan`) | Single-tenant, controlled clients. Add `/v1/` when v2 actually exists. Rejected: URL prefix from day 1 — premature for internal-only API. |
| API-02 | OCR extraction is async: `POST /api/products/ocr` returns 202, poll via `GET /api/products/ocr-jobs/{id}` | Vision LLM latency (3–15s) risks HTTP timeouts under load. Rejected: synchronous 200 response — blocks the client thread and risks Vercel function timeout. Alternative considered: Supabase Realtime subscription — documented as optional client-side optimization, not the primary contract. |
| API-03 | Scan dedup via `(device_id, container_id, step, local_scan_ts)` within 10-min window, not `Idempotency-Key` header | Natural key dedup requires no client-side key generation; mobile offline queue already captures all four fields. Rejected: `Idempotency-Key` — adds client complexity with no benefit over existing fields. |
| API-04 | Scan rate limit keyed on container UUID (10 invalid HMACs/UUID/hour), not on client IP | Per-UUID prevents enumeration attacks. Per-IP alone would let an attacker try different UUIDs from one IP without hitting the limit. Both limits apply (60/min/IP global + 10/UUID/hour for invalid HMACs). |
| API-05 | Cursor pagination for all list endpoints; cursor = opaque base64 of `(sort_key, id)` | Consistent, stable pagination. Rejected: offset-based — breaks on concurrent writes; keyset without opaque encoding — leaks sort internals to client. |
| API-06 | JSON field naming: `snake_case` throughout | Matches Postgres column names and Supabase-generated types. Rejected: camelCase — would require a transformation layer between DB and API for zero user benefit. |
| API-07 | Error response uses flat `error.code` string (not nested error object hierarchy) | Simpler for mobile parsing. The `details` field handles structured validation errors when needed. |
| API-08 | `GET /api/wallets/me` returns 20 most recent transactions inline; full history via separate paginated endpoint | Reduces round-trips for the common case (farmer checking balance + recent activity). Full history available when needed. |
| API-09 | `hmac` field in container detail visible to `gabs_admin` only | Prevents HMAC leakage through CRM read access. Dealers and farmers never see the full HMAC. |
| API-10 | Scan CSV export (`GET /api/scan-attempts/export`) has no cursor/limit — exports all matching rows | Compliance reports need complete data. Row count bounded by date range filter. Max expected: ~50k rows per month at scale. |
| API-11 | No public unauthenticated container lookup endpoint | QR URLs (`gaia.ph/scan/...`) resolve to the website (server-rendered page) or deep-link into the mobile app. Pre-claim metadata is not exposed via API — the scan endpoint itself is the only container interaction point. Deferred: if mobile needs pre-scan metadata, add `GET /api/containers/{uuid}/public` with minimal fields. |

---

## 16. Review Checklist

Running the API spec review checklist from `skills/api-spec/SKILL.md`:

- [x] **Consistent naming** — All endpoints use kebab-case URLs, snake_case JSON fields, plural resource names
- [x] **Standard HTTP usage** — GET for reads, POST for creates/actions, PATCH for partial updates; correct status codes throughout
- [x] **Error responses standardized** — Every endpoint documents errors with the same `{ error: { code, message, details, request_id } }` shape
- [x] **Pagination on lists** — All 7 list endpoints support cursor-based pagination with consistent request/response format
- [x] **Auth documented** — Every endpoint specifies role requirements; `/api/contact` explicitly marked as public
- [x] **Rate limits specified** — Global (60/min/IP), per-UUID HMAC flood (10/hour), contact form (5/IP/hour), OCR (10/min/user)
- [x] **Idempotency addressed** — Scan endpoint dedup via natural key `(device_id, container_id, step, local_scan_ts)` within 10-min window
- [x] **Versioning strategy** — No prefix in v1; documented deprecation policy for future v2
- [x] **Examples provided** — Every endpoint has at least one realistic request/response example with real-looking data
- [x] **Edge cases covered** — Empty results (pagination `has_more: false`), not found (404), concurrent claim (409 `already_claimed`), offline sync, FPA expiry blocking vs warning, draft product blocking
- [x] **No breaking changes** — N/A (new API)
- [x] **Descriptions rich enough for AI** — Every endpoint has summary + description; scan endpoint has full processing order documentation

All checks pass.

---

*API Reference — GAIA / GABI Steward 2.0*  
*Author: Ayanokoji · 2026-04-24*  
*Source: PRD v3 (53 decisions), TECH-SPEC-gaia-2026-04-24, tech-spec discussion*
