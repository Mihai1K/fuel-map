import type { Metadata } from 'next';
import { cityBySlug } from '@/lib/cities';
import { loadStations, serializeStation } from '@/lib/stations';
import { MapApp, type ClientStation } from '@/components/map-app';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ city?: string; fuel?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const city = cityBySlug((await searchParams).city);
  return {
    title: `Где есть бензин в городе ${city.name} — живая карта АЗС · Тут Бензин`,
    description: `Карта АЗС: ${city.name}. Водители отмечают, где есть топливо, какая очередь и когда информацию подтверждали. Без регистрации.`,
    // карта — инструмент; в поиске живут страницы /gorod/… (SEO-пилот)
    robots: { index: false, follow: true },
  };
}

export default async function MapPage({ searchParams }: Props) {
  const params = await searchParams;
  const city = cityBySlug(params.city);
  const stations = await loadStations(city.name);
  const client: ClientStation[] = stations.map(serializeStation);
  // key: смена города пересоздаёт карту с нужным центром
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
