import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { FpaStatus, ScanProductInfo, ToxicityCategory } from '@gaia/shared/types';
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
  product: ScanProductInfo | null;
  farmerPoints: number;
  monthsRemaining: number | undefined;
  step: 'purchase' | 'return';
  onBack: () => void;
};

const FORMULATION_MONTHS_MAX = 24;

function toxicityInfo(cat: ToxicityCategory): { icon: string; label: string } {
  switch (cat) {
    case '1': return { icon: '☠', label: 'Extremely Hazardous (Cat. I — Red Label)' };
    case '2': return { icon: '⚠', label: 'Highly Hazardous (Cat. II — Yellow Label)' };
    case '3': return { icon: '⚠', label: 'Moderately Hazardous (Cat. III)' };
    case '4': return { icon: '●', label: 'Slightly Hazardous (Cat. IV)' };
  }
}

function fpaLabel(status: FpaStatus): string {
  switch (status) {
    case 'valid': return 'FPA Valid';
    case 'expiring_soon': return 'FPA Expiring Soon';
    case 'expired': return 'FPA Expired — Use with caution';
  }
}

function fpaColors(status: FpaStatus): { bg: string; fg: string } {
  switch (status) {
    case 'valid': return { bg: state.successBg, fg: state.success };
    case 'expiring_soon': return { bg: state.warningBg, fg: state.warning };
    case 'expired': return { bg: state.errorBg, fg: state.error };
  }
}

function formulationBarColor(months: number): string {
  if (months > 6) return state.success;
  if (months >= 2) return state.warning;
  return state.error;
}

export default function PurchaseSuccess({ product, farmerPoints, monthsRemaining, step, onBack }: Props) {
  const isReturn = step === 'return';
  const headerIcon = isReturn ? '↩' : '✓';
  const headerLabel = isReturn ? 'Return Complete' : 'Verified Purchase';

  const tox = product?.category != null ? toxicityInfo(product.category) : null;
  const fpa = product != null ? fpaColors(product.fpa_status) : null;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header strip ── */}
        <View style={styles.header}>
          <View style={styles.headerBadge}>
            <Text style={styles.headerIcon}>{headerIcon}</Text>
            <Text style={styles.headerBadgeText}>{headerLabel}</Text>
          </View>
          {product !== null && (
            <Text style={styles.productName}>{product.product_name}</Text>
          )}
        </View>

        {/* ── Product info card ── */}
        <View style={styles.card}>
          {product !== null && (
            <>
              <Text style={styles.company}>{product.company}</Text>
              {product.fpa_registration_number !== null && (
                <View style={styles.fpaRegRow}>
                  <Text style={styles.fpaRegNumber}>{product.fpa_registration_number}</Text>
                  <Text style={styles.fpaRegLabel}>Registered by FPA</Text>
                </View>
              )}
            </>
          )}

          {farmerPoints > 0 && (
            <View style={styles.pointsRow}>
              <Text style={styles.pointsText}>✦ {farmerPoints} points credited to your account</Text>
            </View>
          )}
        </View>

        {/* ── Safety section ── */}
        {product !== null && (tox !== null || product.pre_harvest_interval !== null || product.re_entry_period !== null || product.note_to_physician !== null) && (
          <View style={styles.safetySection}>
            <Text style={styles.safetySectionTitle}>Safety Information</Text>

            {tox !== null && (
              <View style={styles.safetyRow}>
                <Text style={styles.toxIcon}>{tox.icon}</Text>
                <Text style={styles.toxLabel}>{tox.label}</Text>
              </View>
            )}

            {product.pre_harvest_interval !== null && (
              <View style={styles.safetyRow}>
                <Text style={styles.safetyFieldLabel}>Pre-Harvest Interval</Text>
                <Text style={styles.safetyFieldValue}>{product.pre_harvest_interval}</Text>
              </View>
            )}

            {product.re_entry_period !== null && (
              <View style={styles.safetyRow}>
                <Text style={styles.safetyFieldLabel}>Re-Entry Period</Text>
                <Text style={styles.safetyFieldValue}>{product.re_entry_period}</Text>
              </View>
            )}

            {product.note_to_physician !== null && (
              <View style={styles.noteRow}>
                <Text style={styles.noteLabel}>⚠ Note to Physician:</Text>
                <Text style={styles.noteText}>{product.note_to_physician}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Formulation status bar ── */}
        {monthsRemaining !== undefined && (
          <View style={styles.card}>
            <Text style={[styles.formulationLabel, { color: formulationBarColor(monthsRemaining) }]}>
              Formulation expires in {monthsRemaining} month{monthsRemaining !== 1 ? 's' : ''}
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min((monthsRemaining / FORMULATION_MONTHS_MAX) * 100, 100)}%` as `${number}%`,
                    backgroundColor: formulationBarColor(monthsRemaining),
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* ── FPA status badge ── */}
        {product !== null && fpa !== null && (
          <View style={[styles.fpaBadge, { backgroundColor: fpa.bg }]}>
            <Text style={[styles.fpaBadgeText, { color: fpa.fg }]}>
              {fpaLabel(product.fpa_status)}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Sticky CTA ── */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.ctaButton} onPress={onBack} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Back to Scanner</Text>
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
    backgroundColor: brand.primary,
    paddingTop: spacing[6],
    paddingBottom: spacing[6],
    paddingHorizontal: spacing[4],
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  headerIcon: {
    fontSize: fontSizes.lg,
    color: text.onDark,
    marginRight: spacing[2],
  },
  headerBadgeText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: text.onDark,
    letterSpacing: 0.5,
  },
  productName: {
    fontFamily: fonts.heading,
    fontSize: 22,
    fontWeight: fontWeights.bold,
    color: text.onDark,
    lineHeight: 22 * 1.2,
  },

  // Cards
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
    marginBottom: spacing[2],
  },
  fpaRegRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  fpaRegNumber: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: text.primary,
  },
  fpaRegLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.xs,
    color: text.secondary,
  },

  // Points
  pointsRow: {
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: surface.border,
  },
  pointsText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: state.success,
  },

  // Safety section
  safetySection: {
    backgroundColor: 'rgba(184, 105, 10, 0.08)',
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    borderRadius: 12,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: 'rgba(184, 105, 10, 0.2)',
  },
  safetySectionTitle: {
    fontFamily: fonts.body,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: state.warning,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing[3],
  },
  safetyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
    gap: spacing[2],
  },
  toxIcon: {
    fontSize: fontSizes.lg,
    color: text.primary,
    width: 24,
    textAlign: 'center',
  },
  toxLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: text.primary,
    flex: 1,
  },
  safetyFieldLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: text.secondary,
    width: 140,
    flexShrink: 0,
  },
  safetyFieldValue: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: text.primary,
    flex: 1,
  },
  noteRow: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: 'rgba(184, 105, 10, 0.2)',
  },
  noteLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: state.warning,
    marginBottom: spacing[1],
  },
  noteText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: text.primary,
    lineHeight: fontSizes.sm * 1.5,
  },

  // Formulation bar
  formulationLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    marginBottom: spacing[2],
  },
  progressTrack: {
    height: 6,
    backgroundColor: surface.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  // FPA badge
  fpaBadge: {
    alignSelf: 'flex-start',
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: 9999,
  },
  fpaBadgeText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },

  // Footer CTA
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
  ctaText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: surface.white,
  },
});
