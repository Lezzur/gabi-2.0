import * as SecureStore from 'expo-secure-store'
import { createBrowserClient } from '@gaia/supabase'

const PH_E164 = /^\+639\d{9}$/

export function validatePhPhone(phone: string): boolean {
  return PH_E164.test(phone)
}

export function formatPhPhone(raw: string): string {
  // Normalise: strip spaces/dashes, ensure +63 prefix
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('63')) return `+${digits}`
  if (digits.startsWith('0')) return `+63${digits.slice(1)}`
  return `+63${digits}`
}

export async function sendOtp(phone: string): Promise<{ error: string | null }> {
  if (!validatePhPhone(phone)) {
    return { error: 'Invalid Philippine phone number.' }
  }
  const supabase = createBrowserClient()
  const { error } = await supabase.auth.signInWithOtp({ phone })
  // Never reveal whether the number is registered
  if (error && !error.message.includes('rate')) {
    return { error: null }
  }
  if (error) {
    return { error: 'Too many requests. Please wait before trying again.' }
  }
  return { error: null }
}

export async function verifyOtp(
  phone: string,
  code: string,
): Promise<{ error: string | null }> {
  const supabase = createBrowserClient()
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token: code,
    type: 'sms',
  })
  if (error || !data.session) {
    return { error: 'Invalid or expired code.' }
  }
  // Persist tokens in SecureStore (hardware-backed where available)
  await SecureStore.setItemAsync('sb_access_token', data.session.access_token)
  await SecureStore.setItemAsync('sb_refresh_token', data.session.refresh_token)
  return { error: null }
}

export async function signOut(): Promise<void> {
  const supabase = createBrowserClient()
  await supabase.auth.signOut()
  await SecureStore.deleteItemAsync('sb_access_token')
  await SecureStore.deleteItemAsync('sb_refresh_token')
}
