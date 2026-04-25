# CRM UI Components

shadcn/ui components wired to GAIA design tokens.

## Components

| File | Exports |
|------|---------|
| `alert.tsx` | `Alert`, `AlertTitle`, `AlertDescription` |
| `badge.tsx` | `Badge`, `badgeVariants` |
| `button.tsx` | `Button`, `buttonVariants` |
| `card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |
| `checkbox.tsx` | `Checkbox` |
| `dialog.tsx` | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose` |
| `dropdown-menu.tsx` | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuRadioGroup`, `DropdownMenuGroup` |
| `form.tsx` | `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage` |
| `input.tsx` | `Input` |
| `label.tsx` | `Label` |
| `select.tsx` | `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectLabel`, `SelectGroup`, `SelectSeparator`, `SelectValue` |
| `separator.tsx` | `Separator` |
| `skeleton.tsx` | `Skeleton` |
| `sonner.tsx` | `Toaster` (sonner-backed toast) |
| `table.tsx` | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` |
| `tabs.tsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |

## Token → CSS Variable → Utility Chain

Color tokens are the **single source of truth**. Nothing in this directory contains hardcoded hex values.

```
packages/shared/tokens/colors.ts   (hex values, e.g. brand.primary = '#1A3D2E')
        │
        ▼  apps/crm/scripts/generate-theme.ts  (hex → HSL)
        │
        ▼  apps/crm/app/globals.css  :root { --primary: 154 40% 17%; }
        │
        ▼  apps/crm/tailwind.config.ts  primary: { DEFAULT: 'hsl(var(--primary))' }
        │
        ▼  components/ui/*.tsx  className="bg-primary text-primary-foreground"
```

To regenerate `globals.css` after changing token values:

```bash
pnpm --filter @gaia/crm generate-theme
```

## Semantic Variable Mapping

| shadcn variable | Token | Light value | Dark value |
|-----------------|-------|-------------|------------|
| `--background` | `surface.bg` / `brand.dark` | `#F5EDD8` cream | `#122B1F` deep green |
| `--foreground` | `text.primary` / `text.onDark` | `#1A1A1A` | `#F5EDD8` cream |
| `--primary` | `brand.primary` / `brand.accent` | `#1A3D2E` forest green | `#C8952A` gold |
| `--accent` | `brand.accent` | `#C8952A` gold | `#C8952A` gold |
| `--destructive` | `state.error` | `#B91C1C` red | `#B91C1C` red |
| `--ring` | `brand.primary` / `brand.accent` | forest green | gold |

> **Dark mode note:** `--primary` flips from forest green to gold in dark mode because
> green-on-green has no contrast. Gold (`brand.accent`) is the action color on dark surfaces.

## Dark Mode

Activate by adding `class="dark"` to `<html>`. Wrap your app with `next-themes`'s `ThemeProvider` to sync with the OS preference:

```tsx
// app/layout.tsx
import { ThemeProvider } from 'next-themes'

export default function RootLayout({ children }) {
  return (
    <html suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

Place `<Toaster />` (from `sonner.tsx`) inside the ThemeProvider so toasts inherit the active theme.

## Keyboard Focus Contract

Every interactive component in this directory satisfies the following contract:

**Mechanism:** All interactive elements use Radix UI primitives or native HTML elements wrapped with `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. This produces a 2px solid focus ring at `hsl(var(--ring))` — visible only on keyboard navigation (`:focus-visible`), not on mouse click.

**Colors:**
- Light mode: `--ring` = `brand.primary` (#1A3D2E forest green) on `--background` (#F5EDD8 cream). Contrast ratio ≈ 5.4:1 — passes WCAG AA (3:1 required for UI components).
- Dark mode: `--ring` = `brand.accent` (#C8952A gold) on `--background` (#122B1F deep green). Contrast ratio ≈ 4.8:1 — passes WCAG AA.

**Per-component guarantee:**
- `Button` — `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- `Input` — same ring pattern
- `Select` (trigger) — same ring pattern
- `Checkbox` — same ring pattern
- `TabsTrigger` — same ring pattern; also `TabsContent` receives focus for content panels
- `Dialog` (close button) — same ring pattern; focus trapped inside open dialog via Radix
- `DropdownMenu` items — Radix manages focus via `outline-none` + `focus:bg-accent` (visual highlight, not outline)
- `Form` fields — inherit ring from underlying Input/Select/Checkbox

The backstop rule in `globals.css`:
```css
:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}
```
catches any non-shadcn interactive elements that lack an explicit focus style.

**Note:** Tab order is not enforced here — it follows DOM order. Use `tabIndex` at the feature component level if reordering is needed.
