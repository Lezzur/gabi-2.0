import { StyleSheet, Text, View } from 'react-native';
import { brand, surface, text, fontSizes, fontWeights, spacing } from '../theme';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Gaia</Text>
      <Text style={styles.body}>Fertilizer verification for Filipino farmers.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface.bg,
    padding: spacing[4],
  },
  heading: {
    fontSize: fontSizes['3xl'],
    fontWeight: fontWeights.bold,
    color: brand.primary,
  },
  body: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.regular,
    color: text.secondary,
    marginTop: spacing[2],
    textAlign: 'center',
  },
});
