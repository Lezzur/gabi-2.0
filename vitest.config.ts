import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/shared/vitest.config.ts',
  'packages/supabase/vitest.config.ts',
  'apps/crm/vitest.config.ts',
  'apps/website/vitest.config.ts',
])
