/**
 * GAIA Typography Tokens
 *
 * fontSizes are pixel numbers — valid for React Native StyleSheet and
 * convertible to rem for web via the Tailwind plugin.
 * fontWeights are strings to match React Native's fontWeight prop type.
 */

export const fonts = {
  heading: 'Playfair Display', // H1, H2 — brand personality
  body:    'Inter',             // H3, body, CRM, mobile
  mono:    'JetBrains Mono',   // code, scan IDs, OCR output
} as const;

/** Pixel values. Web Tailwind plugin converts to rem (÷16). */
export const fontSizes = {
  xs:   11, // label/meta mobile
  sm:   12, // label/meta desktop
  base: 16, // body desktop (mobile: 15 — handled via responsive styles)
  lg:   20, // H3 mobile
  xl:   24, // H3 desktop
  '2xl': 28, // H2 mobile
  '3xl': 36, // H1 mobile / hero subheading
  '4xl': 40, // H2 desktop
  '5xl': 56, // H1 desktop hero
} as const;

/** String weights — compatible with React Native fontWeight. */
export const fontWeights = {
  regular:  '400',
  medium:   '500',
  semibold: '600',
  bold:     '700',
} as const;

export const lineHeights = {
  tight:   1.2,  // hero headings
  snug:    1.35, // subheadings
  normal:  1.5,  // body text
  relaxed: 1.65, // long-form / accessibility
} as const;

export const typography = {
  fonts,
  fontSizes,
  fontWeights,
  lineHeights,
} as const;
