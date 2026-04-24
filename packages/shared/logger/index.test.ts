import { describe, it, expect } from 'vitest';
import { createLogger } from './index.js';

function makeCapture() {
  const lines: string[] = [];
  const dest = {
    write(chunk: string) {
      lines.push(chunk.trim());
    },
  };
  const parsed = (i = 0): Record<string, unknown> =>
    JSON.parse(lines[i] ?? '{}') as Record<string, unknown>;
  return { dest, parsed };
}

describe('createLogger — PII masking', () => {
  it('masks phone field and redacts password', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('test', dest);
    logger.info({ phone: '+639171234567', password: 'secret' }, 'user action');
    const log = parsed();
    expect(log['phone']).toBe('+63*****4567');
    expect(log['password']).toBe('[REDACTED]');
  });

  it('masks phoneNumber and phone_number aliases', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('test', dest);
    logger.info({ phoneNumber: '+639171234567', phone_number: '+639991234567' }, 'contact');
    const log = parsed();
    expect(log['phoneNumber']).toBe('+63*****4567');
    expect(log['phone_number']).toBe('+63*****4567');
  });

  it('masks phone numbers by value pattern regardless of key name', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('test', dest);
    logger.info({ contactNo: '+639991234567' }, 'contact');
    expect(parsed()['contactNo']).toBe('+63*****4567');
  });

  it('masks email localpart for any string value matching email pattern', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('test', dest);
    logger.info({ email: 'john@example.com' }, 'user');
    expect(parsed()['email']).toBe('***@example.com');
  });

  it('redacts all named sensitive keys', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('test', dest);
    logger.info(
      {
        token: 'abc123',
        secret: 'shh',
        hmac: 'signature',
        otp: '123456',
        authorization: 'Bearer xyz',
        service_role_key: 'anon-key',
      },
      'keys',
    );
    const log = parsed();
    expect(log['token']).toBe('[REDACTED]');
    expect(log['secret']).toBe('[REDACTED]');
    expect(log['hmac']).toBe('[REDACTED]');
    expect(log['otp']).toBe('[REDACTED]');
    expect(log['authorization']).toBe('[REDACTED]');
    expect(log['service_role_key']).toBe('[REDACTED]');
  });

  it('preserves non-sensitive fields unchanged', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('test', dest);
    logger.info({ userId: 'u_123', outcome: 'ok', latencyMs: 42 }, 'scan');
    const log = parsed();
    expect(log['userId']).toBe('u_123');
    expect(log['outcome']).toBe('ok');
    expect(log['latencyMs']).toBe(42);
  });
});

describe('createLogger — context and child loggers', () => {
  it('bakes context field into every log line', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('auth-service', dest);
    logger.info('hello');
    expect(parsed()['context']).toBe('auth-service');
  });

  it('child logger merges requestId while retaining context', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('api', dest);
    const child = logger.child({ requestId: 'req-abc-123' });
    child.info('handled');
    const log = parsed();
    expect(log['context']).toBe('api');
    expect(log['requestId']).toBe('req-abc-123');
  });

  it('child logger also masks PII', () => {
    const { dest, parsed } = makeCapture();
    const logger = createLogger('api', dest);
    const child = logger.child({ requestId: 'req-001' });
    child.warn({ phone: '+639171234567', token: 'tok' }, 'warn');
    const log = parsed();
    expect(log['phone']).toBe('+63*****4567');
    expect(log['token']).toBe('[REDACTED]');
  });
});
