import { createServiceClient } from '@gaia/supabase'
import { createOcrAdapter } from './index.js'

const MAX_ATTEMPTS = 3

export async function createOcrJob(userId: string, imageUrl: string): Promise<string> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('ocr_jobs')
    .insert({ user_id: userId, image_url: imageUrl, status: 'queued' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Failed to create OCR job: ${error?.message ?? 'unknown'}`)
  return data.id
}

export async function getOcrJob(jobId: string, userId: string) {
  const db = createServiceClient()
  const { data } = await db
    .from('ocr_jobs')
    .select('id, status, result, error_code, created_at, started_at, completed_at')
    .eq('id', jobId)
    .eq('user_id', userId)
    .single()
  return data ?? null
}

export async function processOcrJob(jobId: string): Promise<void> {
  const db = createServiceClient()

  // Claim atomically: move queued → processing only if still queued (idempotent).
  const { data: claimed } = await db
    .from('ocr_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('image_url, attempt_count')
    .single()

  // No rows updated means job was already claimed or doesn't exist — no-op.
  if (!claimed) return

  const { image_url: imageUrl, attempt_count: attempts } = claimed

  // Hard cap: terminate without retry after MAX_ATTEMPTS failures.
  if (attempts >= MAX_ATTEMPTS) {
    await db
      .from('ocr_jobs')
      .update({
        status: 'failed',
        error_code: 'MAX_ATTEMPTS_EXCEEDED',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    return
  }

  const adapter = createOcrAdapter()
  const result = await adapter.extractLabel(imageUrl)

  if (result.ok) {
    await db
      .from('ocr_jobs')
      .update({
        status: 'completed',
        result: result.value as unknown as Record<string, unknown>,
        attempt_count: attempts + 1,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  } else {
    await db
      .from('ocr_jobs')
      .update({
        status: 'failed',
        error_code: result.error.kind,
        attempt_count: attempts + 1,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  }
}
