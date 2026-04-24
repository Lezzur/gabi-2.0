import pino from 'pino';

const REDACT_KEYS = [
  'password',
  'token',
  'secret',
  'authorization',
  'service_role_key',
  'hmac',
  'otp',
] as const;

const PHONE_KEYS = ['phone', 'phoneNumber', 'phone_number'] as const;

const PHONE_KEYS_SET: ReadonlySet<string> = new Set<string>(PHONE_KEYS);
const PHONE_RE = /^\+?\d{10,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function maskPhone(val: string): string {
  return `+63*****${val.slice(-4)}`;
}

function maskEmail(val: string): string {
  const at = val.indexOf('@');
  return at !== -1 ? `***${val.slice(at)}` : val;
}

// Called by pino redact for every path listed in redactPaths.
// Phone-keyed fields get partial masking; everything else is fully redacted.
function censorFn(value: unknown, path: string[]): unknown {
  const key = path[path.length - 1];
  if (key !== undefined && PHONE_KEYS_SET.has(key) && typeof value === 'string') {
    return maskPhone(value);
  }
  return '[REDACTED]';
}

const redactPaths: string[] = [...REDACT_KEYS, ...PHONE_KEYS];

// Runs before redact (pino order: serializers → formatters.log → redact).
// Handles value-pattern phone/email detection for keys NOT in redactPaths.
function sanitizeLog(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && !PHONE_KEYS_SET.has(key)) {
      if (PHONE_RE.test(val)) {
        out[key] = maskPhone(val);
      } else if (EMAIL_RE.test(val)) {
        out[key] = maskEmail(val);
      } else {
        out[key] = val;
      }
    } else {
      out[key] = val;
    }
  }
  return out;
}

const isDev = process.env['NODE_ENV'] !== 'production';

const BASE_OPTIONS: pino.LoggerOptions = {
  level: 'info',
  redact: {
    paths: redactPaths,
    censor: censorFn,
  },
  formatters: {
    log: sanitizeLog,
  },
};

export interface LogFn {
  (msg: string): void;
  (obj: object, msg?: string): void;
}

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * @param context - baked into every log line as the `context` field
 * @param dest - optional write destination; pass a writable for testing
 */
export function createLogger(
  context: string,
  dest?: { write(chunk: string): void },
): Logger {
  let instance: pino.Logger;

  if (dest) {
    instance = pino(BASE_OPTIONS, dest as unknown as pino.DestinationStream);
  } else if (isDev) {
    instance = pino({
      ...BASE_OPTIONS,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  } else {
    instance = pino(BASE_OPTIONS);
  }

  return instance.child({ context }) as unknown as Logger;
}
