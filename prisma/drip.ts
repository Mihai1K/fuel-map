// «Капельный» демо-слой: каждые 10 минут добавляет несколько свежих
// меток в городах запуска — пульс сервиса («метка 2 мин назад»,
// «сейчас помогают N») живой всегда, а не раз в 6 часов после сида.
// Запускается кроном; удаляет seed-метки старше 7 дней, чтобы не пухнуть.
// Демо-слой — явное решение владельца; риск задокументирован в DECISIONS.
import 'dotenv/config';
import { PrismaClient, MarkStatus } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const CITIES = [
  'Москва',
  'Санкт-Петербург',
  'Симферополь',
  'Севастополь',
  'Краснодар',
  'Сочи',
  'Ростов-на-Дону',
  'Астрахань',
  'Казань',
  'Воронеж',
  'Екатеринбург',
];
const HARD = new Set(['Симферополь', 'Севастополь', 'Краснодар', 'Сочи']);

const FUEL_SETS = [
  ['ai92', 'ai95'],
  ['ai92', 'ai95', 'diesel'],
  ['ai95', 'diesel'],
  ['ai92', 'ai95', 'ai98', 'diesel'],
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  if (process.env.DEMO_OFF === '1') return; // демо выключено — тишина
  const allowed = process.env.DEMO_CITIES
    ? CITIES.filter((c) =>
        process.env.DEMO_CITIES!.split(',').map((s) => s.trim()).includes(c)
      )
    : CITIES;
  if (allowed.length === 0) return;
  // 2–7 меток за прогон — ощутимый, но правдоподобный ручеёк
  const n = 2 + Math.floor(Math.random() * 6);
  const city = pick(allowed);
  const stations = await prisma.station.findMany({
    where: { city },
    select: { id: true },
  });
  if (stations.length === 0) return;

  const rows = [];
  for (let i = 0; i < n; i++) {
    const hard = HARD.has(city);
    const r = Math.random();
    const status: MarkStatus = hard
      ? r < 0.35
        ? 'AVAILABLE'
        : r < 0.55
          ? 'QUEUE'
          : r < 0.8
            ? 'OUT'
            : 'LOW'
      : r < 0.72
        ? 'AVAILABLE'
        : r < 0.84
          ? 'LOW'
          : r < 0.94
            ? 'QUEUE'
            : 'OUT';
    rows.push({
      stationId: pick(stations).id,
      status,
      fuelTypes: status === 'OUT' ? [] : pick(FUEL_SETS),
      source: 'seed',
      deviceId: `seed-drip-${Date.now()}-${i}`,
      createdAt: new Date(Date.now() - Math.random() * 9 * 60_000),
    });
  }
  await prisma.mark.createMany({ data: rows });

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  const gone = await prisma.mark.deleteMany({
    where: { deviceId: { startsWith: 'seed-' }, createdAt: { lt: weekAgo } },
  });

  console.log(`✓ drip: +${rows.length} меток (${city}), −${gone.count} старых`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
