/**
 * GAIA Color Tokens — single source of truth for web and React Native.
 *
 * IMPORTANT — Brand green vs Success green:
 *   brand.primary (#1A3D2E) is a deep forest green used exclusively for chrome:
 *   navigation backgrounds, headers, sidebar, and brand identity surfaces.
 *
 *   state.success (#2E7D4F) is a mid-green used ONLY for feedback states (✅ scan
 *   confirmed, transaction complete). It is intentionally lighter and visually distinct
 *   so traffic-light semantics never bleed into brand identity. Never substitute one
 *   for the other. — UI Design Decision, GAIA Design System.
 */

export const brand = {
  primary:      '#1A3D2E', // deep forest green — nav, headers, brand chrome
  primaryHover: '#143024', // pressed/hover on primary
  dark:         '#122B1F', // deep background, pressed states
  accent:       '#C8952A', // gold — CTAs, active states, reward highlights
  accentHover:  '#B07A1A', // pressed/hover on accent
} as const;

export const surface = {
  bg:     '#F5EDD8', // cream — website + mobile page backgrounds
  card:   '#EDE5CC', // cream-deep — card surfaces on cream backgrounds
  white:  '#FFFFFF',
  border: '#E0D8CC',
} as const;

export const text = {
  primary:   '#1A1A1A', // body copy
  secondary: '#5A5A5A', // labels, secondary content
  disabled:  '#9A9A9A',
  onDark:    '#F5EDD8', // text on brand green / dark backgrounds
} as const;

/**
 * Semantic state tokens.
 * Use these for UI feedback, never for branding.
 */
export const state = {
  success:    '#2E7D4F', // mid-green feedback — distinct from brand.primary
  successBg:  '#EBF5EF',
  warning:    '#B8690A', // amber-brown — FPA expiry, general caution
  warningBg:  '#FEF3E2',
  error:      '#B91C1C', // hard block — HMAC invalid, FPA hard block
  errorBg:    '#FEE2E2',
  pending:    '#1E6A8A', // countdown active, in-progress
  pendingBg:  '#E0F2FE',
} as const;

/**
 * Amber scale — safety-gate confirmations, FPA expiry warnings.
 * Maps to Tailwind amber-* utilities when wired via tailwind.ts.
 */
export const amber = {
  50:  '#FFFBEB',
  100: '#FEF3C7',
  200: '#FDE68A',
  300: '#FCD34D',
  400: '#FBBF24',
  500: '#F59E0B',
  600: '#D97706',
  700: '#B45309', // safety-gate amber (UI design: state-warning #B8690A neighbour)
  800: '#92400E',
  900: '#78350F',
} as const;

/**
 * Red scale — counterfeit flags, HMAC errors, hard blocks.
 * Maps to Tailwind red-* utilities when wired via tailwind.ts.
 */
export const red = {
  50:  '#FEF2F2',
  100: '#FEE2E2',
  200: '#FECACA',
  300: '#FCA5A5',
  400: '#F87171',
  500: '#EF4444',
  600: '#DC2626',
  700: '#B91C1C', // counterfeit blocked / HMAC invalid (UI design: state-blocked)
  800: '#991B1B',
  900: '#7F1D1D',
} as const;

/**
 * Functional tokens — domain-specific aliases.
 * Consumers should prefer these over raw hex for scan/security UI.
 */
export const functional = {
  safetyGateAmber:     '#B8690A', // OCR category-confirm gate — caution prompt
  counterFeitWarning:  '#B8690A', // low-confidence scan result — warn before block
  counterFeitBlocked:  '#B91C1C', // confirmed counterfeit / HMAC invalid — hard block
  fpaExpiry:           '#B8690A', // FPA window countdown / expired
  fpaBlocked:          '#B91C1C', // FPA hard block after expiry
} as const;

export const colors = {
  brand,
  surface,
  text,
  state,
  amber,
  red,
  functional,
} as const;
