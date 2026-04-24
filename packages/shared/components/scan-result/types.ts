import type { ScanOutcome } from '../../types/enums.js';
import type { ScanProductInfo } from '../../types/product.js';

/**
 * Card-level outcome: extends the granular ScanOutcome enum with
 * `pending_confirmation`, which is not a scan "outcome" per se but a
 * display state while the counterparty scan is outstanding.
 *
 * Map from a ScanResponse:
 *   - ScanSuccessResponse                 → 'success'
 *   - ScanPendingConfirmationResponse     → 'pending_confirmation'
 *   - ScanRejectedResponse { error.code } → the matching ScanOutcome literal
 */
export type ScanCardOutcome = ScanOutcome | 'pending_confirmation';

/**
 * Actions a consumer may bind to the card's footer CTA. These are
 * semantic — the platform wrapper decides what they do (navigate,
 * dispatch, etc.).
 */
export type ScanCardCtaAction =
  | 'dismiss'
  | 'rescan'
  | 'confirm'
  | 'view_wallet'
  | 'report'
  | 'retry'
  | 'sign_in';

/**
 * Data the card needs to render. Platform wrappers pass this through
 * unchanged from the scan API response + i18n layer.
 */
export type ScanResultData = Readonly<{
  outcome: ScanCardOutcome;
  product: ScanProductInfo | null;
  /** ISO-8601 timestamp. Present only for `pending_confirmation`. */
  timer_deadline?: string;
  cta_label: string;
  cta_action: ScanCardCtaAction;
  /** Localized message for the card body (optional). */
  message?: string;
}>;

/** Three visual phases of a dealer-scan countdown. */
export type CountdownState = 'normal' | 'warning' | 'expired';

export type CountdownResult = Readonly<{
  minutesLeft: number;
  secondsLeft: number;
  state: CountdownState;
}>;

/**
 * Semantic header tone. Platform wrappers map this to their own
 * palette (CRM uses `@gaia/shared/tokens`; mobile uses RN styles).
 */
export type CardHeaderTone = 'success' | 'pending' | 'warning' | 'error' | 'neutral';

/**
 * Derived render state from ScanResultData (+ optional countdown).
 * Pure — produced by `deriveScanCardState`.
 */
export type ScanCardState = Readonly<{
  headerTone: CardHeaderTone;
  /** True iff the card should render a live countdown (pending + future deadline). */
  showTimer: boolean;
  ctaEnabled: boolean;
  ctaLabel: string;
  ctaAction: ScanCardCtaAction;
}>;
