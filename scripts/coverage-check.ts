// Валидатор покрытия: сравнивает нашу базу АЗС с ГдеБенз по городам.
// ГдеБенз используется ТОЛЬКО как контрольный список (сколько станций
// видит конкурент в том же квадрате) — их данные мы не импортируем.
// Станции с osm-идентификатором дотягиваем из самого OSM; станции,
// добавленные их пользователями (usr_*), попадают в очередь ручной
// проверки missing-stations.json.
//
// Запуск: DATABASE_URL=... npx tsx scripts/coverage-check.ts
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Города проверки: наши 10 + миллионники (bbox — половина стороны, градусы)
const CHECK_CITIES: { name: string; lat: number; lng: number; dLat: number; dLng: number }[] = [
  { name: 'Москва', lat: 55.751, lng: 37.618, dLat: 0.25, dLng: 0.45 },
  { name: 'Санкт-Петербург', lat: 59.939, lng: 30.316, dLat: 0.2, dLng: 0.4 },
  { name: 'Симферополь', lat: 44.952, lng: 34.102, dLat: 0.12, dLng: 0.18 },
  { name: 'Севастополь', lat: 44.605, lng: 33.522, dLat: 0.13, dLng: 0.2 },
  { name: 'Краснодар', lat: 45.035, lng: 38.976, dLat: 0.14, dLng: 0.2 },
  { name: 'Сочи', lat: 43.586, lng: 39.72, dLat: 0.18, dLng: 0.25 },
  { name: 'Ростов-на-Дону', lat: 47.222, lng: 39.72, dLat: 0.14, dLng: 0.2 },
  { name: 'Астрахань', lat: 46.347, lng: 48.03, dLat: 0.12, dLng: 0.18 },
  { name: 'Казань', lat: 55.796, lng: 49.108, dLat: 0.15, dLng: 0.25 },
  { name: 'Воронеж', lat: 51.661, lng: 39.2, dLat: 0.13, dLng: 0.2 },
  { name: 'Новосибирск', lat: 55.03, lng: 82.92, dLat: 0.15, dLng: 0.25 },
  { name: 'Екатеринбург', lat: 56.838, lng: 60.597, dLat: 0.15, dLng: 0.25 },
  { name: 'Нижний Новгород', lat: 56.326, lng: 44.006, dLat: 0.15, dLng: 0.25 },
  { name: 'Челябинск', lat: 55.16, lng: 61.4, dLat: 0.15, dLng: 0.25 },
  { name: 'Самара', lat: 53.195, lng: 50.1, dLat: 0.15, dLng: 0.25 },
  { name: 'Омск', lat: 54.989, lng: 73.368, dLat: 0.15, dLng: 0.25 },
  { name: 'Уфа', lat: 54.735, lng: 55.958, dLat: 0.15, dLng: 0.25 },
  { name: 'Красноярск', lat: 56.01, lng: 92.852, dLat: 0.15, dLng: 0.25 },
  { name: 'Пермь', lat: 58.01, lng: 56.229, dLat: 0.15, dLng: 0.25 },
  { name: 'Волгоград', lat: 48.708, lng: 44.513, dLat: 0.2, dLng: 0.25 },
];

