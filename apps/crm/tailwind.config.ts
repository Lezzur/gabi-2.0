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
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // GAIA brand tokens — use as bg-brand-primary, text-state-success, etc.
        brand: colors.brand,
        surface: colors.surface,
        state: colors.state,
        amber: colors.amber,
        red: colors.red,
        // shadcn/ui semantic colors — CSS variable–driven
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
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
        DEFAULT: 'var(--radius)',
      },
      boxShadow: {
        none: shadows[0].web,
        sm: shadows[1].web,
        DEFAULT: shadows[2].web,
        md: shadows[3].web,
        lg: shadows[4].web,
      },
    },
  },
  plugins: [],
};

export default config;
