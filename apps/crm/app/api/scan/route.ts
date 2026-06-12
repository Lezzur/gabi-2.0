// POST /api/scan — orchestrates the full scan pipeline.
// Must run on Node.js (not Edge) for crypto.timingSafeEqual + pg transactions.
export const runtime = 'nodejs'

import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@gaia/supabase'
import { createLogger } from '@gaia/shared/logger'
import { getRequestUser } from '@/lib/auth/request'
import { verifyHmac16, getHmacSecret } from '@/lib/scan/hmac'
import { checkRateLimit, recordInvalidHmac, resetRateLimit } from '@/lib/scan/rate-limit'
import { parseScanRequest, validateClockBounds } from '@/lib/scan/validate'
import {
  claimPurchaseByFarmer,
  claimReturnByDealer,
  writePendingReturnReward,
  finalizeReturnReward,
} from '@/lib/scan/claim'
import { checkIdempotency, storeIdempotency } from '@/lib/scan/idempotency'
import { recordScanAttempt } from '@/lib/scan/audit'

const log = createLogger('api/scan')

const MAX_BODY_BYTES = 8 * 1024

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Content-Type guard ──────────────────────────────────────────────────────
  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return NextResponse.json(
      { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json' } },
      { status: 415 },
    )
  }

  // ── Body size guard ─────────────────────────────────────────────────────────
  const cl = request.headers.get('content-length')
  if (cl !== null && parseInt(cl, 10) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 8 KB limit' } },
      { status: 413 },
    )
  }

  const service = createServiceClient()
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  try {
    // ── 1. Parse body ─────────────────────────────────────────────────────────
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Request body is not valid JSON' } },
        { status: 400 },
      )
    }

    const parsed = parseScanRequest(rawBody)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: { code: parsed.code, message: parsed.message, field: parsed.field } },
        { status: 400 },
      )
    }
    const body = parsed.data
    const { uuid, hmac, step, actor_type, last_online_ts, idempotency_key } = body
    const local_scan_ts = body.local_scan_ts ?? null

    // ── 2. Auth — session cookie (CRM) or Bearer token (mobile) ──────────────
    const user = await getRequestUser(request)
    if (!user) {
      await recordScanAttempt(
        { uuid, actor_type, step, outcome: 'auth_required', client_ip: clientIp, local_scan_ts },
        service,
      ).catch(() => {})
      return NextResponse.json(
        { error: { code: 'AUTH_REQUIRED', message: 'i18n:errors.auth_required' } },
        { status: 401 },
      )
    }

    // ── 3. Idempotency check ──────────────────────────────────────────────────
    if (idempotency_key) {
      const cached = await checkIdempotency(idempotency_key, user.id, service)
      if (cached !== null) {
        return NextResponse.json(cached)
      }
    }

    // ── 4. Rate limit check ───────────────────────────────────────────────────
    const rl = await checkRateLimit(uuid, service)
    if (rl.locked) {
      await recordScanAttempt(
        { uuid, actor_type, actor_user_id: user.id, step, outcome: 'rate_limited', client_ip: clientIp, local_scan_ts },
        service,
      ).catch(() => {})
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'i18n:errors.rate_limited' } },
        {
          status: 429,
          ...(rl.retryAfterSec ? { headers: { 'Retry-After': String(rl.retryAfterSec) } } : {}),
        },
      )
    }

    // ── 5. HMAC verify ────────────────────────────────────────────────────────
    let secret: string
    try {
      secret = getHmacSecret()
    } catch {
      log.error('HMAC_SECRET not configured')
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
        { status: 500 },
      )
    }

    const hmacValid = verifyHmac16(uuid, hmac, secret)
    if (!hmacValid) {
      const rlAfter = await recordInvalidHmac(uuid, service)
      await recordScanAttempt(
        { uuid, actor_type, actor_user_id: user.id, step, outcome: 'hmac_invalid', client_ip: clientIp, local_scan_ts },
        service,
      ).catch(() => {})
      return NextResponse.json(
        { error: { code: 'INVALID_HMAC', message: 'i18n:errors.invalid_hmac' } },
        {
          status: 403,
          ...(rlAfter.locked && rlAfter.retryAfterSec ? { headers: { 'Retry-After': String(rlAfter.retryAfterSec) } } : {}),
        },
      )
    }

    // ── 6. Clock bounds ───────────────────────────────────────────────────────
    if (local_scan_ts) {
      const clockResult = validateClockBounds(
        local_scan_ts,
        last_online_ts ?? null,
        new Date(),
      )
      if (!clockResult.ok) {
        await recordScanAttempt(
          { uuid, actor_type, actor_user_id: user.id, step, outcome: 'state_mismatch', failure_code: clockResult.code, client_ip: clientIp, local_scan_ts },
          service,
        ).catch(() => {})
        return NextResponse.json(
          { error: { code: clockResult.code, message: `i18n:errors.${clockResult.code.toLowerCase()}` } },
          { status: 400 },
        )
      }
    }

    const scanTs = local_scan_ts ?? new Date().toISOString()

    // ── 7. Dispatch on (step, actor_type) ─────────────────────────────────────
    const dealerAccountId = (user.app_metadata?.['dealer_id'] as string | undefined) ?? null

    let responseBody: unknown

    if (step === 'purchase_farmer') {
      const result = await claimPurchaseByFarmer(uuid, user.id, scanTs, service)
      if (!result.claimed) {
        await recordScanAttempt(
          { uuid, actor_type, actor_user_id: user.id, step, outcome: 'already_claimed', client_ip: clientIp, local_scan_ts },
          service,
        ).catch(() => {})
        const body = { error: { code: 'ALREADY_CLAIMED', message: 'i18n:errors.already_claimed' } }
        if (idempotency_key) await storeIdempotency(idempotency_key, user.id, body, service).catch(() => {})
        return NextResponse.json(body, { status: 409 })
      }
      await recordScanAttempt(
        { uuid, actor_type, actor_user_id: user.id, step, outcome: 'success', client_ip: clientIp, local_scan_ts },
        service,
      ).catch(() => {})
      await resetRateLimit(uuid, service)
      responseBody = { data: { outcome: 'success', step, uuid } }

    } else if (step === 'return_dealer') {
      if (!dealerAccountId) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'i18n:errors.forbidden' } },
          { status: 403 },
        )
      }
      const result = await claimReturnByDealer(uuid, user.id, dealerAccountId, scanTs, service)
      if (!result.claimed) {
        await recordScanAttempt(
          { uuid, actor_type, actor_user_id: user.id, step, outcome: 'already_claimed', client_ip: clientIp, local_scan_ts },
          service,
        ).catch(() => {})
        return NextResponse.json(
          { error: { code: 'ALREADY_CLAIMED', message: 'i18n:errors.already_claimed' } },
          { status: 409 },
        )
      }
      const pending = await writePendingReturnReward(uuid, dealerAccountId, service)
      await recordScanAttempt(
        { uuid, actor_type, actor_user_id: user.id, step, outcome: 'success', client_ip: clientIp, local_scan_ts },
        service,
      ).catch(() => {})
      await resetRateLimit(uuid, service)
      responseBody = {
        data: {
          outcome: 'success',
          step,
          uuid,
          pending_id: pending.written ? pending.pending_id : null,
          pending_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      }

    } else if (step === 'return_farmer') {
      // Fetch the pending_return_reward row for this container.
      const { data: pendingRow } = await service
        .from('pending_return_reward')
        .select('id')
        .eq('container_id', uuid)
        .maybeSingle()

      if (!pendingRow) {
        await recordScanAttempt(
          { uuid, actor_type, actor_user_id: user.id, step, outcome: 'window_expired', client_ip: clientIp, local_scan_ts },
          service,
        ).catch(() => {})
        return NextResponse.json(
          { error: { code: 'WINDOW_EXPIRED', message: 'i18n:errors.window_expired' } },
          { status: 409 },
        )
      }

      const finalize = await finalizeReturnReward(pendingRow.id, user.id, service)
      if (!finalize.finalized) {
        await recordScanAttempt(
          { uuid, actor_type, actor_user_id: user.id, step, outcome: 'state_mismatch', failure_code: finalize.reason, client_ip: clientIp, local_scan_ts },
          service,
        ).catch(() => {})
        return NextResponse.json(
          { error: { code: finalize.reason, message: 'i18n:errors.state_mismatch' } },
          { status: 409 },
        )
      }
      await recordScanAttempt(
        { uuid, actor_type, actor_user_id: user.id, step, outcome: 'success', client_ip: clientIp, local_scan_ts },
        service,
      ).catch(() => {})
      await resetRateLimit(uuid, service)
      responseBody = { data: { outcome: 'success', step, uuid } }

    } else {
      // purchase_dealer — opens the pending_purchase sidecar (state machine gating)
      // This step is handled by the dealer terminal; no claim function needed here.
      // Insert pending_purchase row and return.
      const { error: ppErr } = await service
        .from('pending_purchase')
        .insert({ container_id: uuid, dealer_id: dealerAccountId! })

      if (ppErr && ppErr.code !== '23505') {
        // 23505 = unique violation = already exists (idempotent)
        log.error(`[scan] pending_purchase insert failed: ${ppErr.message}`)
        return NextResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
          { status: 500 },
        )
      }
      await recordScanAttempt(
        { uuid, actor_type, actor_user_id: user.id, step, outcome: 'success', client_ip: clientIp, local_scan_ts },
        service,
      ).catch(() => {})
      responseBody = {
        data: {
          outcome: 'success',
          step,
          uuid,
          pending_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      }
    }

    // ── 9. Store idempotency ──────────────────────────────────────────────────
    if (idempotency_key) {
      await storeIdempotency(idempotency_key, user.id, responseBody, service).catch(() => {})
    }

    return NextResponse.json(responseBody, { status: 200 })

  } catch (err) {
    log.error(`[scan] unhandled error: ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 },
    )
  }
}
