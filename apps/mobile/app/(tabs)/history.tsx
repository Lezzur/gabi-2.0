import '../../lib/i18n'
import { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  PanResponder,
  RefreshControl,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../lib/supabase'
import { useNetworkStatus } from '../../lib/offline/hooks'
import { listQueue, dequeue } from '../../lib/offline/storage'
import { flushQueue, flushSingle } from '../../lib/offline/sync'
import type { QueuedScan } from '../../lib/offline/storage'
import { brand, surface, text, state, spacing, fontSizes, fontWeights } from '../../theme'

const CRM_URL = (process.env['EXPO_PUBLIC_CRM_URL'] ?? '').replace(/\/$/, '')
const LAST_SYNC_KEY = 'gaia:last_sync_ts'
const SWIPE_REVEAL = 152
const SWIPE_THRESHOLD = 60

interface SyncedScan {
  id: string
  container_id: string
  step: string
  outcome: string
  product_name: string
  sync_delayed: boolean
  created_at: string
}

// --- helpers ---

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - Date.parse(isoString)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function pendingStatus(item: QueuedScan): 'queued' | 'retrying' | 'failed' {
  if (item.attempts === 0) return 'queued'
  if (item.attempts < 5) return 'retrying'
  return 'failed'
}

function stepLabel(step: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    purchase_dealer: t('history.step_purchase_dealer'),
    purchase_farmer: t('history.step_purchase_farmer'),
    return_dealer: t('history.step_return_dealer'),
    return_farmer: t('history.step_return_farmer'),
  }
  return map[step] ?? step
}

// --- SyncedRow ---

function SyncedRow({ item, t }: { item: SyncedScan; t: (k: string) => string }) {
  return (
    <View style={styles.syncedRow}>
      <View style={styles.rowMain}>
        <Text style={styles.productName} numberOfLines={1}>
          {item.product_name}
        </Text>
        <Text style={styles.stepText}>{stepLabel(item.step, t)}</Text>
      </View>
      <View style={styles.rowMeta}>
        {item.sync_delayed && (
          <View style={styles.badgeDelayed}>
            <Text style={styles.badgeDelayedText}>{t('history.sync_delayed')}</Text>
          </View>
        )}
        <Text style={styles.timestamp}>{formatRelativeTime(item.created_at)}</Text>
      </View>
    </View>
  )
}

// --- PendingRow ---

