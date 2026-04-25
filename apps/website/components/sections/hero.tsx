import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function HeroSection() {
  const t = await getTranslations('home.hero');

  return (
    <section id="hero" className="bg-brand-primary" aria-label="Hero">
      <div className="mx-auto max-w-site px-6 md:px-24 py-20 md:py-32">
        <h1 className="font-serif text-[2.25rem] md:text-[3.5rem] font-bold text-surface-bg leading-tight max-w-[720px]">
          {t('headline')}
        </h1>
        <p className="mt-6 text-[1.125rem] text-surface-bg/80 max-w-[560px]">
          {t('subheadline')}
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Link
            href="/contact"
            className="w-full sm:w-auto inline-flex items-center justify-center h-14 px-8 rounded-md bg-brand-accent text-[#1A1A1A] font-semibold motion-safe:transition-colors hover:bg-brand-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary"
          >
            {t('cta_demo')}
          </Link>
          <Link
            href="/contact"
            className="w-full sm:w-auto inline-flex items-center justify-center h-14 px-8 rounded-md border border-surface-bg text-surface-bg font-semibold motion-safe:transition-colors hover:bg-surface-bg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-bg focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary"
          >
            {t('cta_talk')}
          </Link>
        </div>
      </div>
    </section>
  );
}
