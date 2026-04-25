import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GAIA — Authentic inputs. Rewarded farmers. Audit-ready stewardship.',
};

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section id="hero" className="bg-brand-primary" aria-label="Hero">
        <div className="mx-auto max-w-site px-6 md:px-24 py-20 md:py-32">
          <h1 className="font-serif text-[2.25rem] md:text-[3.5rem] font-bold text-surface-bg leading-tight max-w-[720px]">
            Authentic inputs. Rewarded farmers. Audit-ready stewardship.
          </h1>
          <p className="mt-6 text-lg text-surface-bg/80 max-w-[560px]">
            GAIA connects farmers, dealers, and brands through QR-verified
            agrochemical traceability, EPR compliance, and earned rewards.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <a
              href="/contact"
              className="inline-flex items-center justify-center h-14 px-8 rounded-md bg-brand-accent text-[#1A1A1A] font-semibold hover:bg-brand-accentHover transition-colors"
            >
              Open Demo
            </a>
            <a
              href="/contact"
              className="inline-flex items-center justify-center h-14 px-8 rounded-md border border-surface-bg text-surface-bg font-semibold hover:bg-surface-bg/10 transition-colors"
            >
              Talk to the team
            </a>
          </div>
        </div>
      </section>

      {/* Lifecycle — cards built in next task */}
      <section id="lifecycle" aria-label="Lifecycle" className="bg-surface-bg">
        <div className="mx-auto max-w-site px-6 md:px-24 py-20">
          <h2 className="font-serif text-[1.75rem] md:text-[2.5rem] font-bold text-brand-primary text-center">
            From shelf to compliance — automatically.
          </h2>
        </div>
      </section>

      {/* Four Roles — cards built in next task */}
      <section id="roles" aria-label="Four Roles" className="bg-surface-white">
        <div className="mx-auto max-w-site px-6 md:px-24 py-20">
          <h2 className="font-serif text-[1.75rem] md:text-[2.5rem] font-bold text-brand-primary text-center">
            Built for every stakeholder.
          </h2>
        </div>
      </section>

      {/* Stats */}
      <section id="stats" aria-label="Stats" className="bg-brand-primary">
        <div className="mx-auto max-w-site px-6 md:px-24 py-20 grid grid-cols-1 sm:grid-cols-3 gap-12 text-center">
          {(
            [
              { number: '31,990+', label: 'FPA-registered products' },
              { number: '60 min', label: 'Purchase window' },
              { number: '100%', label: 'Audit trail' },
            ] as const
          ).map(({ number, label }) => (
            <div key={label}>
              <p className="font-serif text-[3rem] font-bold text-surface-bg">{number}</p>
              <p className="mt-2 text-sm text-surface-bg/70">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pi Network */}
      <section id="pi-network" aria-label="Pi Network" className="bg-surface-bg">
        <div className="mx-auto max-w-site px-6 md:px-24 py-20 text-center">
          <h2 className="font-serif text-[1.75rem] md:text-[2.5rem] font-bold text-brand-primary max-w-[720px] mx-auto">
            Pi Network &amp; on-chain traceability — in the architecture, not on the demo.
          </h2>
          <span className="mt-6 inline-block px-4 py-2 rounded-full bg-brand-accent text-[#1A1A1A] text-sm font-semibold">
            Coming in Phase 3
          </span>
        </div>
      </section>
    </>
  );
}
