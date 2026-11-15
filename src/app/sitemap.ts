import type { MetadataRoute } from 'next';
import { CITIES } from '@/lib/cities';
import { listNovosti } from '@/lib/novosti';
import { loadIndexableFuelsForCity } from '@/lib/stations';
import { SITE_URL } from '@/lib/site';

// Список городов×топлива читается из БД (гейт по реальным данным) —
// нельзя пререндерить на этапе сборки образа, только по запросу.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = listNovosti();
  const fuelPages = (
    await Promise.all(
      CITIES.map(async (c) => {
        const fuels = await loadIndexableFuelsForCity(c.name);
        return fuels.map((f) => ({
          url: `${SITE_URL}/gorod/${c.slug}/${f}`,
          changeFrequency: 'hourly' as const,
          priority: 0.7,
        }));
      })
    )
  ).flat();
  return [
    // Главная — теперь сама карта (решение владельца, 14.09.2026).
    { url: SITE_URL, changeFrequency: 'hourly', priority: 1 },
    { url: `${SITE_URL}/o-servise`, changeFrequency: 'weekly', priority: 0.6 },
    // /map намеренно НЕ в sitemap: страница отдаёт noindex — тот же
    // компонент, что и на `/`, дублировать в индексе незачем.
    { url: `${SITE_URL}/indeks`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/trassa/m4`, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${SITE_URL}/otmetki`, changeFrequency: 'always', priority: 0.7 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'monthly', priority: 0.3 },
    ...CITIES.map((c) => ({
      url: `${SITE_URL}/gorod/${c.slug}`,
      changeFrequency: 'hourly' as const,
      priority: 0.8,
    })),
    ...fuelPages,
    // /novosti пуст, пока в него не попадут проверенные статьи — см. novosti.ts
    ...(articles.length > 0
      ? [{ url: `${SITE_URL}/novosti`, changeFrequency: 'daily' as const, priority: 0.7 }]
      : []),
    ...articles.map((a) => ({
      url: `${SITE_URL}/novosti/${a.slug}`,
      lastModified: new Date(a.publishedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];
}
