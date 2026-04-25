import type { Config } from 'tailwindcss';
import {
  colors,
  fonts,
  fontSizes,
  spacing as gaiaSpacing,
  radii,
  shadows,
} from '@gaia/shared/tokens';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: colors.brand,
        surface: colors.surface,
        'gaia-text': colors.text,
        state: colors.state,
        amber: colors.amber,
        red: colors.red,
      },
      fontFamily: {
        heading: [fonts.heading, 'serif'],
        body: [fonts.body, 'sans-serif'],
        mono: [fonts.mono, 'monospace'],
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['var(--font-playfair)', 'ui-serif', 'Georgia', 'serif'],
      },
      fontSize: Object.fromEntries(
        Object.entries(fontSizes).map(([key, px]) => [key, `${(px as number) / 16}rem`])
      ),
      spacing: Object.fromEntries(
        Object.entries(gaiaSpacing).map(([key, px]) => [
          key,
          (px as number) === 0 ? '0px' : `${(px as number) / 16}rem`,
        ])
      ),
      borderRadius: {
        sm: `${radii.sm}px`,
        md: `${radii.md}px`,
        lg: `${radii.lg}px`,
        xl: `${radii.xl}px`,
        full: `${radii.full}px`,
      },
      boxShadow: {
        none: shadows[0].web,
        sm: shadows[1].web,
        DEFAULT: shadows[2].web,
        md: shadows[3].web,
        lg: shadows[4].web,
      },
      maxWidth: {
        site: '1280px',
      },
    },
  },
  plugins: [],
};

export default config;
