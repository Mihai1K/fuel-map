import type { Metadata } from 'next';
import { cityBySlug } from '@/lib/cities';
import { loadStations, serializeStation } from '@/lib/stations';
import { SITE_URL } from '@/lib/site';
import { MapApp, type ClientStation } from '@/components/map-app';

// Главная — сразу карта (решение владельца, 14.09.2026): путь клиента был
// «лендинг → клик → карта», теряли людей на втором клике. Маркетинговый
// текст и статистика переехали на /o-servise. /map остаётся рабочим
// URL-ом для существующих ссылок с других страниц (/gorod, /novosti,
// /trassa) — это тот же компонент, дублировать код незачем.
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ city?: string; fuel?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const city = cityBySlug((await searchParams).city);
  return {
    title: `Где есть бензин в городе ${city.name} — живая карта АЗС · Тут Бензин`,
    description: `Карта АЗС: ${city.name}. Водители отмечают, где есть топливо, какая очередь и когда информацию подтверждали. Без регистрации.`,
    alternates: { canonical: `${SITE_URL}/` },
  };
}

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams;
  const city = cityBySlug(params.city);
  const stations = await loadStations(city.name);
  const client: ClientStation[] = stations.map(serializeStation);
  const fuel = ['ai92', 'ai95', 'ai98', 'ai100', 'diesel', 'gas'].includes(
    params.fuel ?? ''
  )
    ? params.fuel!
    : null;
  return (
    <MapApp
      key={`${city.slug}-${fuel ?? 'all'}`}
      initialStations={client}
      city={city}
      initialFuel={fuel}
    />
  );
}
