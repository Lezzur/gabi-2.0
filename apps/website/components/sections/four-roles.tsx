import { getTranslations } from 'next-intl/server';

function IconFarmer() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconRegulator() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconBrand() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function IconAdmin() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  );
}

const ROLES = [
  { key: 'farmer', icon: <IconFarmer /> },
  { key: 'regulator', icon: <IconRegulator /> },
  { key: 'brand', icon: <IconBrand /> },
  { key: 'admin', icon: <IconAdmin /> },
] as const;

export async function FourRolesSection() {
  const t = await getTranslations('home.roles');

  return (
    <section id="roles" aria-label="Four Roles" className="bg-surface-white">
      <div className="mx-auto max-w-site px-6 md:px-24 py-20">
        <h2 className="font-serif text-[1.75rem] md:text-[2.5rem] font-bold text-brand-primary text-center">
          {t('heading')}
        </h2>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {ROLES.map(({ key, icon }) => (
            <article key={key} className="bg-surface-card rounded-lg p-6">
              <div className="text-brand-accent">{icon}</div>
              <h3 className="mt-4 text-[1.125rem] font-semibold text-brand-primary leading-snug">
                {t(`${key}.title`)}
              </h3>
              <p className="mt-2 text-[0.9375rem] text-gaia-text-secondary leading-relaxed">
                {t(`${key}.description`)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
