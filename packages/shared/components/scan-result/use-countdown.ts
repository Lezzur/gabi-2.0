import { useEffect, useMemo, useRef, useState } from 'react';
import type { CountdownResult, CountdownState } from './types.js';

/**
 * `state === 'warning'` at or below this many total seconds remaining.
 * Matches the UI spec: amber when timer drops to 5:00.
 */
export const WARNING_THRESHOLD_SECONDS = 300;

export type CountdownPlatform = 'web' | 'native';

/**
 * Detect the rendering platform. Web environments expose `window` and
 * `requestAnimationFrame`; React Native does not. Consumers may pass
 * an explicit `platform` override to disambiguate (e.g. in tests or
 * SSR contexts).
 */
export const detectCountdownPlatform = (): CountdownPlatform => {
  if ((globalThis as Record<string, unknown>)['window'] === undefined) return 'native';
  if ((globalThis as Record<string, unknown>)['requestAnimationFrame'] === undefined) return 'native';
  return 'web';
};

const stateForTotal = (total: number): CountdownState => {
  if (total <= 0) return 'expired';
  if (total <= WARNING_THRESHOLD_SECONDS) return 'warning';
  return 'normal';
};

const secondsUntil = (deadlineMs: number, nowMs: number): number => {
  const diffMs = deadlineMs - nowMs;
  return diffMs > 0 ? Math.ceil(diffMs / 1000) : 0;
};

/**
 * Platform-agnostic countdown hook.
 *
 * - Web: drives a `requestAnimationFrame` loop and only bumps state
 *   when the displayed second actually changes (avoids 60fps renders).
 * - Native: drives a `setInterval(1000)` loop.
 * - Cleans up both timer handles on unmount / deadline change.
 * - Returns a memoized, stable reference when inputs are stable.
 */
export const useCountdown = (
  deadline: Date,
  platform: CountdownPlatform = detectCountdownPlatform(),
): CountdownResult => {
  const deadlineMs = deadline.getTime();

  const [total, setTotal] = useState<number>(() => secondsUntil(deadlineMs, Date.now()));

  const rafRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastTotal = secondsUntil(deadlineMs, Date.now());
    setTotal(lastTotal);

    const tick = (): boolean => {
      if (cancelled) return false;
      const next = secondsUntil(deadlineMs, Date.now());
      if (next !== lastTotal) {
        lastTotal = next;
        setTotal(next);
      }
      return next > 0;
    };

    if (platform === 'web') {
      const loop = () => {
        if (cancelled) return;
        const shouldContinue = tick();
        if (shouldContinue) {
          rafRef.current = requestAnimationFrame(loop);
        } else {
          rafRef.current = null;
        }
      };
      if (lastTotal > 0) {
        rafRef.current = requestAnimationFrame(loop);
      }
    } else {
      if (lastTotal > 0) {
        intervalRef.current = setInterval(() => {
          const shouldContinue = tick();
          if (!shouldContinue && intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }, 1000);
      }
    }

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [deadlineMs, platform]);

  return useMemo<CountdownResult>(
    () => ({
      minutesLeft: Math.floor(total / 60),
      secondsLeft: total % 60,
      state: stateForTotal(total),
    }),
    [total],
  );
};
