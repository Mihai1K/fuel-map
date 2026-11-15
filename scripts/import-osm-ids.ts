// Точечный ремонт базы: импорт станций из готового ответа Overpass
// (формат `out center tags;`). Используется валидатором покрытия:
// станции, найденные у ГдеБенз с osm-идентификатором, дотягиваются
// из самого OSM по id и заливаются этим скриптом.
// Запуск: DATABASE_URL=... npx tsx scripts/import-osm-ids.ts <elements.json>
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const BRAND_MAP: Record<string, string> = {
  lukoil: 'Лукойл',
  rosneft: 'Роснефть',
  gazprom: 'Газпромнефть',
  'gazprom neft': 'Газпромнефть',
  gazpromneft: 'Газпромнефть',
  tatneft: 'Татнефть',
  teboil: 'Teboil',
  shell: 'Shell',
  bashneft: 'Башнефть',
};
const norm = (r?: string) => {
  if (!r) return null;
  const k = r.trim().toLowerCase();
  return BRAND_MAP[k] ?? r.trim();
};

const cities: { name: string; lat: number; lng: number; pop: number }[] =
  JSON.parse(
    readFileSync(new URL('./data/ru-cities.json', import.meta.url), 'utf8')
  );
const big = cities.filter((c) => c.pop > 100_000);
function assignCity(lat: number, lng: number, tags: Record<string, string>) {
  let best: string | null = null;
  let bestD = 0.5; // ~35–50 км в градусной метрике с поправкой долготы
  for (const c of big) {
    const d = Math.hypot(c.lat - lat, (c.lng - lng) * 0.6);
    if (d < bestD) {
      bestD = d;
      best = c.name;
    }
  }
  return best ?? (tags['addr:city']?.trim() || '—');
}

type El = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: import-osm-ids.ts <overpass-elements.json>');
  const els: El[] = JSON.parse(readFileSync(file, 'utf8')).elements;
  let n = 0;
  for (const el of els) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    const tags = el.tags ?? {};
    if (tags.amenity !== 'fuel') continue; // только заправки
    const network = norm(tags.brand ?? tags.operator);
    const name = tags.name?.trim() || (network ? `АЗС ${network}` : 'АЗС');
    const street = tags['addr:street'];
    const house = tags['addr:housenumber'];
    const address =
      street && house
        ? `${street}, ${house}`
        : (street ?? tags['addr:full'] ?? 'адрес уточняется');
    await prisma.station.upsert({
      where: { osmId: `${el.type}/${el.id}` },
      update: { name, network, address, lat, lng },
      create: {
        osmId: `${el.type}/${el.id}`,
        name,
        network,
        address,
        city: assignCity(lat, lng, tags),
        region: tags['addr:region']?.trim() ?? '',
        lat,
        lng,
        source: 'osm',
      },
    });
    n++;
  }
  console.log(`✓ добавлено/обновлено станций: ${n}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
