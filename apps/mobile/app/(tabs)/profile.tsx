import '../../lib/i18n'
import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { useTranslation } from 'react-i18next'
import i18n from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { signOut } from '../../lib/auth'
import { brand, surface, text, state, spacing, fontSizes, fontWeights } from '../../theme'
import type { LocaleCode } from '@gaia/shared/i18n'

const OFFLINE_QUEUE_KEY = 'gaia:offline_queue'
const LOCALE_STORAGE_KEY = 'gaia:locale'

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0'
const BUILD_NUMBER =
  Constants.expoConfig?.ios?.buildNumber ??
  String(Constants.expoConfig?.android?.versionCode ?? '1')

function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone
  const last4 = phone.slice(-4)
  return `+63*****${last4}`
}

async function getOfflineQueueCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)
    if (!raw) return 0
    const items = JSON.parse(raw) as unknown[]
    return Array.isArray(items) ? items.length : 0
  } catch {
    return 0
  }
}

export default function ProfileScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const [phone, setPhone] = useState<string | null>(null)
  const [locale, setLocale] = useState<LocaleCode>('en')
  const [signingOut, setSigningOut] = useState(false)
  const [localeLoading, setLocaleLoading] = useState(false)

  useEffect(() => {
    void loadProfile()
  }, [])

  async function loadProfile() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (session?.user?.phone) {
      setPhone(session.user.phone)
    }

    if (session?.user?.id) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('locale')
        .eq('id', session.user.id)
        .single()

      if (profile?.locale === 'en' || profile?.locale === 'tl') {
        setLocale(profile.locale)
        await i18n.changeLanguage(profile.locale)
        return
      }
    }

    // Fall back to locally persisted locale
    const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'en' || stored === 'tl') {
      setLocale(stored)
      await i18n.changeLanguage(stored)
    }
  }

  async function handleLocaleToggle() {
    if (localeLoading) return
    const next: LocaleCode = locale === 'en' ? 'tl' : 'en'
    setLocaleLoading(true)
    setLocale(next)

    // Apply immediately — no restart needed
    await i18n.changeLanguage(next)
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, next)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('user_profiles').update({ locale: next }).eq('id', user.id)
    }

    setLocaleLoading(false)
  }

  function confirmSignOut() {
    void (async () => {
      const queueCount = await getOfflineQueueCount()
      const hasQueue = queueCount > 0

      Alert.alert(
        hasQueue
          ? t('profile.sign_out_queue_warning_title')
          : t('profile.sign_out_confirm_title'),
        hasQueue ? t('profile.sign_out_queue_warning') : t('profile.sign_out_confirm_body'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('profile.sign_out_confirm_destructive'),
            style: 'destructive',
            onPress: () => void doSignOut(),
          },
        ],
      )
    })()
  }

  async function doSignOut() {
    setSigningOut(true)
    try {
      await AsyncStorage.multiRemove([OFFLINE_QUEUE_KEY, LOCALE_STORAGE_KEY])
      await signOut()
    } finally {
      setSigningOut(false)
      router.replace('/(auth)/phone')
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Account */}
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.phone_label')}</Text>
          <Text style={styles.rowValue}>{phone ? maskPhone(phone) : '—'}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.locale_label')}</Text>
          <View style={styles.localeRow}>
            <Text style={[styles.localeOption, locale === 'en' && styles.localeOptionActive]}>
              {t('profile.locale_en')}
            </Text>
            <Switch
              value={locale === 'tl'}
              onValueChange={() => void handleLocaleToggle()}
              disabled={localeLoading}
              thumbColor={surface.white}
              trackColor={{ false: text.disabled, true: brand.accent }}
            />
            <Text style={[styles.localeOption, locale === 'tl' && styles.localeOptionActive]}>
              {t('profile.locale_tl')}
            </Text>
          </View>
        </View>
      </View>

      {/* App info */}
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.version_label')}</Text>
          <Text style={styles.rowValue}>{APP_VERSION}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.build_label')}</Text>
          <Text style={styles.rowValue}>{BUILD_NUMBER}</Text>
        </View>
      </View>

      {/* Sign out */}
      <TouchableOpacity
        style={[styles.signOutButton, signingOut && styles.signOutDisabled]}
        onPress={confirmSignOut}
        disabled={signingOut}
        accessibilityRole="button"
        accessibilityLabel={t('profile.sign_out')}
      >
        {signingOut ? (
          <ActivityIndicator color={state.error} />
        ) : (
          <Text style={styles.signOutText}>{t('profile.sign_out')}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: surface.bg,
  },
  content: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[6],
    paddingBottom: spacing[10],
    gap: spacing[4],
  },
  card: {
    backgroundColor: surface.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: surface.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  rowLabel: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: text.secondary,
  },
  rowValue: {
    fontSize: fontSizes.base,
    color: text.primary,
  },
  divider: {
    height: 1,
    backgroundColor: surface.border,
    marginHorizontal: spacing[4],
  },
  localeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  localeOption: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: text.disabled,
  },
  localeOptionActive: {
    color: text.primary,
  },
  signOutButton: {
    paddingVertical: spacing[4],
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: state.error,
    alignItems: 'center',
    backgroundColor: surface.white,
  },
  signOutDisabled: {
    opacity: 0.5,
  },
  signOutText: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.semibold,
    color: state.error,
  },
})
