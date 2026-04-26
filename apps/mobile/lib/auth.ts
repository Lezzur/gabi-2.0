import { supabase } from './supabase'

const PH_E164 = /^\+639\d{9}$/

export function validatePhPhone(phone: string): boolean {
  return PH_E164.test(phone)
}

export function formatPhPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('63')) return `+${digits}`
  if (digits.startsWith('0')) return `+63${digits.slice(1)}`
  return `+63${digits}`
}

export type SendOtpResult = { error: string | null }

export async function sendOtp(phone: string): Promise<SendOtpResult> {
  if (!validatePhPhone(phone)) {
    return { error: 'Please enter a valid Philippine mobile number.' }
  }

  const { error } = await supabase.auth.signInWithOtp({ phone })

  if (!error) return { error: null }

  // Surface rate-limit errors so the user understands the throttle.
  // Server-side: Supabase Auth enforces OTP rate limits per phone
  // (configured to 3 requests / 5 minutes, matching the p5 rate-limit policy).
  const status = (error as { status?: number }).status
  if (status === 429 || /rate|too many|limit/i.test(error.message)) {
    return { error: 'Too many requests. Please wait a few minutes before trying again.' }
  }

  // For all other errors (including "user not found" / unregistered numbers),
  // return success to prevent phone-number enumeration.
  return { error: null }
}

export async function verifyOtp(
  phone: string,
  code: string,
): Promise<{ error: string | null }> {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token: code,
    type: 'sms',
  })
  if (error || !data.session) {
    return { error: 'Invalid or expired code.' }
  }
  return { error: null }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
