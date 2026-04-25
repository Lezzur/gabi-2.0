import { getTranslations } from 'next-intl/server';

const STATS = ['products', 'window', 'audit'] as const;

export async function StatsSection() {
  const t = await getTranslations('home.stats');

  return (
    <section id="stats" aria-label="Stats" className="bg-brand-primary">
      <div className="mx-auto max-w-site px-6 md:px-24 py-20 grid grid-cols-1 sm:grid-cols-3 gap-12 text-center">
        {STATS.map((stat) => (
          <div key={stat}>
            <p className="font-serif text-[3rem] font-bold text-surface-bg leading-tight">
              {t(`${stat}.number`)}
            </p>
            <p className="mt-2 text-[0.875rem] text-surface-bg/70">
              {t(`${stat}.label`)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
