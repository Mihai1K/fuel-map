// Импорт ВСЕХ АЗС России из OpenStreetMap (Overpass API).
// Запуск: npm run import:osm
// Идемпотентен: станции апсертятся по osmId, метки не трогаются.
//
// История: первая версия импортировала только 10 городов радиусами —
// первый же водитель решил, что «сервис неполный». Теперь страна целиком:
// сетка ячеек, в каждой — node/way/relation amenity=fuel внутри границы РФ.
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Overpass нужен ТОЛЬКО этому скрипту импорта — пользователи сервиса
// всегда читают из Postgres. Зеркала перебираются по порядку
// (основной overpass-api.de отсюда недоступен — TLS обрывается).
const OVERPASS_MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Крупные города для привязки станций (поле city): ближайший в радиусе
// 35 км. Первые десять — города из lib/cities.ts, имена должны совпадать.
const ANCHOR_CITIES: [string, number, number][] = [
  ['Москва', 55.751, 37.618],
  ['Санкт-Петербург', 59.939, 30.316],
  ['Симферополь', 44.952, 34.102],
  ['Севастополь', 44.605, 33.522],
  ['Краснодар', 45.035, 38.976],
  ['Сочи', 43.586, 39.72],
  ['Ростов-на-Дону', 47.222, 39.72],
  ['Астрахань', 46.347, 48.03],
  ['Казань', 55.796, 49.108],
  ['Воронеж', 51.661, 39.2],
  ['Новосибирск', 55.03, 82.92],
  ['Екатеринбург', 56.838, 60.597],
  ['Нижний Новгород', 56.326, 44.006],
  ['Челябинск', 55.16, 61.4],
  ['Самара', 53.195, 50.1],
  ['Омск', 54.989, 73.368],
  ['Уфа', 54.735, 55.958],
  ['Красноярск', 56.01, 92.852],
  ['Пермь', 58.01, 56.229],
  ['Волгоград', 48.708, 44.513],
  ['Саратов', 51.533, 46.034],
  ['Тюмень', 57.153, 65.534],
  ['Тольятти', 53.507, 49.42],
  ['Ижевск', 56.853, 53.204],
  ['Барнаул', 53.347, 83.778],
  ['Ульяновск', 54.314, 48.403],
  ['Иркутск', 52.287, 104.281],
  ['Хабаровск', 48.48, 135.072],
  ['Ярославль', 57.626, 39.894],
  ['Владивосток', 43.115, 131.885],
  ['Махачкала', 42.983, 47.505],
  ['Томск', 56.484, 84.948],
  ['Оренбург', 51.769, 55.097],
  ['Кемерово', 55.355, 86.087],
  ['Новокузнецк', 53.757, 87.136],
  ['Рязань', 54.63, 39.742],
  ['Набережные Челны', 55.744, 52.396],
  ['Пенза', 53.195, 45.019],
  ['Липецк', 52.61, 39.595],
  ['Киров', 58.603, 49.668],
  ['Чебоксары', 56.146, 47.251],
  ['Тула', 54.193, 37.617],
  ['Калининград', 54.71, 20.51],
  ['Балашиха', 55.796, 37.938],
  ['Курск', 51.73, 36.193],
  ['Ставрополь', 45.045, 41.969],
  ['Улан-Удэ', 51.834, 107.584],
  ['Тверь', 56.859, 35.912],
  ['Магнитогорск', 53.407, 58.98],
  ['Иваново', 57.0, 40.974],
  ['Брянск', 53.243, 34.364],
  ['Белгород', 50.596, 36.588],
  ['Сургут', 61.254, 73.396],
  ['Владимир', 56.129, 40.407],
  ['Чита', 52.034, 113.499],
  ['Нижний Тагил', 57.91, 59.981],
  ['Архангельск', 64.539, 40.517],
  ['Калуга', 54.513, 36.261],
  ['Смоленск', 54.782, 32.045],
  ['Волжский', 48.786, 44.752],
  ['Якутск', 62.028, 129.732],
  ['Саранск', 54.187, 45.183],
  ['Череповец', 59.122, 37.903],
  ['Курган', 55.441, 65.341],
  ['Вологда', 59.22, 39.891],
  ['Орёл', 52.967, 36.069],
  ['Подольск', 55.431, 37.545],
  ['Грозный', 43.318, 45.698],
  ['Кызыл', 51.719, 94.437],
  ['Владикавказ', 43.021, 44.682],
  ['Тамбов', 52.721, 41.452],
  ['Мурманск', 68.97, 33.075],
  ['Петрозаводск', 61.785, 34.347],
  ['Нижневартовск', 60.939, 76.569],
  ['Кострома', 57.768, 40.927],
  ['Йошкар-Ола', 56.634, 47.9],
  ['Новороссийск', 44.723, 37.769],
  ['Стерлитамак', 53.63, 55.93],
  ['Химки', 55.897, 37.43],
  ['Таганрог', 47.236, 38.895],
  ['Комсомольск-на-Амуре', 50.55, 137.01],
  ['Сыктывкар', 61.669, 50.836],
  ['Нальчик', 43.485, 43.607],
  ['Шахты', 47.709, 40.216],
  ['Дзержинск', 56.238, 43.462],
  ['Братск', 56.152, 101.634],
  ['Орск', 51.229, 58.475],
  ['Ангарск', 52.544, 103.888],
  ['Благовещенск', 50.291, 127.527],
  ['Великий Новгород', 58.522, 31.27],
  ['Псков', 57.817, 28.334],
  ['Бийск', 52.539, 85.214],
  ['Южно-Сахалинск', 46.959, 142.738],
  ['Абакан', 53.721, 91.442],
  ['Керчь', 45.356, 36.467],
  ['Ялта', 44.495, 34.166],
  ['Евпатория', 45.19, 33.367],
  ['Феодосия', 45.031, 35.382],
  ['Анапа', 44.895, 37.316],
  ['Геленджик', 44.561, 38.077],
  ['Туапсе', 44.106, 39.081],
  ['Армавир', 44.998, 41.129],
  ['Майкоп', 44.609, 40.101],
  ['Элиста', 46.308, 44.256],
  ['Петропавловск-Камчатский', 53.037, 158.656],
  ['Магадан', 59.561, 150.83],
  ['Норильск', 69.349, 88.201],
  ['Новый Уренгой', 66.084, 76.681],
  ['Ханты-Мансийск', 61.003, 69.019],
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function assignCity(
  lat: number,
  lng: number,
  tags: Record<string, string>
): string {
  let best: string | null = null;
  let bestKm = 35; // дальше 35 км от центра — уже не «город N»
  for (const [name, cLat, cLng] of ANCHOR_CITIES) {
    if (Math.abs(cLat - lat) > 0.7 || Math.abs(cLng - lng) > 1.5) continue;
    const km = haversineKm(lat, lng, cLat, cLng);
    if (km < bestKm) {
      bestKm = km;
      best = name;
    }
  }
  return best ?? (tags['addr:city']?.trim() || '—');
}

// Латиница → привычные русские названия сетей.
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
  neste: 'Neste',
  taif: 'ТАИФ',
  atan: 'ATAN',
  tes: 'ТЕС',
  irkutskoil: 'Иркутскнефтепродукт',
  'nk alliance': 'НК Альянс',
};

