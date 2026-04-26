import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'

// SecureStore on iOS caps single values at ~2 KB. Supabase sessions can exceed
// that, so we chunk the value across multiple SecureStore keys. All chunks
// remain in the OS keychain / Android Keystore (hardware-backed where available).
const CHUNK_SIZE = 1800

const SecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    const meta = await SecureStore.getItemAsync(`${key}__meta`)
    if (!meta) {
      return SecureStore.getItemAsync(key)
    }
    const { chunks } = JSON.parse(meta) as { chunks: number }
    let result = ''
    for (let i = 0; i < chunks; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`)
      if (part === null) return null
      result += part
    }
    return result
  },
  async setItem(key: string, value: string): Promise<void> {
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value)
      await SecureStore.deleteItemAsync(`${key}__meta`)
      return
    }
    const chunks = Math.ceil(value.length / CHUNK_SIZE)
    for (let i = 0; i < chunks; i++) {
      await SecureStore.setItemAsync(
        `${key}__${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      )
    }
    await SecureStore.setItemAsync(`${key}__meta`, JSON.stringify({ chunks }))
    await SecureStore.deleteItemAsync(key)
  },
  async removeItem(key: string): Promise<void> {
    const meta = await SecureStore.getItemAsync(`${key}__meta`)
    if (meta) {
      const { chunks } = JSON.parse(meta) as { chunks: number }
      for (let i = 0; i < chunks; i++) {
        await SecureStore.deleteItemAsync(`${key}__${i}`)
      }
      await SecureStore.deleteItemAsync(`${key}__meta`)
    }
    await SecureStore.deleteItemAsync(key)
  },
}

const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL'] as string
const supabaseAnonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
