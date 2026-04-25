'use client';

import { useState, useId, type FormEvent } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';

type Topic = 'general' | 'dealer_inquiry' | 'report_counterfeit' | 'other';
type FormState = 'idle' | 'submitting' | 'success' | 'error' | 'rate_limited';

const TOPICS: { value: Topic; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'dealer_inquiry', label: 'Dealer Inquiry' },
  { value: 'report_counterfeit', label: 'Report Counterfeit' },
  { value: 'other', label: 'Other' },
];

// Turnstile test key works in dev without configuring a real site key.
// Production: set NEXT_PUBLIC_TURNSTILE_SITE_KEY in your environment.
const SITE_KEY =
  process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY'] ?? '1x00000000000000000000AA';

// ─── FloatingInput ────────────────────────────────────────────────────────────

interface FloatingInputProps {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel';
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
}

function FloatingInput({
  id,
  name,
  label,
  type,
  required,
  disabled,
  autoComplete,
}: FloatingInputProps) {
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={type}
        placeholder=" "
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        className="peer w-full rounded-md border border-surface-border bg-white px-3 pt-6 pb-2 text-sm text-gaia-text-primary focus:outline-none focus:border-brand-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-3 top-1 text-[10px] font-medium text-brand-accent transition-all duration-150 peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:text-gaia-text-secondary peer-focus:top-1 peer-focus:text-[10px] peer-focus:font-medium peer-focus:text-brand-accent"
      >
        {label}
      </label>
    </div>
  );
}

// ─── FloatingTextarea ─────────────────────────────────────────────────────────

interface FloatingTextareaProps {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
  rows?: number;
}

function FloatingTextarea({
  id,
  name,
  label,
  required,
  disabled,
  rows = 5,
}: FloatingTextareaProps) {
  return (
    <div className="relative">
      <textarea
        id={id}
        name={name}
        placeholder=" "
        required={required}
        disabled={disabled}
        rows={rows}
        className="peer w-full resize-none rounded-md border border-surface-border bg-white px-3 pt-6 pb-2 text-sm text-gaia-text-primary focus:outline-none focus:border-brand-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-3 top-1 text-[10px] font-medium text-brand-accent transition-all duration-150 peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:text-gaia-text-secondary peer-focus:top-1 peer-focus:text-[10px] peer-focus:font-medium peer-focus:text-brand-accent"
      >
        {label}
      </label>
    </div>
  );
}

// ─── ContactForm ──────────────────────────────────────────────────────────────

export function ContactForm() {
  const uid = useId();
  const [formState, setFormState] = useState<FormState>('idle');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Honeypot: tracked in state so it's included in JSON body (bots fill visible fields)
  const [trap, setTrap] = useState('');

  const isSubmitting = formState === 'submitting';

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const data = new FormData(e.currentTarget);

    const body = {
      name: String(data.get('name') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      phone: String(data.get('phone') ?? '').trim() || undefined,
      topic: data.get('topic') as Topic,
      message: String(data.get('message') ?? '').trim(),
      captchaToken: captchaToken ?? '',
      _trap: trap,
    };

    setFormState('submitting');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        setFormState('rate_limited');
        return;
      }
      if (!res.ok) {
        setFormState('error');
        return;
      }

      setFormState('success');
    } catch {
      setFormState('error');
    }
  }

  // ── Success state ─────────────────────────────────────────────────────────

  if (formState === 'success') {
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-[#EBF5EF]"
        >
          <svg
            className="h-8 w-8 text-[#2E7D4F]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <p className="text-xl font-semibold text-gaia-text-primary">
          We&rsquo;ll be in touch.
        </p>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {/* Honeypot — hidden from real users via off-screen positioning */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', top: 0, height: 0, overflow: 'hidden' }}
      >
        <label htmlFor={`${uid}-trap`}>Website</label>
        <input
          id={`${uid}-trap`}
          type="text"
          name="_trap"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
        />
      </div>

      {/* Status banners */}
      {formState === 'rate_limited' && (
        <div role="alert" className="rounded-md bg-red-100 px-4 py-3 text-sm text-red-700">
          Too many requests. Please wait before sending again.
        </div>
      )}
      {formState === 'error' && (
        <div role="alert" className="rounded-md bg-red-100 px-4 py-3 text-sm text-red-700">
          Something went wrong — try again.
        </div>
      )}

      {/* Name + Email */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <FloatingInput
          id={`${uid}-name`}
          name="name"
          label="Name"
          type="text"
          required
          disabled={isSubmitting}
          autoComplete="name"
        />
        <FloatingInput
          id={`${uid}-email`}
          name="email"
          label="Email"
          type="email"
          required
          disabled={isSubmitting}
          autoComplete="email"
        />
      </div>

      {/* Phone */}
      <FloatingInput
        id={`${uid}-phone`}
        name="phone"
        label="Phone (optional)"
        type="tel"
        disabled={isSubmitting}
        autoComplete="tel"
      />

      {/* Topic */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${uid}-topic`}
          className="text-xs font-medium text-brand-accent"
        >
          Topic
        </label>
        <select
          id={`${uid}-topic`}
          name="topic"
          required
          disabled={isSubmitting}
          defaultValue="general"
          className="w-full rounded-md border border-surface-border bg-white px-3 py-2.5 text-sm text-gaia-text-primary focus:outline-none focus:border-brand-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Message */}
      <FloatingTextarea
        id={`${uid}-message`}
        name="message"
        label="Message"
        required
        disabled={isSubmitting}
        rows={5}
      />

      {/* Turnstile CAPTCHA */}
      <Turnstile
        siteKey={SITE_KEY}
        onSuccess={setCaptchaToken}
        onExpire={() => setCaptchaToken(null)}
        onError={() => setCaptchaToken(null)}
      />

      {/* Submit */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex h-12 items-center justify-center rounded-md bg-brand-accent px-8 font-semibold text-[#1A1A1A] transition-colors hover:bg-brand-accentHover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? (
          <>
            <svg
              aria-hidden="true"
              className="mr-2 h-4 w-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Sending…
          </>
        ) : (
          'Send message'
        )}
      </button>
    </form>
  );
}
