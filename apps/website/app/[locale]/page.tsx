import type { Metadata } from 'next';
import { HeroSection } from '@/components/sections/hero';
import { LifecycleSection } from '@/components/sections/lifecycle';
import { FourRolesSection } from '@/components/sections/four-roles';
import { StatsSection } from '@/components/sections/stats';
import { PiNetworkSection } from '@/components/sections/pi-network';

export const metadata: Metadata = {
  title: 'GAIA — Authentic inputs. Rewarded farmers. Audit-ready stewardship.',
};

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <LifecycleSection />
      <FourRolesSection />
      <StatsSection />
      <PiNetworkSection />
    </>
  );
}
