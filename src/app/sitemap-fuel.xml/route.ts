import { SITE_URL } from '@/lib/site';
import { CITIES } from '@/lib/cities';
import { loadIndexableFuelsForCity } from '@/lib/stations';

export const dynamic = 'force-dynamic';

// Отдельный sitemap SEO-сетки «топливо × город»: набор страниц теперь
// вычисляется из реальных данных (гейт в lib/stations.ts), а не из
// статичного whitelist — держится отдельно от основного sitemap, чтобы
// следить за индексацией этого слоя в Вебмастере изолированно.
export async function GET() {
  const pages = (
    await Promise.all(
      CITIES.map(async (c) => {
        const fuels = await loadIndexableFuelsForCity(c.name);
        return fuels.map((f) => `/gorod/${c.slug}/${f}`);
      })
    )
  ).flat();

  const urls = pages
    .map(
      (u) =>
        `  <url><loc>${SITE_URL}${u}</loc><changefreq>hourly</changefreq><priority>0.7</priority></url>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
