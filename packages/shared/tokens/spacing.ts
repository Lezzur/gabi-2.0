/**
 * GAIA Spacing Tokens — 4px base unit, 8px primary grid.
 *
 * Keys follow Tailwind convention (unitless multipliers).
 * Values are pixel numbers for React Native; Tailwind plugin divides by 4 for rem.
 */

export const spacing = {
  0:  0,
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  6:  24,
  8:  32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;
