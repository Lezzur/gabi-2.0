import { z } from 'zod'

const schema = z.object({
  SUPABASE_URL: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
})

const result = schema.safeParse(process.env)
if (!result.success) {
  const missing = result.error.issues
    .map(issue => String(issue.path[0]))
    .join(', ')
  throw new Error(`[@gaia/supabase] Missing required environment variables: ${missing}`)
}

export const { SUPABASE_URL, SUPABASE_ANON_KEY } = result.data
