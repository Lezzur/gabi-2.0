import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@gaia/shared', '@gaia/supabase'],
  // pdfkit and its deps (fontkit, linebreak, etc.) are CommonJS packages with
  // native-style internals that don't survive webpack bundling. Marking them
  // external tells Next.js to require() them at runtime instead.
  serverExternalPackages: ['pdfkit', 'fontkit', 'linebreak', 'unicode-properties'],
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3001'],
    },
  },
};

export default nextConfig;
