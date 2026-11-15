// Демо-МЕТКИ поверх реальных АЗС из OSM (станции создаёт scripts/import-osm.ts).
// До появления реального трафика карта должна выглядеть живой:
// ~60% станций получают свежие метки, распределение статусов — по тяжести
// региона (публикации о дефиците, июль 2026). Остальные станции честно
// показывают «нет свежих данных».
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { MarkStatus, QueueSize } from '../src/generated/prisma/enums';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

type Severity = 'critical' | 'limits' | 'watch' | 'ok';

const CITY_SEVERITY: Record<string, Severity> = {
  Москва: 'watch',
  'Санкт-Петербург': 'ok',
  Симферополь: 'critical',
  Севастополь: 'critical',
  Краснодар: 'limits',
  Сочи: 'limits',
  'Ростов-на-Дону': 'limits',
  Астрахань: 'limits',
  Казань: 'watch',
  Воронеж: 'watch',
  Екатеринбург: 'watch',
};

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260711);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

const FUEL_SETS = [
  ['ai92', 'ai95'],
  ['ai92', 'ai95', 'diesel'],
  ['ai95', 'ai98'],
  ['ai92', 'ai95', 'ai98', 'ai100', 'diesel'],
  ['ai95', 'diesel'],
];

type Scenario = {
  weight: number;
  status: MarkStatus;
  queue: QueueSize | null;
  freshMin: [number, number];
  extra: number;
};

const SCENARIOS: Record<Severity, Scenario[]> = {
  ok: [
    { weight: 62, status: 'AVAILABLE', queue: 'NONE', freshMin: [2, 40], extra: 4 },
    { weight: 16, status: 'AVAILABLE', queue: 'UNDER_5', freshMin: [3, 50], extra: 5 },
    { weight: 10, status: 'LOW', queue: 'UNDER_5', freshMin: [5, 60], extra: 4 },
    { weight: 8, status: 'OUT', queue: null, freshMin: [15, 120], extra: 2 },
    { weight: 4, status: 'CLOSED', queue: null, freshMin: [40, 160], extra: 1 },
  ],
  watch: [
    { weight: 34, status: 'AVAILABLE', queue: 'NONE', freshMin: [2, 35], extra: 6 },
    { weight: 18, status: 'AVAILABLE', queue: 'FIVE_TO_20', freshMin: [2, 40], extra: 8 },
    { weight: 20, status: 'LOW', queue: 'UNDER_5', freshMin: [4, 50], extra: 6 },
    { weight: 12, status: 'QUEUE', queue: 'OVER_20', freshMin: [3, 30], extra: 10 },
    { weight: 12, status: 'OUT', queue: null, freshMin: [8, 90], extra: 4 },
    { weight: 4, status: 'CLOSED', queue: null, freshMin: [30, 150], extra: 2 },
  ],
  limits: [
    { weight: 18, status: 'AVAILABLE', queue: 'FIVE_TO_20', freshMin: [2, 25], extra: 10 },
    { weight: 20, status: 'LOW', queue: 'FIVE_TO_20', freshMin: [3, 35], extra: 9 },
    { weight: 22, status: 'QUEUE', queue: 'OVER_20', freshMin: [2, 25], extra: 12 },
    { weight: 30, status: 'OUT', queue: null, freshMin: [5, 60], extra: 6 },
    { weight: 10, status: 'CLOSED', queue: null, freshMin: [20, 120], extra: 3 },
  ],
  critical: [
    { weight: 8, status: 'AVAILABLE', queue: 'OVER_20', freshMin: [2, 20], extra: 14 },
    { weight: 12, status: 'LOW', queue: 'OVER_20', freshMin: [2, 25], extra: 12 },
    { weight: 16, status: 'QUEUE', queue: 'OVER_20', freshMin: [2, 20], extra: 12 },
    { weight: 48, status: 'OUT', queue: null, freshMin: [4, 50], extra: 8 },
    { weight: 16, status: 'CLOSED', queue: null, freshMin: [15, 100], extra: 4 },
  ],
};