type GdbStation = {
  osm_id: string;
  name: string;
  brand: string | null;
  lat: number;
  lon: number;
  addr: string | null;
};

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchGdb(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): Promise<GdbStation[]> {
  const url = `https://gdebenz.ru/api/stations?lat1=${lat1.toFixed(4)}&lon1=${lon1.toFixed(4)}&lat2=${lat2.toFixed(4)}&lon2=${lon2.toFixed(4)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (coverage check)' },
  });
  if (!res.ok) throw new Error(`gdebenz ${res.status}`);
  return (await res.json()) as GdbStation[];
}

async function main() {
  const missingAll: (GdbStation & { city: string })[] = [];
  const report: {
    city: string;
    ours: number;
    theirs: number;
    matched: number;
    onlyOurs: number;
    onlyTheirs: number;
    coverage: number;
  }[] = [];

  console.log(
    'Город'.padEnd(18),
    'у нас'.padEnd(6),
    'ГдеБенз'.padEnd(8),
    'совпало'.padEnd(8),
    'наши+'.padEnd(6),
    'их+'.padEnd(5),
    'покрытие'
  );

  for (const c of CHECK_CITIES) {
    const lat1 = c.lat - c.dLat;
    const lat2 = c.lat + c.dLat;
    const lon1 = c.lng - c.dLng;
    const lon2 = c.lng + c.dLng;

    // ГдеБенз отдаёт станции чуть шире запрошенной рамки — свои для
    // СРАВНЕНИЯ берём с запасом (PAD), иначе краевые станции ложно
    // попадают в «нет у нас» (боевой баг первого прогона)
    const PAD = 0.08;
    const oursPadded = await prisma.station.findMany({
      where: {
        lat: { gte: lat1 - PAD, lte: lat2 + PAD },
        lng: { gte: lon1 - PAD * 2, lte: lon2 + PAD * 2 },
      },
      select: { lat: true, lng: true },
    });
    const ours = oursPadded.filter(
      (o) => o.lat >= lat1 && o.lat <= lat2 && o.lng >= lon1 && o.lng <= lon2
    );

    let theirs: GdbStation[];
    try {
      theirs = await fetchGdb(lat1, lon1, lat2, lon2);
    } catch (e) {
      console.log(c.name.padEnd(18), String(ours.length).padEnd(6), `ошибка: ${(e as Error).message}`);
      continue;
    }

    // их станция «есть у нас», если в 120 м есть наша (и наоборот);
    // «только у нас» считаем вглубь рамки, чтобы не ловить край их выдачи
    const missing = theirs.filter(
      (t) => !oursPadded.some((o) => haversineM(t.lat, t.lon, o.lat, o.lng) < 120)
    );
    const onlyOurs = ours.filter(
      (o) =>
        o.lat >= lat1 + PAD / 2 &&
        o.lat <= lat2 - PAD / 2 &&
        o.lng >= lon1 + PAD &&
        o.lng <= lon2 - PAD &&
        !theirs.some((t) => haversineM(t.lat, t.lon, o.lat, o.lng) < 120)
    ).length;
    const matched = theirs.length - missing.length;
    const coverage =
      theirs.length === 0 ? 100 : Math.round((matched / theirs.length) * 1000) / 10;

    missingAll.push(...missing.map((m) => ({ ...m, city: c.name })));
    report.push({
      city: c.name,
      ours: ours.length,
      theirs: theirs.length,
      matched,
      onlyOurs,
      onlyTheirs: missing.length,
      coverage,
    });

    console.log(
      c.name.padEnd(18),
      String(ours.length).padEnd(6),
      String(theirs.length).padEnd(8),
      String(matched).padEnd(8),
      String(onlyOurs).padEnd(6),
      String(missing.length).padEnd(5),
      `${coverage}%`
    );
    // вежливая пауза к чужому API
    await new Promise((r) => setTimeout(r, 1500));
  }

  const totalTheirs = report.reduce((s, r) => s + r.theirs, 0);
  const totalMatched = report.reduce((s, r) => s + r.matched, 0);
  const totalCoverage =
    totalTheirs === 0 ? 100 : Math.round((totalMatched / totalTheirs) * 1000) / 10;

  writeFileSync(
    'missing-stations.json',
    JSON.stringify(missingAll, null, 2),
    'utf8'
  );
  writeFileSync('coverage-report.json', JSON.stringify(report, null, 2), 'utf8');

  console.log(`\nИТОГО покрытие: ${totalCoverage}% (цель владельца: 99%+)`);
  console.log(
    `→ missing-stations.json: ${missingAll.length} станций в очереди проверки`
  );
  console.log('→ coverage-report.json: полный отчёт по городам');
  const worst = report.filter((r) => r.coverage < 99);
  if (worst.length) {
    console.log(
      `✗ ниже 99%: ${worst.map((r) => `${r.city} ${r.coverage}%`).join(', ')}`
    );
  } else {
    console.log('✓ все города ≥99% — можно запускать рекламу');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
