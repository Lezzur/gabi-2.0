import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ScanProductInfo } from '@gaia/shared/types';
import { formatCountdown, useCountdown } from '@gaia/shared/components/scan-result';
import {
  brand,
  fontSizes,
  fontWeights,
  fonts,
  spacing,
  state,
  surface,
  text,
} from '../../theme';

type Props = {
  deadline: Date;
  product: ScanProductInfo | null;
  onBack: () => void;
};

export default function Pending({ deadline, product, onBack }: Props) {
  const countdown = useCountdown(deadline);
  const isExpired = countdown.state === 'expired';
  const isWarning = countdown.state === 'warning';

  const headerBg = isExpired ? state.error : isWarning ? state.warning : state.pending;

  const timerColor = isExpired
    ? state.error
    : isWarning
      ? state.warning
      : text.primary;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header strip ── */}
        <View style={[styles.header, { backgroundColor: headerBg }]}>
          <Text style={styles.headerLabel}>
            {isExpired ? 'Window Closed' : 'Awaiting Confirmation'}
          </Text>
          {product !== null && (
            <Text style={styles.productName}>{product.product_name}</Text>
          )}
        </View>

        {/* ── Countdown / expired message ── */}
        <View style={styles.timerCard}>
          {isExpired ? (
            <>
              <Text style={styles.expiredText}>Window has closed</Text>
              <Text style={styles.expiredSubtext}>
                The 60-minute confirmation window has expired. Ask your dealer to re-initiate the sale.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.timerLabel}>Confirmation window closes in</Text>
              <Text style={[styles.timerDisplay, { color: timerColor }]}>
                {formatCountdown(countdown)}
              </Text>
              <Text style={styles.timerSubtext}>
                Your dealer needs to scan this product to confirm the purchase.
              </Text>
            </>
          )}
        </View>

        {/* ── Product info (if available) ── */}
        {product !== null && (
          <View style={styles.card}>
            <Text style={styles.company}>{product.company}</Text>
            {product.fpa_registration_number !== null && (
              <Text style={styles.fpaReg}>{product.fpa_registration_number}</Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── CTA ── */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.ctaButton, isExpired && styles.ctaButtonError]}
          onPress={onBack}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>{isExpired ? 'Re-scan' : 'Back to Scanner'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: surface.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing[6],
  },

  // Header
  header: {
    paddingTop: spacing[6],
    paddingBottom: spacing[6],
    paddingHorizontal: spacing[4],
  },
  headerLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.5,
    marginBottom: spacing[1],
  },
  productName: {
    fontFamily: fonts.heading,
    fontSize: 22,
    fontWeight: fontWeights.bold,
    color: surface.white,
    lineHeight: 22 * 1.2,
  },

  // Timer card
  timerCard: {
    backgroundColor: surface.card,
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    borderRadius: 12,
    padding: spacing[6],
    alignItems: 'center',
  },
  timerLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: text.secondary,
    marginBottom: spacing[2],
    textAlign: 'center',
  },
  timerDisplay: {
    fontFamily: fonts.body,
    fontSize: fontSizes['3xl'],
    fontWeight: fontWeights.bold,
    letterSpacing: 2,
    marginBottom: spacing[3],
  },
  timerSubtext: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: text.secondary,
    textAlign: 'center',
    lineHeight: fontSizes.sm * 1.5,
  },
  expiredText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: state.error,
    marginBottom: spacing[3],
    textAlign: 'center',
  },
  expiredSubtext: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: text.secondary,
    textAlign: 'center',
    lineHeight: fontSizes.sm * 1.5,
  },

  // Product info card
  card: {
    backgroundColor: surface.card,
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    borderRadius: 12,
    padding: spacing[4],
  },
  company: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: text.primary,
    marginBottom: spacing[1],
  },
  fpaReg: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: text.secondary,
  },

  // Footer
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    backgroundColor: surface.bg,
    borderTopWidth: 1,
    borderTopColor: surface.border,
  },
  ctaButton: {
    backgroundColor: brand.accent,
    paddingVertical: spacing[4],
    borderRadius: 8,
    alignItems: 'center',
  },
  ctaButtonError: {
    backgroundColor: state.error,
  },
  ctaText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: surface.white,
  },
});
