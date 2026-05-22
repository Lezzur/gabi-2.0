// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@gaia/shared', '@gaia/supabase'],
  experimental: {
    serverComponentsExternalPackages: ['pdfkit', 'fontkit', 'linebreak', 'unicode-properties'],
    serverActions: {
      allowedOrigins: ['localhost:3001', 'localhost:3002'],
    },
  },
};

export default nextConfig;
