import { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  AppState,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { verifyOtp, sendOtp } from '../../lib/auth'

const CODE_LENGTH = 6
const RESEND_SECONDS = 60

export default function OtpScreen() {
  const router = useRouter()
  const { phone } = useLocalSearchParams<{ phone: string }>()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(RESEND_SECONDS)
  const [obscured, setObscured] = useState(false)
  const inputRef = useRef<TextInput>(null)

  // Hide OTP in app switcher (iOS privacy)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setObscured(state !== 'active')
    })
    return () => sub.remove()
  }, [])

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  async function handleVerify(value: string) {
    if (value.length < CODE_LENGTH) return
    setLoading(true)
    const { error } = await verifyOtp(phone, value)
    setLoading(false)
    if (error) {
      Alert.alert('Invalid code', error)
      setCode('')
      inputRef.current?.focus()
      return
    }
    router.replace('/')
  }

  function handleChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(digits)
    // Auto-submit on last digit
    if (digits.length === CODE_LENGTH) {
      void handleVerify(digits)
    }
  }

  async function handleResend() {
    if (countdown > 0) return
    setCountdown(RESEND_SECONDS)
    await sendOtp(phone)
  }

  return (
    <View style={styles.root}>
      {obscured && <View style={styles.obscureOverlay} />}

      <View style={styles.container}>
        <Text style={styles.title}>Enter verification code</Text>
        <Text style={styles.subtitle}>Sent to {phone}</Text>

        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={code}
          onChangeText={handleChange}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          autoFocus
          secureTextEntry={false}
        />

        {/* Visual digit boxes */}
        <TouchableOpacity
          style={styles.dotsRow}
          onPress={() => inputRef.current?.focus()}
          activeOpacity={1}
        >
          {Array.from({ length: CODE_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === code.length && styles.dotActive,
                code[i] ? styles.dotFilled : null,
              ]}
            >
              <Text style={styles.dotText}>{code[i] ?? ''}</Text>
            </View>
          ))}
        </TouchableOpacity>

        {loading && <Text style={styles.verifying}>Verifying…</Text>}

        <TouchableOpacity
          onPress={handleResend}
          disabled={countdown > 0}
          style={styles.resend}
        >
          <Text style={[styles.resendText, countdown > 0 && styles.resendDisabled]}>
            {countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  obscureOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 99 },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 14, color: '#666' },
  hiddenInput: { position: 'absolute', opacity: 0, height: 0 },
  dotsRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  dot: { width: 48, height: 56, borderRadius: 10, borderWidth: 1.5, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  dotActive: { borderColor: '#059669' },
  dotFilled: { borderColor: '#111', backgroundColor: '#f9fafb' },
  dotText: { fontSize: 22, fontWeight: '600', color: '#111' },
  verifying: { textAlign: 'center', color: '#666', fontSize: 14 },
  resend: { alignItems: 'center' },
  resendText: { fontSize: 14, color: '#059669', fontWeight: '500' },
  resendDisabled: { color: '#9ca3af' },
})
