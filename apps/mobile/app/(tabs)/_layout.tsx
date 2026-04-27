import { Tabs } from 'expo-router'
import { brand, surface, text } from '../../theme'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: brand.accent,
        tabBarInactiveTintColor: text.secondary,
        tabBarStyle: { backgroundColor: surface.white },
        headerStyle: { backgroundColor: brand.primary },
        headerTintColor: text.onDark,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  )
}
