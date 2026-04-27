import { useState, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { brand, surface, text, state, spacing, fontSizes, fontWeights } from '../../theme'

const CRM_URL = (process.env['EXPO_PUBLIC_CRM_URL'] ?? '').replace(/\/$/, '')

interface Transaction {
  id: string
  container_id: string
  points: number
  description: string
  created_at: string
}

interface VoucherType {
  id: string
  points_cost: number
  discount_value: number
  description: string
  redeemed: boolean
  expires_at: string
}

interface RedeemSuccess {
  voucher_id: string
  points_deducted: number
  new_balance: number
  discount_value: number
  expires_at: string
  qr_data: string
}

function formatPoints(n: number): string {
  return n.toLocaleString()
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - Date.parse(isoString)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// --- TxRow ---

function TxRow({ item }: { item: Transaction }) {
  const sign = item.points >= 0 ? '+' : ''
  return (
    <View style={styles.txRow}>
      <Text style={styles.txDesc} numberOfLines={2}>
        {item.description}
      </Text>
      <View style={styles.txRight}>
        <Text style={[styles.txPoints, item.points < 0 && styles.txPointsNegative]}>
          {sign}
          {formatPoints(item.points)} pts
        </Text>
        <Text style={styles.txTime}>{formatRelativeTime(item.created_at)}</Text>
      </View>
    </View>
  )
}

// --- VoucherPickerItem ---

function VoucherPickerItem({
  voucher,
  balance,
  onSelect,
}: {
  voucher: VoucherType
  balance: number
  onSelect: (v: VoucherType) => void
}) {
  const canAfford = balance >= voucher.points_cost
  return (
    <TouchableOpacity
      style={[styles.voucherItem, !canAfford && styles.voucherItemDisabled]}
      onPress={() => onSelect(voucher)}
      disabled={!canAfford}
      accessibilityRole="button"
      accessibilityLabel={`Redeem ${voucher.points_cost} points for PHP ${voucher.discount_value} voucher`}
    >
      <View style={styles.voucherItemLeft}>
        <Text style={[styles.voucherDiscount, !canAfford && styles.voucherTextDisabled]}>
          ₱{voucher.discount_value.toFixed(0)} off
        </Text>
        <Text
          style={[styles.voucherDesc, !canAfford && styles.voucherTextDisabled]}
          numberOfLines={2}
        >
          {voucher.description}
        </Text>
        {!canAfford && (
          <Text style={styles.voucherInsufficient}>
            Need {formatPoints(voucher.points_cost - balance)} more pts
          </Text>
        )}
      </View>
      <Text style={[styles.voucherCost, !canAfford && styles.voucherTextDisabled]}>
        {formatPoints(voucher.points_cost)} pts
      </Text>
    </TouchableOpacity>
  )
}

// --- WalletScreen ---

export default function WalletScreen() {
  const [balance, setBalance] = useState(0)
  const [availableVouchers, setAvailableVouchers] = useState<VoucherType[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  const [pickerVisible, setPickerVisible] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [redeemResult, setRedeemResult] = useState<RedeemSuccess | null>(null)

  useFocusEffect(
    useCallback(() => {
      void loadData()
    }, []), // eslint-disable-line react-hooks/exhaustive-deps
  )

  async function getToken(): Promise<string | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  async function loadData() {
    setFetchError(false)
    const token = await getToken()
    if (!token) return

    try {
      const [walletRes, txRes] = await Promise.all([
        fetch(`${CRM_URL}/api/wallets/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${CRM_URL}/api/wallets/me/transactions?limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (!walletRes.ok || !txRes.ok) {
        setFetchError(true)
        return
      }

      const walletJson = (await walletRes.json()) as {
        data: { balance_points: number; vouchers: VoucherType[] }
      }
      const txJson = (await txRes.json()) as {
        data: Transaction[]
        pagination: { next_cursor: string | null; has_more: boolean }
      }

      setBalance(walletJson.data.balance_points)
      setAvailableVouchers(walletJson.data.vouchers.filter((v) => !v.redeemed))
      setTransactions(txJson.data)
      setNextCursor(txJson.pagination.next_cursor)
      setHasMore(txJson.pagination.has_more)
    } catch {
      setFetchError(true)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  async function handleLoadMore() {
    if (!hasMore || loadingMore || !nextCursor) return
    setLoadingMore(true)
    try {
      const token = await getToken()
      if (!token) return

      const res = await fetch(
        `${CRM_URL}/api/wallets/me/transactions?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) return

      const json = (await res.json()) as {
        data: Transaction[]
        pagination: { next_cursor: string | null; has_more: boolean }
      }
      setTransactions((prev) => [...prev, ...json.data])
      setNextCursor(json.pagination.next_cursor)
      setHasMore(json.pagination.has_more)
    } catch {
      // silent — user can retry via pull-to-refresh
    } finally {
      setLoadingMore(false)
    }
  }

  function confirmRedeem(voucher: VoucherType) {
    Alert.alert(
      'Redeem Points?',
      `Redeem ${formatPoints(voucher.points_cost)} points for a ₱${voucher.discount_value.toFixed(0)} voucher? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Redeem',
          style: 'destructive',
          onPress: () => void doRedeem(voucher),
        },
      ],
    )
  }

  async function doRedeem(voucher: VoucherType) {
    setRedeeming(true)
    try {
      const token = await getToken()
      if (!token) return

      const res = await fetch(`${CRM_URL}/api/wallets/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ voucher_type_id: voucher.id }),
      })

      if (res.status === 422) {
        Alert.alert(
          'Insufficient Points',
          `You need ${formatPoints(voucher.points_cost)} points but only have ${formatPoints(balance)}.`,
        )
        return
      }
      if (!res.ok) {
        Alert.alert('Error', 'Could not redeem voucher. Please try again.')
        return
      }

      const json = (await res.json()) as { data: RedeemSuccess }
      setPickerVisible(false)
      setRedeemResult(json.data)
    } catch {
      Alert.alert('Error', 'Could not redeem voucher. Please try again.')
    } finally {
      setRedeeming(false)
    }
  }

  function handleSuccessDone() {
    setRedeemResult(null)
    void loadData()
  }

  return (
    <View style={styles.root}>
      {/* Balance card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Points Balance</Text>
        <Text style={styles.balanceValue}>{formatPoints(balance)}</Text>
        <Text style={styles.balanceUnit}>points</Text>
        <TouchableOpacity
          style={styles.redeemButton}
          onPress={() => setPickerVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Redeem points for voucher"
        >
          <Text style={styles.redeemButtonText}>Redeem</Text>
        </TouchableOpacity>
      </View>

      {/* Transaction list */}
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TxRow item={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={brand.accent}
          />
        }
        onEndReached={() => void handleLoadMore()}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderText}>Recent Transactions</Text>
          </View>
        }
        ListEmptyComponent={
          fetchError ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Could not load transactions.</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadData()}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No transactions yet — scan a GAIA product to earn points
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={brand.accent} style={styles.loadMoreSpinner} />
          ) : hasMore ? (
            <TouchableOpacity style={styles.loadMoreButton} onPress={() => void handleLoadMore()}>
              <Text style={styles.loadMoreText}>Load more</Text>
            </TouchableOpacity>
          ) : null
        }
        contentContainerStyle={transactions.length === 0 ? styles.emptyContainer : styles.listContent}
      />

      {/* Denomination picker modal */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !redeeming && setPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Redeem Points</Text>
              <TouchableOpacity
                onPress={() => setPickerVisible(false)}
                disabled={redeeming}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={styles.pickerClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.pickerBalance}>
              Your balance: {formatPoints(balance)} pts
            </Text>

            {availableVouchers.length === 0 ? (
              <View style={styles.pickerEmpty}>
                <Text style={styles.pickerEmptyText}>No vouchers available right now.</Text>
              </View>
            ) : (
              <FlatList
                data={availableVouchers}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <VoucherPickerItem
                    voucher={item}
                    balance={balance}
                    onSelect={confirmRedeem}
                  />
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                scrollEnabled={availableVouchers.length > 3}
              />
            )}

            {redeeming && (
              <View style={styles.redeemingOverlay}>
                <ActivityIndicator color={brand.accent} size="large" />
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Redeem success modal — shown once, then cleared */}
      <Modal
        visible={redeemResult !== null}
        transparent
        animationType="fade"
        onRequestClose={handleSuccessDone}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.successSheet}>
            <Text style={styles.successTitle}>Voucher Redeemed!</Text>

            <View style={styles.successCodeBox}>
              <Text style={styles.successCodeLabel}>Voucher Code</Text>
              <Text style={styles.successCodeText} selectable>
                {redeemResult?.qr_data}
              </Text>
            </View>

            <Text style={styles.successOnce}>
              Save this code — it won't be shown here again
            </Text>

            <Text style={styles.successDetails}>
              ₱{redeemResult?.discount_value.toFixed(0)} off ·{' '}
              Expires {redeemResult ? formatRelativeTime(redeemResult.expires_at) : ''}
            </Text>

            <Text style={styles.successNewBalance}>
              New balance: {formatPoints(redeemResult?.new_balance ?? 0)} pts
            </Text>

            <TouchableOpacity
              style={styles.successDoneButton}
              onPress={handleSuccessDone}
              accessibilityRole="button"
            >
              <Text style={styles.successDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: surface.bg,
  },

  // Balance card
  balanceCard: {
    backgroundColor: brand.primary,
    alignItems: 'center',
    paddingTop: spacing[8],
    paddingBottom: spacing[6],
    paddingHorizontal: spacing[4],
  },
  balanceLabel: {
    fontSize: fontSizes.sm,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: fontWeights.medium,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  balanceValue: {
    fontSize: 48,
    fontWeight: fontWeights.bold,
    color: text.onDark,
    marginTop: spacing[1],
    lineHeight: 56,
  },
  balanceUnit: {
    fontSize: fontSizes.base,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: spacing[5],
  },
  redeemButton: {
    backgroundColor: brand.accent,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[3],
    borderRadius: 24,
  },
  redeemButtonText: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: text.onDark,
  },

  // Transaction list
  listHeader: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  listHeaderText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingBottom: spacing[10],
  },
  emptyContainer: {
    flexGrow: 1,
  },
  separator: {
    height: 1,
    backgroundColor: surface.border,
    marginLeft: spacing[4],
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
  retryButton: {
    marginTop: spacing[4],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: 8,
    backgroundColor: surface.card,
  },
  retryButtonText: {
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

  // TxRow
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: surface.white,
  },
  txDesc: {
    flex: 1,
    fontSize: fontSizes.sm,
    color: text.primary,
    marginRight: spacing[3],
    lineHeight: 18,
  },
  txRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  txPoints: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: state.success,
  },
  txPointsNegative: {
    color: state.error,
  },
  txTime: {
    fontSize: fontSizes.xs,
    color: text.disabled,
  },

  // Modal shared
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },

  // Picker sheet
  pickerSheet: {
    backgroundColor: surface.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: spacing[8],
    maxHeight: '70%',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: surface.border,
  },
  pickerTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: text.primary,
  },
  pickerClose: {
    fontSize: fontSizes.lg,
    color: text.secondary,
    paddingHorizontal: spacing[2],
  },
  pickerBalance: {
    fontSize: fontSizes.sm,
    color: text.secondary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  pickerEmpty: {
    alignItems: 'center',
    paddingVertical: spacing[10],
  },
  pickerEmptyText: {
    fontSize: fontSizes.sm,
    color: text.secondary,
  },
  redeemingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },

  // VoucherPickerItem
  voucherItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    backgroundColor: surface.white,
  },
  voucherItemDisabled: {
    opacity: 0.5,
  },
  voucherItemLeft: {
    flex: 1,
    marginRight: spacing[3],
  },
  voucherDiscount: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    color: text.primary,
  },
  voucherDesc: {
    fontSize: fontSizes.sm,
    color: text.secondary,
    marginTop: 2,
    lineHeight: 18,
  },
  voucherInsufficient: {
    fontSize: fontSizes.xs,
    color: state.error,
    marginTop: 4,
  },
  voucherCost: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: brand.accent,
  },
  voucherTextDisabled: {
    color: text.disabled,
  },

  // Success sheet
  successSheet: {
    backgroundColor: surface.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing[6],
    paddingTop: spacing[6],
    paddingBottom: spacing[10],
    alignItems: 'center',
  },
  successTitle: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: state.success,
    marginBottom: spacing[5],
  },
  successCodeBox: {
    width: '100%',
    backgroundColor: surface.bg,
    borderRadius: 12,
    padding: spacing[4],
    alignItems: 'center',
    marginBottom: spacing[4],
    borderWidth: 1,
    borderColor: surface.border,
  },
  successCodeLabel: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing[2],
  },
  successCodeText: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    color: text.primary,
    letterSpacing: 1,
    textAlign: 'center',
  },
  successOnce: {
    fontSize: fontSizes.sm,
    color: state.warning,
    fontWeight: fontWeights.medium,
    textAlign: 'center',
    marginBottom: spacing[3],
  },
  successDetails: {
    fontSize: fontSizes.sm,
    color: text.secondary,
    textAlign: 'center',
    marginBottom: spacing[2],
  },
  successNewBalance: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: text.primary,
    marginBottom: spacing[6],
  },
  successDoneButton: {
    backgroundColor: brand.primary,
    paddingHorizontal: spacing[10],
    paddingVertical: spacing[3],
    borderRadius: 24,
  },
  successDoneText: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: text.onDark,
  },
})
