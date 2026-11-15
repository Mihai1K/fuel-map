import { prisma } from '@/lib/db';
import { computeState, type MarkLite } from '@/lib/status';

// «Индекс топлива» — доля заправок с подтверждённым топливом среди
// заправок, о которых есть свежие данные (сутки). Без снапшот-таблицы:
// вчерашнее значение считаем по меткам позавчера-вчера — дельта честная,
// а схема БД не растёт (не дублируем факт, всё выводится из меток).
export type IndexRow = {
  scope: string; // 'Россия' или город
  alive: number; // есть топливо (есть/мало/очередь)
  out: number; // нет топлива / закрыта
  withData: number;
  pct: number | null; // null — данных мало
  pctYesterday: number | null;
  level: 'good' | 'tense' | 'deficit' | 'nodata';
};

export const INDEX_LEVEL = {
  good: { emoji: '🟢', label: 'Хорошо' },
  tense: { emoji: '🟠', label: 'Напряжённо' },
  deficit: { emoji: '🔴', label: 'Дефицит' },
  nodata: { emoji: '⚪', label: 'Мало данных' },
} as const;

// меньше 8 станций с данными — процент не показываем, чтобы не врать
const MIN_DATA = 8;

function levelOf(pct: number | null): IndexRow['level'] {
  if (pct === null) return 'nodata';
  if (pct >= 80) return 'good';
  if (pct >= 50) return 'tense';
  return 'deficit';
}

function share(marksByStation: MarkLite[][]): {
  alive: number;
  out: number;
} {
  let alive = 0;
  let out = 0;
  for (const marks of marksByStation) {
    const st = computeState(marks);
    if (st.status === 'AVAILABLE' || st.status === 'LOW' || st.status === 'QUEUE') alive++;
    else if (st.status === 'OUT' || st.status === 'CLOSED') out++;
  }
  return { alive, out };
}

// счётчики по статусам за сутки — для витрины «🟢 18 724 · 🟡 1 851 …»
export type StatusCounts = {
  available: number;
  low: number;
  queue: number;
  out: number;
  nodata: number;
};

export async function computeFuelIndex(): Promise<{
  russia: IndexRow;
  cities: IndexRow[];
  counts: StatusCounts;
  updatedAt: string;
}> {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600_000);
  const twoDaysAgo = new Date(now - 48 * 3600_000);

  const stations = await prisma.station.findMany({
    select: {
      city: true,
      marks: {
        where: { createdAt: { gte: twoDaysAgo } },
        orderBy: { createdAt: 'desc' },
        select: {
          status: true,
          createdAt: true,
          fuelTypes: true,
          fuelsOut: true,
          limitInfo: true,
          queueSize: true,
        },
      },
    },
  });

  const byCity = new Map<string, { today: MarkLite[][]; yest: MarkLite[][] }>();
  const all = { today: [] as MarkLite[][], yest: [] as MarkLite[][] };
  const counts: StatusCounts = {
    available: 0,
    low: 0,
    queue: 0,
    out: 0,
    nodata: 0,
  };

  for (const s of stations) {
    const today = s.marks.filter((m) => m.createdAt >= dayAgo) as MarkLite[];
    // витринные счётчики по текущему статусу (метки за сутки)
    if (today.length === 0) {
      counts.nodata++;
    } else {
      const st = computeState(today).status;
      if (st === 'AVAILABLE') counts.available++;
      else if (st === 'LOW') counts.low++;
      else if (st === 'QUEUE') counts.queue++;
      else if (st === 'OUT' || st === 'CLOSED') counts.out++;
      else counts.nodata++;
    }
    if (s.marks.length === 0) continue;
    const yest = s.marks.filter((m) => m.createdAt < dayAgo) as MarkLite[];
    const bucket = byCity.get(s.city) ?? { today: [], yest: [] };
    if (today.length) {
      bucket.today.push(today);
      all.today.push(today);
    }
    if (yest.length) {
      bucket.yest.push(yest);
      all.yest.push(yest);
    }
    byCity.set(s.city, bucket);
  }

  function rowOf(scope: string, b: { today: MarkLite[][]; yest: MarkLite[][] }): IndexRow {
    const t = share(b.today);
    const withData = t.alive + t.out;
    const pct = withData >= MIN_DATA ? Math.round((t.alive / withData) * 100) : null;
    const y = share(b.yest);
    const yWith = y.alive + y.out;
    const pctY = yWith >= MIN_DATA ? Math.round((y.alive / yWith) * 100) : null;
    return {
      scope,
      alive: t.alive,
      out: t.out,
      withData,
      pct,
      pctYesterday: pctY,
      level: levelOf(pct),
    };
  }

  const cities = [...byCity.entries()]
    .map(([city, b]) => rowOf(city, b))
    .filter((r) => r.withData >= MIN_DATA && r.scope !== '—')
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));

  return {
    russia: rowOf('Россия', all),
    cities,
    counts,
    updatedAt: new Date().toISOString(),
  };
}

export type IndexHistoryPoint = { date: string; pct: number | null };

// История снапшотов (см. prisma/snapshot-fuel-index.ts) — независима от
// computeFuelIndex, читает уже сохранённые дневные значения.
export async function loadFuelIndexHistory(
  scope: string,
  days = 30
): Promise<IndexHistoryPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const rows = await prisma.fuelIndexSnapshot.findMany({
    where: { scope, date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { date: true, pct: true },
  });
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), pct: r.pct }));
}