function PendingRow({
  item,
  onRetry,
  onDiscard,
  t,
}: {
  item: QueuedScan
  onRetry: () => void
  onDiscard: () => void
  t: (k: string) => string
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const isOpen = useRef(false)

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = isOpen.current ? -SWIPE_REVEAL : 0
        translateX.setValue(Math.max(-SWIPE_REVEAL, Math.min(0, base + g.dx)))
      },
      onPanResponderRelease: (_, g) => {
        const base = isOpen.current ? -SWIPE_REVEAL : 0
        const projected = base + g.dx
        if (!isOpen.current && projected < -SWIPE_THRESHOLD) {
          Animated.spring(translateX, { toValue: -SWIPE_REVEAL, useNativeDriver: true }).start()
          isOpen.current = true
        } else if (isOpen.current && projected > -SWIPE_REVEAL + SWIPE_THRESHOLD) {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
          isOpen.current = false
        } else {
          Animated.spring(translateX, {
            toValue: isOpen.current ? -SWIPE_REVEAL : 0,
            useNativeDriver: true,
          }).start()
        }
      },
    }),
  ).current

  const status = pendingStatus(item)
  const statusBgColor =
    status === 'failed' ? state.errorBg : status === 'retrying' ? state.warningBg : state.pendingBg
  const statusTextColor =
    status === 'failed' ? state.error : status === 'retrying' ? state.warning : state.pending

  function closeAndRun(fn: () => void) {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
    isOpen.current = false
    fn()
  }

  return (
    <View style={styles.pendingOuter}>
      <View style={styles.pendingActions}>
        <TouchableOpacity
          style={styles.retryAction}
          onPress={() => closeAndRun(onRetry)}
          accessibilityRole="button"
          accessibilityLabel={t('history.retry_action')}
        >
          <Text style={styles.retryActionText}>{t('history.retry_action')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.discardAction}
          onPress={() => closeAndRun(onDiscard)}
          accessibilityRole="button"
          accessibilityLabel={t('history.discard_confirm_action')}
        >
          <Text style={styles.discardActionText}>{t('history.discard_confirm_action')}</Text>
        </TouchableOpacity>
      </View>
      <Animated.View
        style={[styles.pendingContent, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <View style={styles.rowMain}>
          <Text style={styles.pendingUUID}>
            {item.uuid.slice(0, 8).toUpperCase()}···
          </Text>
          <Text style={styles.stepText}>{stepLabel(item.step, t)}</Text>
        </View>
        <View style={styles.rowMeta}>
          <View style={[styles.badge, { backgroundColor: statusBgColor }]}>
            <Text style={[styles.badgeText, { color: statusTextColor }]}>
              {t(`history.queue_status_${status}`)}
              {item.attempts > 0 ? ` (${item.attempts}/5)` : ''}
            </Text>
          </View>
          <Text style={styles.timestamp}>{formatRelativeTime(item.local_scan_ts)}</Text>
        </View>
      </Animated.View>
    </View>
  )
}

// --- main screen ---

export default function HistoryScreen() {
  const { t } = useTranslation()
  const { isConnected } = useNetworkStatus()

  const [activeTab, setActiveTab] = useState<'synced' | 'pending'>('synced')

  // Synced tab
  const [syncedScans, setSyncedScans] = useState<SyncedScan[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [syncedRefreshing, setSyncedRefreshing] = useState(false)
  const [syncedError, setSyncedError] = useState(false)

  // Pending tab
  const [pendingScans, setPendingScans] = useState<QueuedScan[]>([])
  const [pendingRefreshing, setPendingRefreshing] = useState(false)

  // Sync controls
  const [lastSyncTs, setLastSyncTs] = useState<string | null>(null)
  const [isSyncingAll, setIsSyncingAll] = useState(false)

  useEffect(() => {
    void loadLastSyncTs()
    void loadSyncedHistory(null)
    void loadPendingQueue()
  }, [])

  async function loadLastSyncTs() {
    const ts = await AsyncStorage.getItem(LAST_SYNC_KEY)
    setLastSyncTs(ts)
  }

  async function loadSyncedHistory(cursor: string | null) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const params = new URLSearchParams({ limit: '20' })
      if (cursor) params.set('cursor', cursor)

      const res = await fetch(`${CRM_URL}/api/scans/me?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        setSyncedError(true)
        return
      }

      const json = (await res.json()) as {
        data: SyncedScan[]
        pagination: { next_cursor: string | null; has_more: boolean }
      }

      if (cursor) {
        setSyncedScans((prev) => [...prev, ...json.data])
      } else {
        setSyncedScans(json.data)
        setSyncedError(false)
      }
      setNextCursor(json.pagination.next_cursor)
      setHasMore(json.pagination.has_more)
    } catch {
      setSyncedError(true)
    }
  }

  async function loadPendingQueue() {
    const items = await listQueue()
    setPendingScans(items)
  }

  async function handleSyncNow() {
    if (isSyncingAll) return
    setIsSyncingAll(true)
    try {
      await flushQueue(supabase)
      const now = new Date().toISOString()
      await AsyncStorage.setItem(LAST_SYNC_KEY, now)
      setLastSyncTs(now)
      await loadPendingQueue()
      await loadSyncedHistory(null)
    } finally {
      setIsSyncingAll(false)
    }
  }

  async function handleRetry(scanId: string) {
    await flushSingle(supabase, scanId)
    const now = new Date().toISOString()
    await AsyncStorage.setItem(LAST_SYNC_KEY, now)
    setLastSyncTs(now)
    await loadPendingQueue()
  }

  function confirmDiscard(scanId: string) {
    Alert.alert(
      t('history.discard_confirm_title'),
      t('history.discard_confirm_body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('history.discard_confirm_action'),
          style: 'destructive',
          onPress: () => void handleDiscard(scanId),
        },
      ],
    )
  }

  async function handleDiscard(scanId: string) {
    await dequeue(scanId)
    await loadPendingQueue()
  }

  async function onSyncedRefresh() {
    setSyncedRefreshing(true)
    await loadSyncedHistory(null)
    setSyncedRefreshing(false)
  }

  async function onPendingRefresh() {
    setPendingRefreshing(true)
    await loadPendingQueue()
    setPendingRefreshing(false)
  }

  async function handleLoadMore() {
    if (!hasMore || loadingMore || !nextCursor) return
    setLoadingMore(true)
    await loadSyncedHistory(nextCursor)
    setLoadingMore(false)
  }

  return (
    <View style={styles.root}>
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>{t('history.offline_banner')}</Text>
        </View>
      )}

      <View style={styles.syncRow}>
        <Text style={styles.lastSyncText}>
          {lastSyncTs ? formatRelativeTime(lastSyncTs) : t('history.last_sync_never')}
        </Text>
        <TouchableOpacity
          style={[styles.syncNowButton, (!isConnected || isSyncingAll) && styles.syncNowDisabled]}
          onPress={() => void handleSyncNow()}
          disabled={!isConnected || isSyncingAll}
          accessibilityRole="button"
          accessibilityLabel={t('history.sync_now')}
        >
          {isSyncingAll ? (
            <ActivityIndicator size="small" color={brand.accent} />
          ) : (
            <Text style={styles.syncNowText}>{t('history.sync_now')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'synced' && styles.tabButtonActive]}
          onPress={() => setActiveTab('synced')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'synced' }}
        >
          <Text style={[styles.tabLabel, activeTab === 'synced' && styles.tabLabelActive]}>
            {t('history.synced_tab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'pending' && styles.tabButtonActive]}
          onPress={() => setActiveTab('pending')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'pending' }}
        >
          <Text style={[styles.tabLabel, activeTab === 'pending' && styles.tabLabelActive]}>
            {t('history.pending_tab')}
            {pendingScans.length > 0 ? ` (${pendingScans.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'synced' ? (
        <FlatList
          data={syncedScans}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <SyncedRow item={item} t={t} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl
              refreshing={syncedRefreshing}
              onRefresh={() => void onSyncedRefresh()}
              tintColor={brand.accent}
            />
          }
          onEndReached={() => void handleLoadMore()}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            syncedError ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{t('common.error')}</Text>
                <TouchableOpacity
                  style={styles.retryTextButton}
                  onPress={() => void loadSyncedHistory(null)}
                >
                  <Text style={styles.retryTextButtonText}>{t('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{t('history.synced_empty')}</Text>
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={brand.accent} style={styles.loadMoreSpinner} />
            ) : hasMore ? (
              <TouchableOpacity
                style={styles.loadMoreButton}
                onPress={() => void handleLoadMore()}
              >
                <Text style={styles.loadMoreText}>{t('history.load_more')}</Text>
              </TouchableOpacity>
            ) : null
          }
          contentContainerStyle={syncedScans.length === 0 ? styles.emptyContainer : styles.listContent}
        />
      ) : (
        <FlatList
          data={pendingScans}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PendingRow
              item={item}
              onRetry={() => void handleRetry(item.id)}
              onDiscard={() => confirmDiscard(item.id)}
              t={t}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl
              refreshing={pendingRefreshing}
              onRefresh={() => void onPendingRefresh()}
              tintColor={brand.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>{t('history.pending_empty')}</Text>
            </View>
          }
          contentContainerStyle={pendingScans.length === 0 ? styles.emptyContainer : styles.listContent}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: surface.bg,
  },
  offlineBanner: {
    backgroundColor: state.errorBg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    alignItems: 'center',
  },
  offlineBannerText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: state.error,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: surface.white,
    borderBottomWidth: 1,
    borderBottomColor: surface.border,
  },
  lastSyncText: {
    fontSize: fontSizes.xs,
    color: text.secondary,
  },
  syncNowButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: brand.accent,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
  },
  syncNowDisabled: {
    opacity: 0.4,
  },
  syncNowText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: brand.accent,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: surface.white,
    borderBottomWidth: 1,
    borderBottomColor: surface.border,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: brand.accent,
  },
  tabLabel: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: text.secondary,
  },
  tabLabelActive: {
    fontWeight: fontWeights.semibold,
    color: text.primary,
  },
  separator: {
    height: 1,
    backgroundColor: surface.border,
    marginLeft: spacing[4],
  },
  listContent: {
    paddingBottom: spacing[10],
  },
  emptyContainer: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[16],
    paddingHorizontal: spacing[6],
  },
  emptyText: {
    fontSize: fontSizes.sm,
    color: text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryTextButton: {
    marginTop: spacing[4],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: 8,
    backgroundColor: surface.card,
  },
  retryTextButtonText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: text.primary,
  },
  loadMoreSpinner: {
    marginVertical: spacing[4],
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: spacing[4],
  },
  loadMoreText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: brand.accent,
  },

  // Row shared
  rowMain: {
    flex: 1,
    marginRight: spacing[3],
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: 4,
  },
  stepText: {
    fontSize: fontSizes.xs,
    color: text.secondary,
    marginTop: 2,
  },
  timestamp: {
    fontSize: fontSizes.xs,
    color: text.disabled,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
  },

  // Synced row
  syncedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: surface.white,
  },
  productName: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.medium,
    color: text.primary,
  },
  badgeDelayed: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: state.warningBg,
  },
  badgeDelayedText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    color: state.warning,
  },

  // Pending row
  pendingOuter: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: surface.white,
  },
  pendingActions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    width: SWIPE_REVEAL,
  },
  retryAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: state.pending,
  },
  retryActionText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: surface.white,
  },
  discardAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: state.error,
  },
  discardActionText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: surface.white,
  },
  pendingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: surface.white,
  },
  pendingUUID: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.medium,
    color: text.primary,
  },
})
