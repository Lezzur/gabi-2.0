/**
 * E2E — Dealer scan terminal (POST /api/scan).
 *
 * Covers four scenarios:
 *   1. purchase_dealer success  — QR decoded → API 200 → history "Purchase initiated"
 *   2. return_dealer success    — dialog confirm → API 200 → history "Return accepted"
 *   3. Invalid HMAC             — API 403 → history "Invalid QR code"
 *   4. Already-claimed          — container pre-seeded as returned → API 409 → "Already claimed"
 *
 * Test isolation strategy:
 *   - Each test seeds its own container (unique UUID) via service role → no parallel flakiness.
 *   - Shared fixtures (one dealer user + one product per worker) are created in beforeAll
 *     and torn down in afterAll.
 *   - Container rows and their sidecars are deleted in each test's finally block.
 *
 * Camera / BarcodeDetector:
 *   - Chrome flags --use-fake-device-for-media-stream + --use-fake-ui-for-media-stream
 *     make getUserMedia return a live fake stream without a permission dialog.
 *   - A MockBarcodeDetector is injected via addInitScript; it reads window.__qrPending
 *     once per RAF tick, then clears it. Tests call triggerQr() to arm the next scan.
 */

import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

// ─── Launch flags ────────────────────────────────────────────────────────────
// Applied to every test in this file. Provides a headless fake camera so
// getUserMedia succeeds and video.readyState reaches HAVE_ENOUGH_DATA without
// a real device or permission prompt.
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
})

// ─── Env ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL =
  process.env['SUPABASE_URL_TEST'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? ''
const SERVICE_KEY =
  process.env['SUPABASE_SERVICE_ROLE_KEY_TEST'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
const HMAC_SECRET = process.env['HMAC_SECRET'] ?? ''

// ─── Service-role admin client ───────────────────────────────────────────────
// Used only in Node.js test process (never in the browser).
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── HMAC helpers ────────────────────────────────────────────────────────────

/** Build the QR raw value that parseQrPayload() in scan-terminal.tsx expects. */
function qrPayload(uuid: string, hmac16: string): string {
  return `gaia.ph/scan/${uuid}.${hmac16}`
}

/** Return a 16-char hex string guaranteed to differ from the correct HMAC. */
function invalidHmac(correct: string): string {
  const flipped = correct[0] === 'a' ? 'b' : 'a'
  return flipped + correct.slice(1)
}

// ─── Container seeding ────────────────────────────────────────────────────────
type ContainerState =
  | 'in_distribution'
  | 'pending_purchase'
  | 'purchased'
  | 'returned'
  | 'rewards_paid'

async function seedContainer(
  productId: string,
  state: ContainerState,
): Promise<{ id: string; hmac16: string }> {
  const sb = adminClient()
  const id = crypto.randomUUID()
  const fullHmac = createHmac('sha256', HMAC_SECRET).update(id).digest('hex')
  const hmac16 = fullHmac.slice(0, 16)

  const { error } = await sb.from('containers').insert({
    id,
    product_id: productId,
    hmac: fullHmac,
    hmac_suffix: hmac16,
    state,
    batch_number: 'E2E-BATCH',
    manufacture_date: '2024-01-01',
  })
  if (error) throw new Error(`seedContainer failed: ${error.message}`)
  return { id, hmac16 }
}

async function deleteContainer(id: string): Promise<void> {
  const sb = adminClient()
  // Remove sidecars first; foreign-key order does not matter for Postgres
  // cascades here but keeps cleanup explicit.
  await Promise.all([
    sb.from('pending_purchase').delete().eq('container_id', id),
    sb.from('pending_return_reward').delete().eq('container_id', id),
    sb.from('scan_attempts').delete().eq('container_id', id),
    // scan_rate_limits uses uuid (the container UUID) as the key column
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb as any).from('scan_rate_limits').delete().eq('uuid', id),
  ])
  await sb.from('containers').delete().eq('id', id)
}

// ─── BarcodeDetector mock (injected into browser via addInitScript) ──────────
//
// The scan-terminal uses the native BarcodeDetector API in a requestAnimationFrame
// loop. We replace it with a controllable mock that:
//   • passes the 'BarcodeDetector' in window check in the component
//   • accepts the { formats } constructor option without throwing
//   • returns window.__qrPending once when set, then clears it
//
// The --use-fake-device-for-media-stream flag ensures getUserMedia resolves and
// the video element reaches readyState >= 2 so the tick() guard is satisfied.
const BARCODE_MOCK_SCRIPT = /* js */ `
  window.__qrPending = null;

  class MockBarcodeDetector {
    constructor(_opts) {}
    async detect(_video) {
      if (!window.__qrPending) return [];
      const raw = window.__qrPending;
      window.__qrPending = null;
      return [{ rawValue: raw, format: 'qr_code', boundingBox: new DOMRect(), cornerPoints: [] }];
    }
  }

  window.BarcodeDetector = MockBarcodeDetector;
`

/** Arm the mock so the next RAF tick returns this QR payload. */
async function triggerQr(page: Page, payload: string): Promise<void> {
  await page.evaluate(
    (p) => { (window as unknown as { __qrPending: string | null }).__qrPending = p },
    payload,
  )
}

// ─── Login helper ─────────────────────────────────────────────────────────────
async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Middleware redirects away from /login on successful auth.
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })
}

