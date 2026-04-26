import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@gaia/supabase'

export type AppRole = 'gabs_admin' | 'brand_admin' | 'dealer' | 'farmer'

export async function getSession() {
  const cookieStore = cookies()
  const supabase = createServerClient(cookieStore)
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

export async function requireSession() {
  const user = await getSession()
  if (!user) redirect('/login')
  return user
}

export async function requireRole(role: AppRole) {
  const user = await requireSession()
  const userRole = (user.app_metadata['role'] as AppRole | undefined) ?? null
  if (userRole !== role) redirect('/login')
  return user
}
