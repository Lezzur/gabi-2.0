import { Stack } from 'expo-router';
import { brand, surface, text } from '../theme';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: brand.primary },
        headerTintColor: text.onDark,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: surface.bg },
      }}
    />
  );
}