// ─── Shared worker fixtures ───────────────────────────────────────────────────
interface WorkerFixtures {
  productId: string
  dealerUserId: string
  dealerAccountId: string
  email: string
  password: string
}

let wx: WorkerFixtures

// ─── Tests ────────────────────────────────────────────────────────────────────
test.describe('Dealer scan terminal', () => {
  test.beforeAll(async () => {
    const sb = adminClient()

    // Unique tag per worker run prevents email collisions across parallel workers.
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const email = `e2e-scan-${tag}@test.gaia.ph`
    const password = 'E2eTestScan123!'

    // Minimal active product — purchase_dealer does not check product status,
    // but 'active' avoids surprises if the route is ever tightened.
    const productId = crypto.randomUUID()
    const { error: pErr } = await sb.from('products').insert({
      id: productId,
      product_name: 'E2E Scan Test Pesticide',
      company: 'E2E Test Corp',
      active_ingredient: 'testamine',
      status: 'active',
    })
    if (pErr) throw new Error(`products insert: ${pErr.message}`)

    // Auth user — email_confirm: true skips the confirmation flow.
    const { data: ud, error: uErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (uErr) throw new Error(`createUser: ${uErr.message}`)
    const dealerUserId = ud.user!.id

    // dealer_accounts row — required for return_dealer route branch (dealer_id check).
    const dealerAccountId = crypto.randomUUID()
    const { error: dErr } = await sb.from('dealer_accounts').insert({
      id: dealerAccountId,
      user_id: dealerUserId,
      business_name: 'E2E Scan Test Dealer',
      is_verified: true,
    })
    if (dErr) throw new Error(`dealer_accounts insert: ${dErr.message}`)

    // app_metadata.dealer_id — the scan route reads this from the JWT to authorise
    // return_dealer and purchase_dealer steps.
    const { error: mErr } = await sb.auth.admin.updateUserById(dealerUserId, {
      app_metadata: { dealer_id: dealerAccountId, role: 'dealer' },
    })
    if (mErr) throw new Error(`updateUserById: ${mErr.message}`)

    wx = { productId, dealerUserId, dealerAccountId, email, password }
  })

  test.afterAll(async () => {
    if (!wx) return
    const sb = adminClient()
    // Delete any containers still pointing at the test product (guards against
    // failed per-test cleanup) before deleting the product itself.
    const { data: remaining } = await sb
      .from('containers')
      .select('id')
      .eq('product_id', wx.productId)
    if (remaining) {
      for (const { id } of remaining) await deleteContainer(id)
    }
    await sb.from('dealer_accounts').delete().eq('id', wx.dealerAccountId)
    await sb.auth.admin.deleteUser(wx.dealerUserId)
    await sb.from('products').delete().eq('id', wx.productId)
  })

  // ── 1. purchase_dealer success ────────────────────────────────────────────
  test('purchase_dealer success: QR decode → pending_purchase created → history shows "Purchase initiated"', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['camera'])
    await page.addInitScript(BARCODE_MOCK_SCRIPT)

    const { id, hmac16 } = await seedContainer(wx.productId, 'in_distribution')
    try {
      await login(page, wx.email, wx.password)
      await page.goto('/scan')

      await expect(page.getByRole('heading', { name: 'Scan Terminal' })).toBeVisible()
      // Purchase tab is the default active tab.
      await expect(page.getByRole('tab', { name: 'Purchase' })).toHaveAttribute(
        'data-state',
        'active',
      )

      await triggerQr(page, qrPayload(id, hmac16))

      // History panel updates with success entry.
      await expect(page.getByText('Purchase initiated')).toBeVisible({ timeout: 10_000 })
      await expect(
        page.getByRole('listitem').filter({ hasText: 'Purchase initiated' }).getByText('OK'),
      ).toBeVisible()

      // Verify the pending_purchase row was actually written to the DB.
      const { data: pp } = await adminClient()
        .from('pending_purchase')
        .select('id')
        .eq('container_id', id)
        .maybeSingle()
      expect(pp).not.toBeNull()
    } finally {
      await deleteContainer(id)
    }
  })

  // ── 2. return_dealer — condition dialog → success ─────────────────────────
  test('return_dealer: condition dialog appears, checkbox gates Accept Return, success surfaced', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['camera'])
    await page.addInitScript(BARCODE_MOCK_SCRIPT)

    // claimReturnByDealer requires state='purchased'; seed accordingly.
    const { id, hmac16 } = await seedContainer(wx.productId, 'purchased')
    try {
      await login(page, wx.email, wx.password)
      await page.goto('/scan')

      await expect(page.getByRole('heading', { name: 'Scan Terminal' })).toBeVisible()

      await page.getByRole('tab', { name: 'Return' }).click()
      await expect(page.getByRole('tab', { name: 'Return' })).toHaveAttribute('data-state', 'active')

      await triggerQr(page, qrPayload(id, hmac16))

      // Return confirm dialog must appear before any API call is made.
      const dialog = page.getByRole('dialog', { name: 'Confirm Container Return' })
      await expect(dialog).toBeVisible({ timeout: 5_000 })

      // Accept Return is disabled until the condition checkbox is ticked.
      const acceptBtn = dialog.getByRole('button', { name: 'Accept Return' })
      await expect(acceptBtn).toBeDisabled()

      await dialog.getByRole('checkbox').click()
      await expect(acceptBtn).toBeEnabled()

      await acceptBtn.click()

      // Dialog dismisses and history shows success.
      await expect(dialog).not.toBeVisible({ timeout: 5_000 })
      await expect(page.getByText('Return accepted')).toBeVisible({ timeout: 10_000 })
      await expect(
        page.getByRole('listitem').filter({ hasText: 'Return accepted' }).getByText('OK'),
      ).toBeVisible()

      // Verify container state advanced to 'returned' in the DB.
      const { data: c } = await adminClient()
        .from('containers')
        .select('state')
        .eq('id', id)
        .single()
      expect(c?.state).toBe('returned')
    } finally {
      await deleteContainer(id)
    }
  })

  // ── 3. Invalid HMAC ───────────────────────────────────────────────────────
  test('invalid HMAC: API returns 403, history entry shows "Invalid QR code" with ERR badge', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['camera'])
    await page.addInitScript(BARCODE_MOCK_SCRIPT)

    // Real container so the UUID exists, but we pass a wrong HMAC.
    const { id, hmac16 } = await seedContainer(wx.productId, 'in_distribution')
    const bad = invalidHmac(hmac16)

    try {
      await login(page, wx.email, wx.password)
      await page.goto('/scan')

      await expect(page.getByRole('heading', { name: 'Scan Terminal' })).toBeVisible()

      await triggerQr(page, qrPayload(id, bad))

      await expect(page.getByText('Invalid QR code')).toBeVisible({ timeout: 10_000 })
      await expect(
        page.getByRole('listitem').filter({ hasText: 'Invalid QR code' }).getByText('ERR'),
      ).toBeVisible()

      // Verify scan_attempts recorded hmac_valid=false.
      const { data: attempt } = await adminClient()
        .from('scan_attempts')
        .select('hmac_valid')
        .eq('container_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      expect(attempt?.hmac_valid).toBe(false)
    } finally {
      await deleteContainer(id)
    }
  })

  // ── 4. Already-claimed container ─────────────────────────────────────────
  test('already_claimed: return scan on already-returned container → 409 surfaced as "Already claimed"', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['camera'])
    await page.addInitScript(BARCODE_MOCK_SCRIPT)

    // Pre-claim: container is already in 'returned' state.
    // claimReturnByDealer filters WHERE state='purchased', so it finds nothing
    // and the route returns 409 ALREADY_CLAIMED.
    const { id, hmac16 } = await seedContainer(wx.productId, 'returned')
    try {
      await login(page, wx.email, wx.password)
      await page.goto('/scan')

      await expect(page.getByRole('heading', { name: 'Scan Terminal' })).toBeVisible()

      await page.getByRole('tab', { name: 'Return' }).click()

      await triggerQr(page, qrPayload(id, hmac16))

      const dialog = page.getByRole('dialog', { name: 'Confirm Container Return' })
      await expect(dialog).toBeVisible({ timeout: 5_000 })
      await dialog.getByRole('checkbox').click()
      await dialog.getByRole('button', { name: 'Accept Return' }).click()

      // API returns 409; UI maps ALREADY_CLAIMED → "Already claimed".
      await expect(page.getByText('Already claimed')).toBeVisible({ timeout: 10_000 })
      await expect(
        page.getByRole('listitem').filter({ hasText: 'Already claimed' }).getByText('ERR'),
      ).toBeVisible()

      // Container state must remain 'returned' — no revert.
      const { data: c } = await adminClient()
        .from('containers')
        .select('state')
        .eq('id', id)
        .single()
      expect(c?.state).toBe('returned')
    } finally {
      await deleteContainer(id)
    }
  })
})
