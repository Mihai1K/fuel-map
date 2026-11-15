import { prisma } from '@/lib/db';

// Агрегаты админки. Всё считается на сервере, seed исключён из
// пользовательских метрик по построению: AnalyticsEvent пишут только
// живые браузеры, а реальные метки — Mark.source='user'.

const MIN5 = 5 * 60_000;
const MIN15 = 15 * 60_000;
const DAY = 24 * 3600_000;

export type Filters = { days: number; city?: string; src?: string };

function periodStart(days: number): Date {
  return new Date(Date.now() - days * DAY);
}
function todayStartMsk(): Date {
  // границы «сегодня» по Москве (UTC+3)
  const now = new Date(Date.now() + 3 * 3600_000);
  now.setUTCHours(0, 0, 0, 0);
  return new Date(now.getTime() - 3 * 3600_000);
}

export async function liveCounters() {
  const now = Date.now();
  const [now5, now15, last] = await Promise.all([
    prisma.analyticsVisitor.count({
      where: { lastSeenAt: { gte: new Date(now - MIN5) } },
    }),
    prisma.analyticsVisitor.count({
      where: { lastSeenAt: { gte: new Date(now - MIN15) } },
    }),
    prisma.analyticsEvent.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  return {
    activeNow: now5,
    active15: now15,
    lastEventAt: last?.createdAt.toISOString() ?? null,
    at: new Date().toISOString(),
  };
}

export async function headline() {
  const today = todayStartMsk();
  const [
    dau,
    wau,
    mau,
    newToday,
    marksToday,
    seedToday,
    markersToday,
    firstData,
  ] = await Promise.all([
    prisma.analyticsSession
      .findMany({
        where: { lastSeenAt: { gte: today } },
        select: { anonymousIdHash: true },
        distinct: ['anonymousIdHash'],
      })
      .then((r) => r.length),
    prisma.analyticsSession
      .findMany({
        where: { lastSeenAt: { gte: periodStart(7) } },
        select: { anonymousIdHash: true },
        distinct: ['anonymousIdHash'],
      })
      .then((r) => r.length),
    prisma.analyticsSession
      .findMany({
        where: { lastSeenAt: { gte: periodStart(30) } },
        select: { anonymousIdHash: true },
        distinct: ['anonymousIdHash'],
      })
      .then((r) => r.length),
    prisma.analyticsVisitor.count({ where: { firstSeenAt: { gte: today } } }),
    prisma.mark.count({
      where: { source: 'user', createdAt: { gte: today } },
    }),
    prisma.mark.count({
      where: { source: 'seed', createdAt: { gte: today } },
    }),
    prisma.analyticsEvent
      .findMany({
        where: { eventName: 'mark_completed', createdAt: { gte: today } },
        select: { anonymousIdHash: true },
        distinct: ['anonymousIdHash'],
      })
      .then((r) => r.length),
    prisma.analyticsEvent.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  // SFS proxy: доля сессий, где за 60 с после открытия карты человек
  // открыл АЗС, построил маршрут или оставил метку (прокси, не гарантия)
  const sfs = await prisma.$queryRaw<{ ok: bigint; total: bigint }[]>`
    WITH m AS (
      SELECT "sessionIdHash", min("createdAt") AS t
      FROM "AnalyticsEvent"
      WHERE "eventName" = 'map_open' AND "createdAt" >= ${periodStart(7)}
      GROUP BY 1
    )
    SELECT
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "AnalyticsEvent" e
        WHERE e."sessionIdHash" = m."sessionIdHash"
          AND e."eventName" IN ('station_open','route_click','mark_completed')
          AND e."createdAt" BETWEEN m.t AND m.t + interval '60 seconds'
      )) AS ok,
      count(*) AS total
    FROM m`;

  const sfsOk = Number(sfs[0]?.ok ?? 0);
  const sfsTotal = Number(sfs[0]?.total ?? 0);

  return {
    dau,
    wau,
    mau,
    newToday,
    returningToday: Math.max(dau - newToday, 0),
    marksToday,
    seedToday,
    markShare: dau > 0 ? Math.round((markersToday / dau) * 100) : null,
    sfsPct: sfsTotal >= 5 ? Math.round((sfsOk / sfsTotal) * 100) : null,
    sfsTotal,
    firstDataAt: firstData?.createdAt.toISOString() ?? null,
  };
}

const FUNNEL_STEPS = [
  ['Открыл сервис', ['app_open', 'map_open']],
  ['Открыл карту', ['map_open']],
  ['Открыл карточку АЗС', ['station_open']],
  ['Построил маршрут', ['route_click']],
  ['Оставил отметку', ['mark_completed']],
  ['Поделился или установил', ['share_click', 'install_completed']],
] as const;

export async function funnel(f: Filters) {
  const since = periodStart(f.days);
  const rows = await prisma.$queryRaw<{ name: string; n: bigint }[]>`
    SELECT e."eventName" AS name, count(DISTINCT e."sessionIdHash") AS n
    FROM "AnalyticsEvent" e
    JOIN "AnalyticsSession" s ON s."sessionIdHash" = e."sessionIdHash"
    WHERE e."createdAt" >= ${since}
      AND (${f.city ?? null}::text IS NULL OR s.city = ${f.city ?? null})
      AND (${f.src ?? null}::text IS NULL OR s."utmSource" = ${f.src ?? null})
    GROUP BY 1`;
  const byName = new Map(rows.map((r) => [r.name, Number(r.n)]));
  // шаг = максимум по входящим событиям (сессии уникальны внутри события)
  return FUNNEL_STEPS.map(([label, names]) => ({
    label,
    n: Math.max(...names.map((n) => byName.get(n) ?? 0)),
  }));
}

export async function daily(f: Filters) {
  const since = periodStart(f.days);
  const rows = await prisma.$queryRaw<
    {
      day: Date;
      users: bigint;
      sessions: bigint;
      cards: bigint;
      routes: bigint;
      marks: bigint;
      installs: bigint;
      shares: bigint;
    }[]
  >`
    SELECT
      date_trunc('day', e."createdAt" AT TIME ZONE 'Europe/Moscow') AS day,
      count(DISTINCT e."anonymousIdHash") AS users,
      count(DISTINCT e."sessionIdHash") AS sessions,
      count(*) FILTER (WHERE e."eventName" = 'station_open') AS cards,
      count(*) FILTER (WHERE e."eventName" = 'route_click') AS routes,
      count(*) FILTER (WHERE e."eventName" = 'mark_completed') AS marks,
      count(*) FILTER (WHERE e."eventName" = 'install_completed') AS installs,
      count(*) FILTER (WHERE e."eventName" = 'share_click') AS shares
    FROM "AnalyticsEvent" e
    JOIN "AnalyticsSession" s ON s."sessionIdHash" = e."sessionIdHash"
    WHERE e."createdAt" >= ${since}
      AND (${f.city ?? null}::text IS NULL OR s.city = ${f.city ?? null})
      AND (${f.src ?? null}::text IS NULL OR s."utmSource" = ${f.src ?? null})
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    users: Number(r.users),
    sessions: Number(r.sessions),
    cards: Number(r.cards),
    routes: Number(r.routes),
    marks: Number(r.marks),
    installs: Number(r.installs),
    shares: Number(r.shares),
  }));
}

export async function sources(f: Filters) {
  const since = periodStart(f.days);
  const rows = await prisma.$queryRaw<
    {
      source: string | null;
      medium: string | null;
      campaign: string | null;
      content: string | null;
      users: bigint;
      maps: bigint;
      cards: bigint;
      routes: bigint;
      marks: bigint;
    }[]
  >`
    SELECT
      coalesce(s."utmSource", s."referrerDomain", 'прямые') AS source,
      s."utmMedium" AS medium,
      s."utmCampaign" AS campaign,
      s."utmContent" AS content,
      count(DISTINCT s."anonymousIdHash") AS users,
      count(DISTINCT e."sessionIdHash") FILTER (WHERE e."eventName" = 'map_open') AS maps,
      count(DISTINCT e."sessionIdHash") FILTER (WHERE e."eventName" = 'station_open') AS cards,
      count(DISTINCT e."sessionIdHash") FILTER (WHERE e."eventName" = 'route_click') AS routes,
      count(DISTINCT e."sessionIdHash") FILTER (WHERE e."eventName" = 'mark_completed') AS marks
    FROM "AnalyticsSession" s
    LEFT JOIN "AnalyticsEvent" e ON e."sessionIdHash" = s."sessionIdHash"
    WHERE s."startedAt" >= ${since}
      -- тестовые переходы (utm_medium=test) в продуктовые отчёты не входят
      AND (s."utmMedium" IS NULL OR s."utmMedium" <> 'test')
    GROUP BY 1, 2, 3, 4
    ORDER BY users DESC
    LIMIT 30`;
  return rows.map((r) => ({
    source: r.source ?? 'прямые',
    medium: r.medium,
    campaign: r.campaign,
    content: r.content,
    users: Number(r.users),
    maps: Number(r.maps),
    cards: Number(r.cards),
    routes: Number(r.routes),
    marks: Number(r.marks),
  }));
}

export async function cities(f: Filters) {
  const since = periodStart(f.days);
  const today = todayStartMsk();
  const rows = await prisma.$queryRaw<
    {
      city: string;
      active: bigint;
      today_users: bigint;
      users: bigint;
      cards: bigint;
      routes: bigint;
      marks: bigint;
    }[]
  >`
    SELECT
      s.city,
      count(DISTINCT s."anonymousIdHash") FILTER (WHERE s."lastSeenAt" >= now() - interval '5 minutes') AS active,
      count(DISTINCT s."anonymousIdHash") FILTER (WHERE s."lastSeenAt" >= ${today}) AS today_users,
      count(DISTINCT s."anonymousIdHash") AS users,
      count(DISTINCT e."sessionIdHash") FILTER (WHERE e."eventName" = 'station_open') AS cards,
      count(DISTINCT e."sessionIdHash") FILTER (WHERE e."eventName" = 'route_click') AS routes,
      count(DISTINCT e."sessionIdHash") FILTER (WHERE e."eventName" = 'mark_completed') AS marks
    FROM "AnalyticsSession" s
    LEFT JOIN "AnalyticsEvent" e ON e."sessionIdHash" = s."sessionIdHash"
    WHERE s."startedAt" >= ${since} AND s.city IS NOT NULL
    GROUP BY 1 ORDER BY users DESC LIMIT 20`;
  // покрытие: сколько АЗС города имеют свежие РЕАЛЬНЫЕ метки (24 ч)
  const cityNames = rows.map((r) => r.city);
  const coverage = cityNames.length
    ? await prisma.$queryRaw<{ city: string; total: bigint; fresh: bigint }[]>`
      SELECT st.city,
        count(*) AS total,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "Mark" m
          WHERE m."stationId" = st.id AND m.source = 'user'
            AND m."createdAt" >= now() - interval '24 hours'
        )) AS fresh
      FROM "Station" st
      WHERE st.city = ANY(${cityNames})
      GROUP BY 1`
    : [];
  const covByCity = new Map(
    coverage.map((c) => [c.city, { total: Number(c.total), fresh: Number(c.fresh) }])
  );
  return rows.map((r) => ({
    city: r.city,
    active: Number(r.active),
    todayUsers: Number(r.today_users),
    users: Number(r.users),
    cards: Number(r.cards),
    routes: Number(r.routes),
    marks: Number(r.marks),
    stationsTotal: covByCity.get(r.city)?.total ?? 0,
    stationsFreshReal: covByCity.get(r.city)?.fresh ?? 0,
  }));
}

const EVENT_LABEL: Record<string, string> = {
  station_open: 'открыта карточка',
  route_click: 'построен маршрут',
  mark_completed: 'оставлена отметка',
  share_click: 'поделился сервисом',
  install_completed: 'установлено приложение',
  map_open: 'открыта карта',
  station_search: 'поиск',
};

export async function recentActions() {
  const rows = await prisma.analyticsEvent.findMany({
    where: {
      eventName: {
        in: ['station_open', 'route_click', 'mark_completed', 'share_click', 'install_completed'],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { eventName: true, city: true, stationId: true, createdAt: true },
  });
  const stationIds = [...new Set(rows.map((r) => r.stationId).filter(Boolean))] as string[];
  const stations = stationIds.length
    ? await prisma.station.findMany({
        where: { id: { in: stationIds } },
        select: { id: true, network: true, name: true },
      })
    : [];
  const names = new Map(stations.map((s) => [s.id, s.network ?? s.name]));
  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    city: r.city,
    text:
      (EVENT_LABEL[r.eventName] ?? r.eventName) +
      (r.stationId && names.get(r.stationId) ? ` · ${names.get(r.stationId)}` : ''),
  }));
}

export async function dataQuality() {
  const dayAgo = new Date(Date.now() - DAY);
  const [total, realFresh, seedOnly, realMarks24, seedMarks24] =
    await Promise.all([
      prisma.station.count(),
      prisma.station.count({
        where: { marks: { some: { source: 'user', createdAt: { gte: dayAgo } } } },
      }),
      prisma.station.count({
        where: {
          marks: { some: { source: 'seed', createdAt: { gte: dayAgo } } },
          NOT: { marks: { some: { source: 'user', createdAt: { gte: dayAgo } } } },
        },
      }),
      prisma.mark.count({ where: { source: 'user', createdAt: { gte: dayAgo } } }),
      prisma.mark.count({ where: { source: 'seed', createdAt: { gte: dayAgo } } }),
    ]);
  return {
    total,
    realFresh,
    seedOnly,
    realMarks24,
    seedMarks24,
    realShare:
      realMarks24 + seedMarks24 > 0
        ? Math.round((realMarks24 / (realMarks24 + seedMarks24)) * 100)
        : null,
    demoOff: process.env.DEMO_OFF === '1',
    demoCities: process.env.DEMO_CITIES ?? 'все 10 городов запуска',
  };
}

export async function techHealth() {
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbMs = Date.now() - t0;
  const [lastImport, lastSeed, lastReal] = await Promise.all([
    prisma.station.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.mark.findFirst({
      where: { source: 'seed' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.mark.findFirst({
      where: { source: 'user' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  return {
    dbMs,
    lastImportAt: lastImport?.createdAt.toISOString() ?? null,
    lastSeedAt: lastSeed?.createdAt.toISOString() ?? null,
    lastRealMarkAt: lastReal?.createdAt.toISOString() ?? null,
  };
}


// Тех-здоровье API: ошибки, перцентили, доля неуспешных отметок
export async function apiHealth() {
  const hourAgo = new Date(Date.now() - 3600_000);
  const dayAgo = new Date(Date.now() - DAY);
  const [byPath, errHour, errDay] = await Promise.all([
    prisma.$queryRaw<
      { path: string; p50: number; p95: number; total: bigint; fails: bigint }[]
    >`
      SELECT path,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95,
        count(*) AS total,
        count(*) FILTER (WHERE NOT ok) AS fails
      FROM "ApiMetric"
      WHERE "createdAt" >= ${dayAgo}
      GROUP BY path ORDER BY path`,
    prisma.apiMetric.count({ where: { ok: false, createdAt: { gte: hourAgo } } }),
    prisma.apiMetric.count({ where: { ok: false, createdAt: { gte: dayAgo } } }),
  ]);
  return {
    errHour,
    errDay,
    paths: byPath.map((r) => ({
      path: r.path,
      p50: Math.round(Number(r.p50)),
      p95: Math.round(Number(r.p95)),
      total: Number(r.total),
      failPct:
        Number(r.total) > 0
          ? Math.round((Number(r.fails) / Number(r.total)) * 100)
          : 0,
    })),
  };
}

// Web Vitals p75 за сутки (из событий web_vitals)
export async function webVitals() {
  const dayAgo = new Date(Date.now() - DAY);
  const rows = await prisma.$queryRaw<
    { lcp: number | null; inp: number | null; cls: number | null; n: bigint }[]
  >`
    SELECT
      percentile_cont(0.75) WITHIN GROUP (ORDER BY (metadata->>'lcp')::numeric) AS lcp,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY (metadata->>'inp')::numeric) AS inp,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY (metadata->>'cls')::numeric) AS cls,
      count(*) AS n
    FROM "AnalyticsEvent"
    WHERE "eventName" = 'web_vitals' AND "createdAt" >= ${dayAgo}
      AND metadata->>'lcp' ~ '^[0-9.]+$'`;
  const r = rows[0];
  return {
    n: Number(r?.n ?? 0),
    lcp: r?.lcp !== null && r?.lcp !== undefined ? Math.round(Number(r.lcp)) : null,
    inp: r?.inp !== null && r?.inp !== undefined ? Math.round(Number(r.inp)) : null,
    cls: r?.cls !== null && r?.cls !== undefined ? Number(Number(r.cls).toFixed(3)) : null,
  };
}