function pickScenario(sev: Severity): Scenario {
  const list = SCENARIOS[sev];
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const s of list) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return list[0];
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function main() {
  // выключатель демо-слоя: DEMO_OFF=1 — не сеять (история не трогается);
  // DEMO_CITIES="Москва,Сочи" — сеять только перечисленные города
  if (process.env.DEMO_OFF === '1') {
    console.log('демо-слой выключен (DEMO_OFF=1) — выходим');
    return;
  }

  // РУЧНАЯ команда восстановления демо-слоя (npm run seed:reset-demo).
  // В cron НЕ ставить: регулярная «капельница» — это prisma/drip.ts
  // (npm run seed:demo), она добавляет метки, не трогая историю.
  // Режимы (после инцидента 17.07: разовый посев одного города снёс
  // seed всей страны — полная очистка теперь только по явному --all):
  //   --all         пересеять все города запуска;
  //   --city=Имя    удалить и пересоздать seed ТОЛЬКО этого города.
  const args = process.argv.slice(2);
  const cityArg = args
    .find((a) => a.startsWith('--city='))
    ?.slice('--city='.length)
    .trim();
  const allMode = args.includes('--all');
  if (!allMode && !cityArg) {
    console.error(
      'использование: seed.ts --all | --city=Имя\n' +
        '  --all   пересеять все города (полная очистка seed-меток)\n' +
        '  --city  пересеять только один город, остальные не трогаются'
    );
    process.exit(1);
  }
  if (cityArg && !CITY_SEVERITY[cityArg]) {
    console.error(
      `город «${cityArg}» не входит в города запуска: ${Object.keys(CITY_SEVERITY).join(', ')}`
    );
    process.exit(1);
  }

  const onlyCities = cityArg
    ? new Set([cityArg])
    : process.env.DEMO_CITIES
      ? new Set(process.env.DEMO_CITIES.split(',').map((s) => s.trim()))
      : null;

  const stations = await prisma.station.findMany({
    select: { id: true, city: true },
  });
  console.log(`→ станций в базе: ${stations.length}`);

  let marks = 0;
  const rows: {
    stationId: string;
    status: MarkStatus;
    fuelTypes: string[];
    queueSize: QueueSize | null;
    source: string;
    deviceId: string;
    createdAt: Date;
  }[] = [];

  for (const st of stations) {
    // демо-слой ТОЛЬКО в городах запуска: база теперь общероссийская,
    // и помечать всю страну выдуманными метками нельзя — остальным
    // городам оставляем честное «нет свежих данных»
    const sev = CITY_SEVERITY[st.city];
    if (!sev) continue;
    if (onlyCities && !onlyCities.has(st.city)) continue;
    // ~35% станций с метками: после общероссийского импорта станций в
    // городах стало сильно больше — 60% давало 75 тыс. меток «за сутки»,
    // что кричит фейком; молодому сервису верят в тысячи, не в десятки
    if (rand() > 0.35) continue;

    const sc = pickScenario(sev);
    const fuels = pick(FUEL_SETS);
    // микс возрастов по решению владельца — карта выглядит естественно:
    // 35% свежие (<1 ч) / 40% сегодня (1–24 ч, бледные) /
    // 20% вчера-позавчера (синие «данные недели») / 5% старые (3–6 дней)
    const bucket = rand();
    const freshAge =
      bucket < 0.35
        ? sc.freshMin[0] + rand() * Math.min(sc.freshMin[1] - sc.freshMin[0], 55)
        : bucket < 0.75
          ? 70 + rand() * 1300
          : bucket < 0.95
            ? 1500 + rand() * 1400
            : 4400 + rand() * 4000;

    rows.push({
      stationId: st.id,
      status: sc.status,
      fuelTypes: sc.status === 'OUT' || sc.status === 'CLOSED' ? [] : fuels,
      queueSize: sc.queue,
      source: 'seed',
      deviceId: `seed-fresh-${st.id}`,
      createdAt: minutesAgo(Math.round(freshAge)),
    });

    // 1–2 подтверждения на станцию — правдоподобно для старта
    const extra = Math.min(sc.extra, 1 + Math.floor(rand() * 2));
    for (let j = 0; j < extra; j++) {
      const sameStory = rand() < 0.8;
      rows.push({
        stationId: st.id,
        status: sameStory
          ? sc.status
          : (pick(['AVAILABLE', 'LOW', 'QUEUE', 'OUT']) as MarkStatus),
        fuelTypes: fuels.filter(() => rand() < 0.8),
        queueSize: sameStory ? sc.queue : null,
        source: 'seed',
        deviceId: `seed-${st.id}-${j}`,
        createdAt: minutesAgo(
          Math.round(freshAge + (j < 3 ? rand() * 45 : 10 + rand() * 60 * 20))
        ),
      });
    }
  }

  // очистка и пересев — одной транзакцией: карта ни на секунду не пустеет,
  // а при сбое старые метки остаются. --city чистит только свой город.
  console.log(
    cityArg
      ? `→ пересев города: ${cityArg}`
      : '→ полный пересев всех городов запуска'
  );
  const del = prisma.mark.deleteMany({
    where: cityArg
      ? { deviceId: { startsWith: 'seed-' }, station: { city: cityArg } }
      : { deviceId: { startsWith: 'seed-' } },
  });
  const inserts = [];
  for (let i = 0; i < rows.length; i += 500) {
    inserts.push(prisma.mark.createMany({ data: rows.slice(i, i + 500) }));
  }
  const [deleted] = await prisma.$transaction([del, ...inserts]);
  marks = rows.length;

  console.log(`✓ демо-метки готовы: −${deleted.count} старых, +${marks} новых`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
