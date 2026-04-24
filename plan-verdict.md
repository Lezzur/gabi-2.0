# Barker Plan Evaluation

**Plan:** `/workspaces/tony-stark/barker-plan.md`
**Verdict:** REVISE
**Blocking issues:** 3
**Warnings:** 8

---

## Summary

The GAIA Barker build plan is architecturally excellent — 59 well-scoped tasks across 8 phases, every security-critical task correctly assigned to Opus, strong hardening requirements throughout, and a comprehensive validation block. Three targeted fixes are required before execution: a wrong filename in the Phase 2 phase gate, a missing `POST /api/wallet/redeem` API route (the mobile wallet screen's primary CTA has no backend), and a container generation task that inserts containers with `state='in_manufacturing'` — a value that does not exist in the `container_state` enum per the PRD and tech spec. None of these require restructuring the plan.

---

## Structural Integrity

| Check | Result | Notes |
|-------|--------|-------|
| YAML validity | PASS | Valid YAML fenced block; all required fields present |
| Task identity | PASS | 59 unique kebab-case IDs, all prefixed with phase number; all required fields present |
| Dependency graph | PASS | All `depends_on` references valid; no circular or self-references; `p1-monorepo: []` is the entry point; all cross-phase dependencies are forward |
| Context sources | PASS | All aliases (`prd`, `tech-spec`, `api-spec`, `ui-design`) match `input_files` definitions |
| Validation block | PASS | `checks` non-empty; `fix_budget: 5`; build, typecheck, lint, test all present; hardening audit in `prompt` |

---

## Build Quality

| Check | Result | Severity | Notes |
|-------|--------|----------|-------|
| Model assignment | PASS | — | All security-critical tasks (HMAC, RLS, auth hook, atomic claim, phone OTP, OCR safety gate, offline queue) are Opus. Sonnet used for CRUD, scaffolding, and UI. `p5-shared-scan-card` assigned Opus for cross-platform countdown timer logic — borderline; Sonnet could handle it, but Opus is not wrong. |
| Task granularity | PASS | — | All `estimated_minutes` between 5–30. No prompt exceeds ~40 lines. `p7-homepage-sections` has 6 expected files (at the guideline limit) but the scope (5 marketing section components) is bounded. |
| Prompt quality | PASS | — | All prompts are self-contained. `p3-scan-route` explicitly instructs the builder to read all helper files first. No "run tests" or "verify it works" language in build prompts. BP-13 honored. |
| Hardening coverage | PASS | — | Every business-logic task has a `Hardening requirements` section with specific directives. Auth, RLS, HMAC, atomic claim, and OCR safety gate prompts are thorough. Minor gap: `p5-dealers-page` doesn't handle Resend failure on invite send. |
| Validation block | PASS | — | Build + typecheck + lint + test all present. Hardening audit covers scan API, every route, RLS, UI states, offline queue, spec file existence, secrets, TODO/FIXME. Warning: `context_sources` for api-spec covers only sections 2, 4, 6 — validation Opus won't see products (§7), containers (§8), dealers (§9), wallet (§10), scan history (§11), reward config (§12). |
| File conflicts | PASS | — | No two parallel tasks share `expected_files`. Migration filenames are sequentially numbered and task-unique. `package.json` is modified by both `p2-typegen` and `p8-test-infra`, but since phase ordering is enforced by Barker's phase gates, these run sequentially. |
| Done/phase checks | **FAIL** | **Blocking** | Phase 2 `phase_check` references `supabase/migrations/0002_rls.sql` but the actual RLS migration created by `p2-rls` is `0003_rls.sql`. The file `0002_rls.sql` will never exist (that number belongs to `0002_aux.sql` from `p2-schema-aux`). The Phase 2 gate will always fail even when all migrations are correctly generated. |

---

## Spec Alignment

| Spec | Result | Coverage | Gaps |
|------|--------|----------|------|
| PRD | PASS/WARN | 10/10 phases have corresponding tasks | Minor: no explicit manual-entry product creation path (only OCR + FPA import). If PRD's "manual CRM entry" requirement means a blank product form, there's no task for it. OCR confirm creates products at `status='draft'` only. |
| Tech Spec | PASS/WARN | Architecture decisions TS-01 through TS-12 addressed | `@tanstack/react-query` (TS-09) not added to any scaffold (`p3-crm-scaffold`, `p6-expo-scaffold`). TS-12 (FPA SHA256 short-circuit on re-upload) not implemented in `p4-fpa-route`. `p4-fpa-parser` uses `exceljs` but tech-spec §4.2 specifies `xlsx` library (both valid, but inconsistent). |
| API Spec | **FAIL** | Missing 1 required endpoint | `POST /api/wallet/redeem` (§10.3) is not in any task's `expected_files`. The mobile wallet screen (`p6-wallet-screen`) calls this endpoint as its primary CTA, but no task creates the backend route. Additionally, `GET /api/scans/me` (§11.1), referenced by `p6-history-screen`, has no corresponding API route task — this may be acceptable if mobile uses direct Supabase queries with RLS, but it is an ambiguity. |
| UI Design | PASS/WARN | ~42/40+ screens covered across 3 surfaces | `p5-dealers-page`, `p5-wallet-admin`, and `p5-reports` do not reference `ui-design` context_sources — builders won't follow screen designs for dealer management, wallet admin, and reports pages. `p5-products-detail` references `C1` (list page) instead of `C2` (detail page) in `context_sources`. Website screens W2–W4, W6 are not explicitly referenced; homepage sections task may cover them if they are scroll sections rather than separate routes. |

---

## Blocking Issues

**1. Phase 2 `phase_check` references the wrong migration filename.**

```yaml
# current (broken)
phase_check: "test -f supabase/migrations/0001_init.sql && test -f supabase/migrations/0002_rls.sql"

# correct
phase_check: "test -f supabase/migrations/0001_init.sql && test -f supabase/migrations/0003_rls.sql"
```

The migrations created by Phase 2 tasks are:
- `0001_init.sql` → `p2-schema-core`
- `0002_aux.sql` → `p2-schema-aux`
- `0003_rls.sql` → `p2-rls`
- `0004_auth_hook.sql` → `p2-auth-hook`

The phase gate checks for `0002_rls.sql` which will never exist. Fix: change `0002_rls.sql` to `0003_rls.sql`.

---

**2. `POST /api/wallet/redeem` API route is missing from the plan.**

`p6-wallet-screen` calls `POST /api/wallet/redeem` (api-spec §10.3) to redeem points for a voucher. This is a server-side write operation requiring: balance check against `wallets.balance_points`, voucher record creation, and wallet debit — it cannot be a direct Supabase client query without service-role logic.

No task in the plan creates `apps/crm/app/api/wallet/redeem/route.ts` or equivalent. The mobile wallet's redeem flow — the feature's primary value-exchange moment — has no backend implementation.

Fix: Add a new task (e.g., `p5-wallet-redeem`) after `p5-wallet-admin`:

```yaml
- id: "p5-wallet-redeem"
  name: "POST /api/wallet/redeem route"
  model: "opus"
  depends_on: ["p2-typegen", "p3-crm-scaffold"]
  estimated_minutes: 20
  context_sources:
    - alias: "api-spec"
      sections: ["10.3"]
    - alias: "tech-spec"
      sections: ["4.3", "4.4"]
  prompt: |
    Build `apps/crm/app/api/wallet/redeem/route.ts`.
    
    Accepts { denomination: VoucherDenomination }. Validates that the authenticated user's
    wallet has sufficient balance. Creates a voucher record and debits the wallet atomically
    via a single Postgres RPC (extend 0006_wallet_rpc.sql or create 0012_redeem_rpc.sql).
    
    Hardening requirements:
    - Auth required (farmer role)
    - Atomic: balance check + voucher insert + wallet debit in one transaction
    - Race condition: use SELECT ... FOR UPDATE on the wallet row before debit
    - Return 402 INSUFFICIENT_BALANCE if balance_points < denomination cost
    - Voucher code is UUID v4, shown exactly once in response; stored in vouchers table for history
    - Never log the voucher code
  expected_files:
    - "apps/crm/app/api/wallet/redeem/route.ts"
  done_check: "test -f apps/crm/app/api/wallet/redeem/route.ts"
```

---

**3. `p4-container-gen` uses `state='in_manufacturing'` — an undefined enum value.**

The task prompt includes:

```
state = 'in_manufacturing' initially
```

The `container_state` enum per PRD §Phase 1 and tech-spec §4.3 (§14 Decisions TS-04) contains: `in_distribution`, `purchased`, `returned` (plus `pending_purchase` and `rewards_paid` which exist in the enum but are never assigned to `containers.state`). `in_manufacturing` is not defined anywhere in the spec.

The `p2-schema-core` task will create the `container_state` enum from tech-spec §4.3. When `p4-container-gen` tries to INSERT containers with `state='in_manufacturing'`, Postgres will throw a constraint violation.

The correct initial state per the tech-spec data model is `in_distribution` (DEFAULT value on the `containers.state` column).

Fix: Change the line in `p4-container-gen`'s prompt from:
```
state = 'in_manufacturing' initially
```
to:
```
state defaults to 'in_distribution' (omit from INSERT — let the DB default apply)
```

---

## Warnings

1. **`@tanstack/react-query` (TS-09) not in scaffold tasks.** The tech spec explicitly rejects Redux/Zustand in favor of React Query for client data fetching. Neither `p3-crm-scaffold` nor `p6-expo-scaffold` add `@tanstack/react-query` to their dependency lists. Subsequent tasks that build paginated lists and wallet screens will need it.

2. **TS-12 FPA SHA256 short-circuit not implemented.** The tech spec (§7 Caching) specifies computing SHA256 of the uploaded FPA file to skip 120-second imports on accidental re-uploads. The `p4-fpa-route` prompt does not include this optimization.

3. **`exceljs` vs `xlsx` discrepancy.** `p4-fpa-parser` specifies `exceljs`; tech-spec §4.2 specifies `xlsx`. Both libraries parse `.xlsx` correctly, but the builder should pick one and ensure it's used consistently.

4. **`GET /api/scans/me` (api-spec §11.1) ambiguity.** `p6-history-screen` references this endpoint but no task creates the route. If the mobile history tab reads `scan_attempts` via direct Supabase RLS query (consistent with the architecture diagram showing `M -.->|direct client JWT| SB`), no route is needed. Clarify in the task prompt or add the route.

5. **`p5-products-detail` context_sources references C1 instead of C2.** The product detail page design (C2) is not provided to the builder — they get the list page design (C1) instead. The builder may produce a list-page layout for what should be a detail view.

6. **`p5-dealers-page`, `p5-wallet-admin`, `p5-reports` have no ui-design context_sources.** These three tasks reference api-spec sections only. The builders won't see the corresponding CRM screen designs (dealer management, wallet admin, scan reports screens) when implementing the pages.

7. **Validation block api-spec context only covers sections 2, 4, 6.** The hardening audit will be able to check error envelopes, rate limiting, and the scan endpoint — but won't have context for products (§7), containers (§8), dealers (§9), wallet (§10), scan history (§11), reward config (§12), or contact (§13). Consider expanding to `sections: ["all"]` for api-spec in the validation block.

8. **Website screen count ambiguity.** PRD Phase 9 specifies a 6-page website. The plan has tasks for homepage sections (one scrollable page) and contact. If W2–W6 are distinct routes (About, Why GABI, How It Works, etc.), 4 pages are missing. If they are scroll sections of W1, coverage is complete. Clarify in the website scaffold task or add individual page tasks.

---

## Recommendations

1. Fix all three blocking issues before running `barker run`. The phase_check fix is a one-line edit. The missing redeem route requires a new 20-minute task. The `in_manufacturing` state is a one-word fix in a prompt.

2. Add `@tanstack/react-query` to `p3-crm-scaffold` and `p6-expo-scaffold` dependencies and setup.

3. In `p5-products-detail`, change `context_sources` section from `"C1"` to `"C2"`.

4. Add `ui-design` context_sources to `p5-dealers-page`, `p5-wallet-admin`, and `p5-reports`.

5. Confirm whether W2–W6 are separate pages or homepage sections, and add tasks if needed.

6. The plan's model assignments, dependency graph, hardening directives, and validation block are all strong. Once the three blocking issues are resolved, the plan should execute cleanly.

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| EV-01 | Phase 2 `phase_check` filename mismatch classified as **blocking** | A wrong phase gate filename means the gate never passes on correct output — downstream phases are hard-stopped. |
| EV-02 | Missing `POST /api/wallet/redeem` route classified as **blocking** | Redemption requires server-side atomicity (balance check + voucher creation + debit in one transaction). Cannot be a direct Supabase client query. Mobile wallet's primary CTA has no backend. |
| EV-03 | `state='in_manufacturing'` in `p4-container-gen` classified as **blocking** | Value does not exist in `container_state` enum per PRD §Phase 1, tech-spec §4.3, TS-04. INSERT will fail with a Postgres constraint violation at runtime. |
| EV-04 | `p3-rate-limit` using Postgres table vs. tech-spec "in-memory LRU" — **warning, not blocking** | Plan's approach is architecturally correct for serverless/multi-instance. Tech-spec's in-memory LRU wouldn't survive across Vercel function instances. Intentional improvement, not a defect. |
| EV-05 | Missing `GET /api/scans/me` route — **warning, not blocking** | Tech-spec architecture diagram shows mobile can query Supabase directly via client JWT + RLS. Ambiguity in the plan, not a certain gap. |
| EV-06 | `p5-shared-scan-card` Opus assignment — **not flagged** | Borderline but not wrong. Cross-surface countdown timer affects all three surfaces; Opus is defensible. |
| EV-07 | Website screen count (W2–W6) — **warning, not blocking** | GABI prototype shows a single scrolling page; sections-as-scroll-components is the likely interpretation. Clarification needed, not a definite gap. |
| EV-08 | Full three-pass evaluation executed | PRD, Tech Spec, API Spec, UI Design all read in full. No spec-alignment checks skipped. |
