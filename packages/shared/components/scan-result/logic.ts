import { ScanOutcome } from '../../types/enums.js';
import type {
  CardHeaderTone,
  CountdownResult,
  ScanCardCtaAction,
  ScanCardOutcome,
  ScanCardState,
  ScanResultData,
} from './types.js';

/**
 * Map a card outcome to a semantic header tone. Platform wrappers
 * translate tones to concrete colors via `@gaia/shared/tokens`.
 */
export const headerToneForOutcome = (outcome: ScanCardOutcome): CardHeaderTone => {
  switch (outcome) {
    case ScanOutcome.Success:
      return 'success';
    case 'pending_confirmation':
      return 'pending';
    case ScanOutcome.WindowExpired:
    case ScanOutcome.RateLimited:
      return 'warning';
    case ScanOutcome.HmacInvalid:
    case ScanOutcome.FpaBlocked:
    case ScanOutcome.AlreadyClaimed:
    case ScanOutcome.StateMismatch:
    case ScanOutcome.ConditionRejected:
    case ScanOutcome.ProductDraft:
      return 'error';
    case ScanOutcome.AuthRequired:
      return 'neutral';
    default: {
      const _exhaustive: never = outcome;
      void _exhaustive;
      return 'neutral';
    }
  }
};

/**
 * Whether a live countdown should render. True only when the card is
 * pending confirmation AND a future deadline was provided.
 */
export const shouldShowTimer = (data: ScanResultData, nowMs: number = Date.now()): boolean => {
  if (data.outcome !== 'pending_confirmation') return false;
  if (!data.timer_deadline) return false;
  const deadlineMs = Date.parse(data.timer_deadline);
  if (Number.isNaN(deadlineMs)) return false;
  return deadlineMs > nowMs;
};

/**
 * After a pending-confirmation window expires, the card flips to the
 * post-expiry state: red header + "Re-scan" CTA. The UI spec is
 * explicit that the card does NOT auto-dismiss.
 */
const POST_EXPIRY_CTA_LABEL_FALLBACK = 'Re-scan';
const POST_EXPIRY_CTA_ACTION: ScanCardCtaAction = 'rescan';

/**
 * Derive the card's render state from raw data and (optionally) the
 * live countdown. When a pending-confirmation card's countdown has
 * expired, the CTA is rewritten to a "Re-scan" affordance while
 * preserving the original label's presence for i18n lookup upstream.
 *
 * Pure — safe to call during render.
 */
export const deriveScanCardState = (
  data: ScanResultData,
  countdown?: CountdownResult,
): ScanCardState => {
  const isPendingExpired =
    data.outcome === 'pending_confirmation' && countdown?.state === 'expired';

  if (isPendingExpired) {
    return {
      headerTone: 'error',
      showTimer: false,
      ctaEnabled: true,
      ctaLabel: data.cta_label || POST_EXPIRY_CTA_LABEL_FALLBACK,
      ctaAction: POST_EXPIRY_CTA_ACTION,
    };
  }

  const nowMs = Date.now();
  return {
    headerTone: headerToneForOutcome(data.outcome),
    showTimer: shouldShowTimer(data, nowMs),
    ctaEnabled: true,
    ctaLabel: data.cta_label,
    ctaAction: data.cta_action,
  };
};

/** MM:SS formatter — zero-padded, matches UI spec (Inter 700, 36px, "05:00"). */
export const formatCountdown = (countdown: CountdownResult): string => {
  if (countdown.state === 'expired') return 'EXPIRED';
  const mm = countdown.minutesLeft.toString().padStart(2, '0');
  const ss = countdown.secondsLeft.toString().padStart(2, '0');
  return `${mm}:${ss}`;
};
