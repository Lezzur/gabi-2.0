import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { fontSizes, fontWeights, fonts, spacing, state, surface, text } from '../../theme';

type Props = {
  onRescan: () => void;
};

export default function Expired({ onRescan }: Props) {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>
        {/* Icon */}
        <Text style={styles.icon}>⏱</Text>

        {/* Message */}
        <Text style={styles.title}>Scan Window Closed</Text>
        <Text style={styles.body}>
          The 60-minute confirmation window has expired. Ask your dealer to re-initiate the sale.
        </Text>
      </View>

      {/* CTA */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.ctaButton} onPress={onRescan} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Re-scan to start a new window</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: surface.bg,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  icon: {
    fontSize: 56,
    color: text.disabled,
    marginBottom: spacing[4],
  },
  title: {
    fontFamily: fonts.body,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: text.secondary,
    textAlign: 'center',
    marginBottom: spacing[3],
  },
  body: {
    fontFamily: fonts.body,
    fontSize: fontSizes.base,
    color: text.secondary,
    textAlign: 'center',
    lineHeight: fontSizes.base * 1.5,
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: surface.border,
  },
  ctaButton: {
    backgroundColor: state.pending,
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
