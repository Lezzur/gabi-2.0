import type { Metadata } from 'next';
import { ContactForm } from './contact-form';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Get in touch with the GAIA team — general inquiries, dealer partnerships, or counterfeit reports.',
};

export default function ContactPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-brand-primary" aria-label="Contact hero">
        <div className="mx-auto max-w-site px-6 md:px-24 py-16 md:py-24">
          <h1 className="font-serif text-[2rem] md:text-[3rem] font-bold text-surface-bg leading-tight">
            Get in Touch
          </h1>
          <p className="mt-4 text-base md:text-lg text-surface-bg/80 max-w-[480px]">
            Questions about GAIA, dealer partnerships, or counterfeit reports — we read every message.
          </p>
        </div>
      </section>

      {/* Form section */}
      <section className="bg-surface-bg" aria-label="Contact form">
        <div className="mx-auto max-w-site px-6 md:px-24 py-16 md:py-24">
          <div className="mx-auto max-w-2xl rounded-xl bg-white p-8 md:p-12 shadow">
            <ContactForm />
          </div>
        </div>
      </section>
    </>
  );
}
