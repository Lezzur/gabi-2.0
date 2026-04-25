import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gaia.ph';

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['/', '/how-it-works', '/for-brands', '/for-dealers', '/contact'];

  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: route === '/' ? 1 : 0.8,
  }));
}
