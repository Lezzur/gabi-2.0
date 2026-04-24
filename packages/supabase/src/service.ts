import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL } from './env'
import type { Database } from './types'

export const SERVICE_ROLE_WARNING =
  'createServiceClient() uses the Supabase service role key which bypasses Row Level Security. ' +
  'Only call this from trusted server-side code — never expose to clients.'

export function createServiceClient() {
  if (typeof window !== 'undefined') {
    throw new Error('[@gaia/supabase] createServiceClient() is server-only. Do not import from browser code.')
  }

  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!key) {
    throw new Error('[@gaia/supabase] Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient<Database>(SUPABASE_URL, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
