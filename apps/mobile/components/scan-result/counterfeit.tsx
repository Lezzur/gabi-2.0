import { useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Linking,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { en, tl } from '@gaia/shared/i18n';
import { fontSizes, fontWeights, fonts, spacing, state, surface, text } from '../../theme';

type Props = {
  scanId: string;
  onDismiss: () => void;
};

const REPORT_EMAIL = 'report@gaia.ph';

export default function Counterfeit({ scanId, onDismiss }: Props) {
  const scale = useRef(new Animated.Value(1.05)).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const handleReport = () => {
    const subject = encodeURIComponent('Counterfeit Product Report');
    const body = encodeURIComponent(
      `Scan ID: ${scanId}\n\nI believe this product is counterfeit. Please investigate.\n\nLocation: [fill in your location]\nProduct description: [fill in details]`,
    );
    const url = `mailto:${REPORT_EMAIL}?subject=${subject}&body=${body}`;

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          return Linking.openURL(url);
        }
        Alert.alert(
          'Report Counterfeit',
          `Please contact your dealer or send a report to ${REPORT_EMAIL} with Scan ID: ${scanId}`,
          [{ text: 'OK' }],
        );
      })
      .catch(() => {
        Alert.alert('Error', 'Could not open email client.');
      });
  };

  return (
    <SafeAreaView style={styles.root}>
      <Animated.View style={[styles.content, { transform: [{ scale }] }]}>
        {/* Warning icon */}
        <Text style={styles.warningIcon}>⚠</Text>

        {/* Bilingual headline — Tagalog primary, English secondary */}
        <Text style={styles.headlineTl}>{tl.scan.counterfeit.headline}</Text>
        <Text style={styles.headlineEn}>{en.scan.counterfeit.headline}</Text>

        {/* Bilingual body — English first, Tagalog below (M9 spec: always both) */}
        <View style={styles.bodyBlock}>
          <Text style={styles.bodyEn}>{en.scan.counterfeit.body}</Text>
          <Text style={styles.bodyTl}>{tl.scan.counterfeit.body}</Text>
        </View>

        {/* Bilingual action instruction */}
        <View style={styles.actionBlock}>
          <Text style={styles.actionEn}>{en.scan.counterfeit.action}</Text>
          <Text style={styles.actionTl}>{tl.scan.counterfeit.action}</Text>
        </View>
      </Animated.View>

      {/* Buttons */}
      <View style={styles.buttonGroup}>
        <TouchableOpacity style={styles.reportButton} onPress={handleReport} activeOpacity={0.8}>
          <Text style={styles.reportButtonText}>Report this product</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onDismiss} activeOpacity={0.7} style={styles.dismissTouchable}>
          <Text style={styles.dismissText}>{en.scan.counterfeit.dismiss}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: state.error,
    justifyContent: 'space-between',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[12],
    paddingBottom: spacing[8],
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Warning icon
  warningIcon: {
    fontSize: 80,
    color: surface.white,
    marginBottom: spacing[6],
    lineHeight: 88,
  },

  // Headline
  headlineTl: {
    fontFamily: fonts.body,
    fontSize: 48,
    fontWeight: '900',
    color: surface.white,
    textAlign: 'center',
    lineHeight: 52,
  },
  headlineEn: {
    fontFamily: fonts.body,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: spacing[1],
    marginBottom: spacing[6],
  },

  // Body
  bodyBlock: {
    alignItems: 'center',
    marginBottom: spacing[4],
    paddingHorizontal: spacing[2],
  },
  bodyEn: {
    fontFamily: fonts.body,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: surface.white,
    textAlign: 'center',
    lineHeight: fontSizes.lg * 1.4,
    marginBottom: spacing[2],
  },
  bodyTl: {
    fontFamily: fonts.body,
    fontSize: fontSizes.base,
    fontWeight: fontWeights.regular,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: fontSizes.base * 1.5,
  },

  // Action instruction
  actionBlock: {
    alignItems: 'center',
    paddingHorizontal: spacing[2],
  },
  actionEn: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    marginBottom: spacing[1],
  },
  actionTl: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },

  // Buttons
  buttonGroup: {
    alignItems: 'center',
    gap: spacing[4],
  },
  reportButton: {
    width: '100%',
    borderWidth: 2,
    borderColor: surface.white,
    borderRadius: 8,
    paddingVertical: spacing[4],
    alignItems: 'center',
  },
  reportButtonText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: surface.white,
  },
  dismissTouchable: {
    paddingVertical: spacing[2],
  },
  dismissText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    color: surface.white,
  },
});
