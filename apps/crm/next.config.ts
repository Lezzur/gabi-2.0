import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@gaia/shared', '@gaia/supabase'],
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3001'],
    },
  },
};

export default nextConfig;
