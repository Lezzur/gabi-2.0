/**
 * GAIA Transition Tokens — web only.
 * React Native uses Animated / Reanimated; these values are unused on mobile
 * but exported here so web consumers stay in sync with any RN motion decisions.
 *
 * durations are milliseconds (numbers), not strings, so they compose cleanly:
 *   `transition: \`opacity \${durations.base}ms \${easings.easeOut}\``
 */

export const durations = {
  fast: 120,  // micro-interactions: hover, focus ring
  base: 200,  // standard transitions: modals open, dropdowns
  slow: 320,  // page-level: slide-in panels, skeleton → content
} as const;

export const easings = {
  linear:    'linear',
  easeIn:    'cubic-bezier(0.4, 0, 1, 1)',
  easeOut:   'cubic-bezier(0, 0, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export const transitions = {
  durations,
  easings,
} as const;
