import { getTranslations } from 'next-intl/server';

function IconPi() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <text
        x="4"
        y="32"
        fontFamily="Georgia, serif"
        fontSize="34"
        fontWeight="400"
        fill="currentColor"
      >
        π
      </text>
    </svg>
  );
}

export async function PiNetworkSection() {
  const t = await getTranslations('home.pi');

  return (
    <section id="pi-network" aria-label="Pi Network" className="bg-surface-bg">
      <div className="mx-auto max-w-site px-6 md:px-24 py-20 text-center">
        <div className="flex justify-center mb-6 text-brand-accent opacity-60" aria-hidden="true">
          <IconPi />
        </div>
        <h2 className="font-serif text-[1.75rem] md:text-[2.5rem] font-bold text-brand-primary max-w-[720px] mx-auto">
          {t('heading')}
        </h2>
        <p className="mt-6 text-[1rem] text-gaia-text-secondary max-w-[600px] mx-auto leading-relaxed">
          {t('body')}
        </p>
        <span className="mt-8 inline-block px-4 py-2 rounded-full bg-brand-accent text-[#1A1A1A] text-sm font-semibold">
          {t('badge')}
        </span>
      </div>
    </section>
  );
}
