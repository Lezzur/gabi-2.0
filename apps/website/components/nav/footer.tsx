import Link from 'next/link';

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/for-brands', label: 'For Brands' },
  { href: '/for-dealers', label: 'For Dealers' },
  { href: '/contact', label: 'Contact' },
] as const;

export function Footer() {
  return (
    <footer className="bg-brand-dark">
      <div className="mx-auto max-w-site px-6 md:px-24 py-12 flex flex-col md:flex-row items-center justify-between gap-6">
        <nav aria-label="Footer navigation">
          <ul className="flex flex-wrap gap-6 justify-center md:justify-start" role="list">
            {FOOTER_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="text-sm text-surface-bg/70 hover:text-surface-bg transition-colors"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-sm text-surface-bg/50">
          &copy; {new Date().getFullYear()} GAIA. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
