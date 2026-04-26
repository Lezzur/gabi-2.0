import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { sendOtp, validatePhPhone } from '../../lib/auth'

const PREFIX = '+63'
const LOCAL_LENGTH = 10

export default function PhoneScreen() {
  const router = useRouter()
  const [local, setLocal] = useState('')
  const [loading, setLoading] = useState(false)

  const phone = `${PREFIX}${local}`
  const valid = validatePhPhone(phone)

  async function handleSend() {
    if (!valid) {
      Alert.alert('Invalid number', 'Enter a 10-digit mobile number starting with 9.')
      return
    }
    setLoading(true)
    const { error } = await sendOtp(phone)
    setLoading(false)
    if (error) {
      Alert.alert('Could not send code', error)
      return
    }
    // Generic success message — never reveal whether the number is registered.
    router.push({ pathname: '/(auth)/otp', params: { phone } })
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Enter your mobile number</Text>
        <Text style={styles.subtitle}>We'll send a one-time code to verify your number.</Text>

        <View style={styles.inputRow}>
          <View style={styles.prefix}>
            <Text style={styles.prefixText}>{PREFIX}</Text>
          </View>
          <TextInput
            style={styles.input}
            value={local}
            onChangeText={(t) => setLocal(t.replace(/\D/g, '').slice(0, LOCAL_LENGTH))}
            keyboardType="number-pad"
            placeholder="9XX XXX XXXX"
            maxLength={LOCAL_LENGTH}
            autoFocus
            textContentType="telephoneNumber"
          />
        </View>

        <TouchableOpacity
          style={[styles.button, (!valid || loading) && styles.buttonDisabled]}
          onPress={handleSend}
          disabled={loading || !valid}
        >
          <Text style={styles.buttonText}>{loading ? 'Sending…' : 'Send code'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 14, color: '#666' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10 },
  prefix: { paddingHorizontal: 14, paddingVertical: 14, borderRightWidth: 1, borderColor: '#d1d5db' },
  prefixText: { fontSize: 16, color: '#111' },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: '#111' },
  button: { backgroundColor: '#059669', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
