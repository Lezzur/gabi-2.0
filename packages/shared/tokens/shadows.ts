/**
 * GAIA Shadow / Elevation Tokens
 *
 * Each level exposes:
 *   web    — CSS box-shadow string (used by Tailwind plugin)
 *   native — React Native shadow props + elevation
 *
 * Use `shadows[n].web` on web, `shadows[n].native` in StyleSheet.
 */

export const shadows = {
  0: {
    web: 'none',
    native: {
      elevation: 0,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
    },
  },
  1: {
    web: '0 1px 2px 0 rgba(0,0,0,0.05)',
    native: {
      elevation: 1,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
    },
  },
  2: {
    web: '0 1px 3px 0 rgba(0,0,0,0.10), 0 1px 2px -1px rgba(0,0,0,0.10)',
    native: {
      elevation: 2,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.10,
      shadowRadius: 4,
    },
  },
  3: {
    web: '0 4px 6px -1px rgba(0,0,0,0.10), 0 2px 4px -2px rgba(0,0,0,0.10)',
    native: {
      elevation: 3,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
    },
  },
  4: {
    web: '0 10px 15px -3px rgba(0,0,0,0.10), 0 4px 6px -4px rgba(0,0,0,0.10)',
    native: {
      elevation: 4,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.15,
      shadowRadius: 10,
    },
  },
} as const;
