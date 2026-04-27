import '../../lib/i18n'
import { useState, useRef, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  AppState,
  Alert,
  Linking,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTranslation } from 'react-i18next'
import { brand, surface, text, state, spacing, fontSizes, fontWeights } from '../../theme'
import { supabase } from '../../lib/supabase'
import { useNetworkStatus } from '../../lib/offline/hooks'
import { enqueue, listQueue, type ScanStep } from '../../lib/offline/storage'
import type { ScanProductInfo } from '@gaia/shared/types'

const CRM_URL = (process.env['EXPO_PUBLIC_CRM_URL'] ?? '').replace(/\/$/, '')
const DEVICE_ID_KEY = 'gaia:device_id'
// Matches gaia.ph/scan/<uuid-v4>.<16-hex-chars> with optional scheme/www
const QR_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?gaia\.ph\/scan\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{16})$/i
const SCAN_DEBOUNCE_MS = 2_000
const REQUEST_TIMEOUT_MS = 10_000
const FRAME_SIZE = 220
const CORNER_SIZE = 22
const CORNER_STROKE = 2

function makeUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

async function getOrCreateDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY)
  if (stored) return stored
  const id = makeUUID()
  await AsyncStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

function parseQR(raw: string): { uuid: string; hmac: string } | null {
  if (!raw || raw.length < 20) return null
  const m = QR_PATTERN.exec(raw)
  if (!m) return null
  return { uuid: m[1]!, hmac: m[2]! }
}

// Inline API response shapes — kept close to the actual wire format
interface ApiContainer {
  id: string
  state: string
  formulation_months_remaining?: number
}
interface ApiScanSuccess {
  outcome: 'success'
  container: ApiContainer
  product: ScanProductInfo | null
  rewards_credited: { farmer_points: number; dealer_points: number } | null
  pending_expires_at: string | null
}
interface ApiScanPending {
  outcome: 'pending_confirmation'
  container: ApiContainer
  pending_expires_at: string
}
interface ApiErrorBody {
  error: { code?: string; message?: string }
}

type ApiScanData = ApiScanSuccess | ApiScanPending

type UiState =
  | { kind: 'idle' }
  | { kind: 'processing' }
  | { kind: 'invalid_qr' }
  | { kind: 'queued' }
  | { kind: 'saved_offline' }
  | { kind: 'error'; message: string }