function normalizeNetwork(raw?: string): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (BRAND_MAP[key]) return BRAND_MAP[key];
  return raw.trim();
}

type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

async function fetchCell(
  s: number,
  w: number,
  n: number,
  e: number
): Promise<OsmElement[]> {
  // area РФ ограничивает выборку страной: ячейки сетки залезают на соседей
  const query = `
[out:json][timeout:120];
area["ISO3166-1"="RU"][admin_level=2]->.ru;
(
  node["amenity"="fuel"](area.ru)(${s},${w},${n},${e});
  way["amenity"="fuel"](area.ru)(${s},${w},${n},${e});
  relation["amenity"="fuel"](area.ru)(${s},${w},${n},${e});
);
out center tags;`;
  let lastError: Error | null = null;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TytBenzin/0.2 (fuel availability map; tytbenzin.ru)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements: OsmElement[] };
      return json.elements;
    } catch (e2) {
      lastError = e2 as Error;
    }
  }
  throw new Error(`все зеркала Overpass недоступны: ${lastError?.message}`);
}

function buildAddress(tags: Record<string, string>): string | null {
  const street = tags['addr:street'];
  const house = tags['addr:housenumber'];
  if (street && house) return `${street}, ${house}`;
  if (street) return street;
  if (tags['addr:full']) return tags['addr:full'];
  return null;
}

async function main() {
  // Сетка по обжитой части РФ: широты 41–72, долготы 19–180.
  // Ячейки 6°×7° — каждая отвечает быстро даже на публичном зеркале.
  const LAT_STEP = 6;
  const LNG_STEP = 7;
  let total = 0;
  let cells = 0;
  const seen = new Set<string>();

  for (let lat = 41; lat < 72; lat += LAT_STEP) {
    for (let lng = 19; lng < 180; lng += LNG_STEP) {
      cells++;
      const label = `[${lat}..${lat + LAT_STEP}, ${lng}..${lng + LNG_STEP}]`;
      let elements: OsmElement[];
      try {
        elements = await fetchCell(lat, lng, lat + LAT_STEP, lng + LNG_STEP);
      } catch (e) {
        console.log(`✗ ${label} ошибка: ${(e as Error).message} — пропускаю`);
        continue;
      }

      let upserts = 0;
      for (const el of elements) {
        const eLat = el.lat ?? el.center?.lat;
        const eLng = el.lon ?? el.center?.lon;
        if (eLat == null || eLng == null) continue;
        const osmId = `${el.type}/${el.id}`;
        if (seen.has(osmId)) continue; // ячейки не пересекаются, но на всякий
        seen.add(osmId);

        const tags = el.tags ?? {};
        const network = normalizeNetwork(tags.brand ?? tags.operator);
        const name = tags.name?.trim() || (network ? `АЗС ${network}` : 'АЗС');
        const address = buildAddress(tags) ?? 'адрес уточняется';
        const city = assignCity(eLat, eLng, tags);
        const region = tags['addr:region']?.trim() ?? '';

        await prisma.station.upsert({
          where: { osmId },
          update: { name, network, address, lat: eLat, lng: eLng },
          create: {
            osmId,
            name,
            network,
            address,
            city,
            region,
            lat: eLat,
            lng: eLng,
            source: 'osm',
          },
        });
        upserts++;
      }
      total += upserts;
      if (upserts > 0) console.log(`→ ${label}: ${upserts} АЗС`);
      // не душим публичный Overpass
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  // демо-станции, придуманные сидом, больше не нужны
  const fake = await prisma.station.findMany({
    where: { source: 'manual' },
    select: { id: true },
  });
  if (fake.length) {
    const ids = fake.map((s) => s.id);
    await prisma.mark.deleteMany({ where: { stationId: { in: ids } } });
    await prisma.station.deleteMany({ where: { id: { in: ids } } });
    console.log(`− удалено демо-станций: ${fake.length}`);
  }

  console.log(`✓ импорт готов: ${total} АЗС из OSM (${cells} ячеек сетки)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
