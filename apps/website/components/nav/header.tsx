'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/for-brands', label: 'For Brands' },
  { href: '/for-dealers', label: 'For Dealers' },
  { href: '/contact', label: 'Contact' },
] as const;

function LocaleSwitcher({ locale }: { locale: string }) {
  function handleSwitch(next: string) {
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000`;
    window.location.reload();
  }

  return (
    <div
      className="flex items-center gap-1 text-surface-bg text-sm"
      role="group"
      aria-label="Language"
    >
      <button
        onClick={() => handleSwitch('en')}
        className={`px-2 py-1 rounded transition-colors ${
          locale === 'en'
            ? 'font-bold underline decoration-brand-accent underline-offset-4'
            : 'opacity-70 hover:opacity-100'
        }`}
      >
        EN
      </button>
      <span className="opacity-40" aria-hidden="true">|</span>
      <button
        onClick={() => handleSwitch('tl')}
        className={`px-2 py-1 rounded transition-colors ${
          locale === 'tl'
            ? 'font-bold underline decoration-brand-accent underline-offset-4'
            : 'opacity-70 hover:opacity-100'
        }`}
      >
        TL
      </button>
    </div>
  );
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const locale = useLocale();

  return (
    <header className="sticky top-0 z-50 bg-brand-primary">
      <nav
        className="mx-auto flex max-w-site items-center justify-between px-6 md:px-24 h-16"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-surface-bg font-bold text-xl font-serif"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className="text-brand-accent"
          >
            <path
              d="M10 2C6 2 3 5.5 3 9c0 3 1.5 5.5 4 6.5V18h2v-3h2v3h2v-2.5c2.5-1 4-3.5 4-6.5 0-3.5-3-7-7-7z"
              fill="currentColor"
            />
          </svg>
          GAIA
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-8" role="list">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className={`text-surface-bg text-sm font-medium transition-colors hover:underline decoration-brand-accent underline-offset-4 ${
                  pathname === href ? 'underline' : ''
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="hidden md:flex items-center gap-4">
          <LocaleSwitcher locale={locale} />
          <Link
            href="/contact"
            className="h-9 px-4 inline-flex items-center rounded-md bg-brand-accent text-[#1A1A1A] text-sm font-semibold hover:bg-brand-accentHover transition-colors"
          >
            Open Demo
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-surface-bg p-2"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile slide-down menu */}
      {mobileOpen && (
        <div className="md:hidden bg-brand-primary border-t border-surface-bg/10">
          <ul className="flex flex-col px-6 py-4 gap-4" role="list">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className="block text-surface-bg text-base font-medium py-1"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-4 px-6 pb-4">
            <LocaleSwitcher locale={locale} />
            <Link
              href="/contact"
              onClick={() => setMobileOpen(false)}
              className="flex-1 text-center h-10 inline-flex items-center justify-center rounded-md bg-brand-accent text-[#1A1A1A] text-sm font-semibold"
            >
              Open Demo
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