export default function ScanScreen() {
  const { t } = useTranslation()
  const [permission, requestPermission] = useCameraPermissions()
  const [scanMode, setScanMode] = useState<'purchase_farmer' | 'return_farmer'>('purchase_farmer')
  const [uiState, setUiState] = useState<UiState>({ kind: 'idle' })
  const [pendingCount, setPendingCount] = useState(0)
  const [flashOn, setFlashOn] = useState(false)
  const [clockSkewWarning, setClockSkewWarning] = useState(false)
  const { isConnected } = useNetworkStatus()

  const lastScanRef = useRef<{ data: string; at: number } | null>(null)
  const lastOnlineTsRef = useRef(new Date().toISOString())
  const deviceIdRef = useRef('')

  useEffect(() => {
    void getOrCreateDeviceId().then((id) => {
      deviceIdRef.current = id
    })
  }, [])

  useEffect(() => {
    if (isConnected) {
      lastOnlineTsRef.current = new Date().toISOString()
    }
  }, [isConnected])

  const refreshPendingCount = useCallback(async () => {
    const queue = await listQueue()
    setPendingCount(queue.length)
  }, [])

  useEffect(() => {
    void refreshPendingCount()
  }, [refreshPendingCount])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && isConnected) void checkClockSkew()
    })
    return () => sub.remove()
  }, [isConnected])

  async function checkClockSkew() {
    try {
      const res = await fetch(`${CRM_URL}/`, { method: 'HEAD' })
      const dateHeader = res.headers.get('date')
      if (!dateHeader) return
      const serverMs = Date.parse(dateHeader)
      if (!isNaN(serverMs)) setClockSkewWarning(Math.abs(Date.now() - serverMs) > 60_000)
    } catch {
      // best-effort — silence network errors here
    }
  }

  // Auto-dismiss transient overlays
  useEffect(() => {
    if (
      uiState.kind === 'invalid_qr' ||
      uiState.kind === 'queued' ||
      uiState.kind === 'saved_offline'
    ) {
      const timer = setTimeout(() => setUiState({ kind: 'idle' }), 3_000)
      return () => clearTimeout(timer)
    }
  }, [uiState.kind])

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string; type: string }) => {
      // Guard against low-confidence / empty payloads
      if (!data || typeof data !== 'string' || data.length < 10) return
      if (uiState.kind !== 'idle') return

      const now = Date.now()
      if (
        lastScanRef.current?.data === data &&
        now - lastScanRef.current.at < SCAN_DEBOUNCE_MS
      ) {
        return
      }
      lastScanRef.current = { data, at: now }

      const parsed = parseQR(data)
      if (!parsed) {
        setUiState({ kind: 'invalid_qr' })
        return
      }

      void processScan(parsed.uuid, parsed.hmac, scanMode)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uiState.kind, scanMode, isConnected],
  )

  async function enqueueOffline(
    uuid: string,
    hmac: string,
    step: ScanStep,
    localScanTs: string,
  ): Promise<void> {
    try {
      await enqueue({
        id: makeUUID(),
        uuid,
        hmac,
        step,
        local_scan_ts: localScanTs,
        last_online_ts: lastOnlineTsRef.current,
        idempotency_key: makeUUID(),
        attempts: 0,
      })
    } catch {
      Alert.alert(
        'Queue Full',
        'Offline scan queue is full. Please sync before scanning offline.',
      )
    }
  }

  async function processScan(uuid: string, hmac: string, step: ScanStep) {
    setUiState({ kind: 'processing' })
    const localScanTs = new Date().toISOString()

    if (!isConnected) {
      await enqueueOffline(uuid, hmac, step, localScanTs)
      await refreshPendingCount()
      setUiState({ kind: 'queued' })
      return
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        router.replace('/(auth)/phone')
        return
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      let response: Response
      try {
        response = await fetch(`${CRM_URL}/api/scan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            uuid,
            hmac,
            step,
            local_scan_ts: localScanTs,
            device_id: deviceIdRef.current || 'unknown',
            last_online_ts: lastOnlineTsRef.current,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      // Opportunistic clock skew check from every response
      const dateHeader = response.headers.get('date')
      if (dateHeader) {
        const serverMs = Date.parse(dateHeader)
        if (!isNaN(serverMs)) setClockSkewWarning(Math.abs(Date.now() - serverMs) > 60_000)
      }

      if (response.ok) {
        const body = (await response.json()) as { data: ApiScanData }
        navigateToResult(body.data, step)
        setUiState({ kind: 'idle' })
        return
      }

      const errBody = await response
        .json()
        .catch(() => ({ error: { code: `HTTP_${response.status}` } })) as ApiErrorBody
      const code = errBody.error?.code

      if (response.status === 401 && code === 'hmac_invalid') {
        router.replace({
          pathname: '/scan-result/[id]',
          params: { id: uuid, outcome: 'counterfeit' },
        })
        setUiState({ kind: 'idle' })
        return
      }

      if (response.status === 401 && code === 'auth_required') {
        router.replace('/(auth)/phone')
        return
      }

      if (response.status === 410 || code === 'window_expired') {
        router.replace({
          pathname: '/scan-result/[id]',
          params: { id: uuid, outcome: 'expired' },
        })
        setUiState({ kind: 'idle' })
        return
      }

      if (response.status >= 500) {
        await enqueueOffline(uuid, hmac, step, localScanTs)
        await refreshPendingCount()
        setUiState({ kind: 'saved_offline' })
        return
      }

      setUiState({ kind: 'error', message: t('common.error') })
    } catch {
      // AbortError (timeout) or network failure — queue for later
      await enqueueOffline(uuid, hmac, step, localScanTs)
      await refreshPendingCount()
      setUiState({ kind: 'saved_offline' })
    }
  }

  function navigateToResult(data: ApiScanData, step: ScanStep) {
    if (data.outcome === 'pending_confirmation') {
      router.replace({
        pathname: '/scan-result/[id]',
        params: {
          id: data.container.id,
          outcome: 'pending_confirmation',
          deadline: data.pending_expires_at,
          step: step.startsWith('purchase') ? 'purchase' : 'return',
        },
      })
      return
    }

    // outcome === 'success'
    const { container, product, rewards_credited, pending_expires_at } = data

    if (pending_expires_at) {
      // Dealer-initiated step — awaiting farmer confirmation
      router.replace({
        pathname: '/scan-result/[id]',
        params: {
          id: container.id,
          outcome: 'pending_confirmation',
          product: product ? JSON.stringify(product) : undefined,
          deadline: pending_expires_at,
          step: step.startsWith('purchase') ? 'purchase' : 'return',
        },
      })
      return
    }

    if (step === 'purchase_farmer') {
      router.replace({
        pathname: '/scan-result/[id]',
        params: {
          id: container.id,
          outcome: 'purchase_success',
          product: product ? JSON.stringify(product) : undefined,
          months_remaining:
            container.formulation_months_remaining != null
              ? String(container.formulation_months_remaining)
              : undefined,
          step: 'purchase',
        },
      })
      return
    }

    if (step === 'return_farmer') {
      router.replace({
        pathname: '/scan-result/[id]',
        params: {
          id: container.id,
          outcome: 'return_success',
          farmer_points: rewards_credited ? String(rewards_credited.farmer_points) : '0',
          step: 'return',
        },
      })
    }
  }

  // ─── permission gate ─────────────────────────────────────────────────────────

  if (!permission) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color={brand.accent} />
      </View>
    )
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <View style={styles.leafBadge} />
        <Text style={styles.permissionHeadline}>Camera Access Required</Text>
        <Text style={styles.permissionBody}>
          GAIA needs camera access to scan QR codes on pesticide containers.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={
            permission.canAskAgain
              ? () => void requestPermission()
              : () => void Linking.openSettings()
          }
          accessibilityRole="button"
        >
          <Text style={styles.permissionButtonText}>
            {permission.canAskAgain ? 'Allow Camera' : 'Open Settings'}
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  const isProcessing = uiState.kind === 'processing'

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        flash={flashOn ? 'on' : 'off'}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={isProcessing ? undefined : handleBarcodeScanned}
      />

      {isProcessing && <View style={styles.dimOverlay} />}

      {/* Offline banner — persistent, sits at the very top */}
      {!isConnected && (
        <View style={[styles.systemBanner, { backgroundColor: '#B8690A' }]}>
          <Text style={styles.systemBannerText}>
            You're offline — scans will queue automatically
          </Text>
        </View>
      )}

      {/* Clock skew warning */}
      {clockSkewWarning && isConnected && (
        <View style={[styles.systemBanner, { backgroundColor: state.warning }]}>
          <Text style={styles.systemBannerText}>{t('errors.clock_skew')}</Text>
        </View>
      )}

      {/* ── Top bar: leaf icon · mode toggle · history ── */}
      <View
        style={[
          styles.topBar,
          (!isConnected || clockSkewWarning) && { top: 52 + 34 },
        ]}
      >
        {/* GAIA leaf placeholder — 24×24 white circle */}
        <View style={styles.leafIcon} />

        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modePill, scanMode === 'purchase_farmer' && styles.modePillActive]}
            onPress={() => setScanMode('purchase_farmer')}
            accessibilityRole="radio"
            accessibilityState={{ selected: scanMode === 'purchase_farmer' }}
          >
            <Text
              style={[
                styles.modePillText,
                scanMode === 'purchase_farmer' && styles.modePillTextActive,
              ]}
            >
              Buying
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modePill, scanMode === 'return_farmer' && styles.modePillActive]}
            onPress={() => setScanMode('return_farmer')}
            accessibilityRole="radio"
            accessibilityState={{ selected: scanMode === 'return_farmer' }}
          >
            <Text
              style={[
                styles.modePillText,
                scanMode === 'return_farmer' && styles.modePillTextActive,
              ]}
            >
              Returning
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.historyButton}
          onPress={() => router.push('/scan-history' as never)}
          accessibilityLabel="Scan history"
        >
          <Text style={styles.historyButtonText}>History</Text>
        </TouchableOpacity>
      </View>

      {/* ── Center: targeting frame + overlays ── */}
      <View style={[StyleSheet.absoluteFill, styles.centerArea]} pointerEvents="box-none">
        <View style={styles.frameGroup}>
          {/* 220×220 corner-bracket frame */}
          <View style={styles.frame}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>

          <Text style={styles.alignHint}>Align QR code here</Text>

          {isProcessing && (
            <>
              <ActivityIndicator
                size="large"
                color={brand.accent}
                style={{ marginTop: spacing[4] }}
              />
              <Text style={styles.verifyingText}>Verifying…</Text>
            </>
          )}
        </View>

        {/* Toast notifications — appear below the frame group */}
        {uiState.kind === 'invalid_qr' && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>Not a GAIA QR</Text>
          </View>
        )}

        {(uiState.kind === 'queued' || uiState.kind === 'saved_offline') && (
          <View style={[styles.toast, styles.toastSuccess]}>
            <Text style={styles.toastText}>
              {uiState.kind === 'queued' ? 'Scan queued' : 'Saved offline'}
            </Text>
          </View>
        )}

        {uiState.kind === 'error' && (
          <TouchableOpacity
            style={[styles.toast, styles.toastError]}
            onPress={() => setUiState({ kind: 'idle' })}
          >
            <Text style={styles.toastText}>{uiState.message}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Bottom bar: pending badge · flash · manual entry ── */}
      <View style={styles.bottomBar}>
        {pendingCount > 0 && (
          <TouchableOpacity
            style={styles.pendingBadge}
            onPress={() => router.push('/offline-queue' as never)}
            accessibilityLabel={`${pendingCount} pending scans to sync`}
          >
            <Text style={styles.pendingBadgeText}>● {pendingCount} pending sync</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bottomActions}>
          <TouchableOpacity
            style={[styles.flashButton, flashOn && styles.flashButtonActive]}
            onPress={() => setFlashOn((v) => !v)}
            accessibilityLabel={flashOn ? 'Turn off flash' : 'Turn on flash'}
          >
            <Text style={styles.flashButtonText}>{flashOn ? 'Flash On' : 'Flash'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/manual-entry' as never)}
            accessibilityRole="link"
          >
            <Text style={styles.manualEntryLink}>Enter manually</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },

  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.60)',
  },

  // ── Permission screen ───────────────────────────────────────────────────────
  permissionScreen: {
    flex: 1,
    backgroundColor: surface.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    gap: spacing[4],
  },
  leafBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: brand.primary,
    marginBottom: spacing[2],
  },
  permissionHeadline: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: text.primary,
    textAlign: 'center',
  },
  permissionBody: {
    fontSize: fontSizes.base,
    color: text.secondary,
    textAlign: 'center',
    lineHeight: fontSizes.base * 1.5,
  },
  permissionButton: {
    backgroundColor: brand.accent,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[8],
    borderRadius: 8,
    marginTop: spacing[2],
  },
  permissionButtonText: {
    color: surface.white,
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
  },

  // ── System banners ──────────────────────────────────────────────────────────
  systemBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    zIndex: 20,
  },
  systemBannerText: {
    color: surface.white,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    textAlign: 'center',
  },

  // ── Top bar ─────────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    zIndex: 10,
  },
  leafIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: surface.white,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.40)',
    borderRadius: 20,
    padding: 3,
    gap: 2,
  },
  modePill: {
    paddingVertical: 5,
    paddingHorizontal: spacing[3],
    borderRadius: 16,
  },
  modePillActive: {
    backgroundColor: brand.accent,
  },
  modePillText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
  modePillTextActive: {
    color: surface.white,
    fontWeight: fontWeights.semibold,
  },
  historyButton: {
    paddingVertical: 5,
    paddingHorizontal: spacing[3],
  },
  historyButtonText: {
    color: surface.white,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // ── Center targeting frame ──────────────────────────────────────────────────
  centerArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameGroup: {
    alignItems: 'center',
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: surface.white,
  },
  tl: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_STROKE,
    borderLeftWidth: CORNER_STROKE,
  },
  tr: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_STROKE,
    borderRightWidth: CORNER_STROKE,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_STROKE,
    borderLeftWidth: CORNER_STROKE,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_STROKE,
    borderRightWidth: CORNER_STROKE,
  },
  alignHint: {
    marginTop: spacing[3],
    color: surface.white,
    fontSize: 13,
    fontWeight: fontWeights.regular,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  verifyingText: {
    marginTop: spacing[2],
    color: surface.white,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // ── Toasts ──────────────────────────────────────────────────────────────────
  toast: {
    marginTop: spacing[6],
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: 20,
  },
  toastSuccess: {
    backgroundColor: state.success,
  },
  toastError: {
    backgroundColor: state.error,
  },
  toastText: {
    color: surface.white,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },

  // ── Bottom bar ──────────────────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    zIndex: 10,
  },
  pendingBadge: {
    backgroundColor: 'rgba(184,105,10,0.85)',
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[4],
    borderRadius: 20,
  },
  pendingBadgeText: {
    color: surface.white,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  bottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
  },
  flashButton: {
    paddingVertical: 6,
    paddingHorizontal: spacing[3],
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  flashButtonActive: {
    backgroundColor: 'rgba(200,149,42,0.25)',
    borderColor: brand.accent,
  },
  flashButtonText: {
    color: surface.white,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
  manualEntryLink: {
    color: surface.white,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    textDecorationLine: 'underline',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
})
