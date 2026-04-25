import { getTranslations } from 'next-intl/server';

function IconVerify() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22,4 12,14.01 9,11.01" />
    </svg>
  );
}

function IconEarn() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2" />
    </svg>
  );
}

function IconReturn() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="1,4 1,10 7,10" />
      <polyline points="23,20 23,14 17,14" />
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
    </svg>
  );
}

function IconAudit() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10,9 9,9 8,9" />
    </svg>
  );
}

const STEPS = [
  { key: 'verify', icon: <IconVerify />, step: '01' },
  { key: 'earn', icon: <IconEarn />, step: '02' },
  { key: 'return', icon: <IconReturn />, step: '03' },
  { key: 'audit', icon: <IconAudit />, step: '04' },
] as const;

export async function LifecycleSection() {
  const t = await getTranslations('home.lifecycle');

  return (
    <section id="lifecycle" aria-label="Lifecycle" className="bg-surface-bg">
      <div className="mx-auto max-w-site px-6 md:px-24 py-20">
        <h2 className="font-serif text-[1.75rem] md:text-[2.5rem] font-bold text-brand-primary text-center">
          {t('heading')}
        </h2>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {STEPS.map(({ key, icon, step }) => (
            <article key={key} className="bg-surface-card rounded-lg p-6">
              <div className="text-brand-accent">{icon}</div>
              <p className="mt-4 font-sans text-[0.75rem] font-bold text-gaia-text-secondary tracking-widest tabular-nums">
                {step}
              </p>
              <h3 className="mt-2 text-[1.125rem] font-semibold text-brand-primary leading-snug">
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
