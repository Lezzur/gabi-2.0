import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const schema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  topic: z.enum(['general', 'dealer_inquiry', 'report_counterfeit', 'other']),
  message: z.string().min(1).max(5000),
  captchaToken: z.string().min(1),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0'
  );
}

function hashIp(ip: string): string {
  const salt = process.env['HMAC_SECRET'] ?? 'dev';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

function createServiceClient() {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('Missing required env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function verifyCaptcha(token: string, ip: string): Promise<boolean> {
  const secret = process.env['TURNSTILE_SECRET_KEY'];
  if (!secret) {
    // Fail closed: no secret configured → block all submissions
    console.error('[contact] TURNSTILE_SECRET_KEY not set — blocking submission');
    return false;
  }
  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
  } catch {
    // Fail closed: network error or timeout → block
    console.error('[contact] Turnstile verification unreachable — blocking submission');
    return false;
  }
}

function notifyOps(senderEmail: string, topic: string): void {
  // TODO: wire to Resend/SMTP using CONTACT_EMAIL env var
  const dest = process.env['CONTACT_EMAIL'] ?? 'ops@gaia.ph';
  console.info('[contact:notify] to=%s from=%s topic=%s', dest, senderEmail, topic);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED' } }, { status: 400 });
  }

  // Honeypot: bots fill the _trap field; return 200 silently to not reveal detection
  if (
    typeof raw === 'object' &&
    raw !== null &&
    '_trap' in raw &&
    Boolean((raw as Record<string, unknown>)['_trap'])
  ) {
    return NextResponse.json({ data: { submitted: true } });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'VALIDATION_FAILED' } }, { status: 400 });
  }

  const { name, email, phone, topic, message, captchaToken } = parsed.data;

  // CAPTCHA gate — fail closed
  const captchaOk = await verifyCaptcha(captchaToken, ip);
  if (!captchaOk) {
    return NextResponse.json({ error: { code: 'CAPTCHA_FAILED' } }, { status: 400 });
  }

  let db: ReturnType<typeof createServiceClient>;
  try {
    db = createServiceClient();
  } catch {
    console.error('[contact] Supabase client init failed — check env vars');
    return NextResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 });
  }

  // Rate-limit check: count submissions from this IP in the rolling window
  const ipHash = hashIp(ip);
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();

  const { count, error: countErr } = await db
    .from('contact_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', since);

  if (countErr) {
    console.error('[contact] rate-limit query failed: %s', countErr.code);
    return NextResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 });
  }

  if ((count ?? 0) >= RATE_LIMIT) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 });
  }

  // Persist submission — never include submitted values in error response
  const { error: insertErr } = await db.from('contact_submissions').insert({
    name,
    email,
    phone: phone ?? null,
    topic,
    message,
    ip_hash: ipHash,
    status: 'new',
  });

  if (insertErr) {
    console.error('[contact] insert failed: %s', insertErr.code);
    return NextResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 });
  }

  // Fire-and-forget ops notification (only logs topic + sender email, not message body)
  notifyOps(email, topic);

  return NextResponse.json({ data: { submitted: true } });
}
