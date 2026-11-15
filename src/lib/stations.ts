import { cache } from 'react';
import { prisma } from '@/lib/db';
import {
  computeFuelStatuses,
  computeState,
  type Dispute,
  type FuelPrice,
  type FuelStatus,
  type MarkLite,
  type StationState,
} from '@/lib/status';
import { FUEL_SLUG_BY_CODE, type FuelSlug } from '@/lib/seo-pilot';

export type StationDTO = {
  id: string;
  name: string;
  network: string | null;
  address: string;
  lat: number;
  lng: number;
  fuelStatuses: FuelStatus[];
} & StationState;

// Клиентская форма цены марки: Date → ISO-строка для передачи в браузер.
export type ClientFuelPrice = Omit<FuelPrice, 'updatedAt'> & {
  updatedAt: string;
};
// Противоречие в клиентской форме: время конфликтующей отметки — ISO-строка.
export type ClientDispute = Omit<Dispute, 'at'> & { at: string };
export type ClientStationDTO = Omit<
  StationDTO,
  'updatedAt' | 'prices' | 'dispute'
> & {
  updatedAt: string | null;
  prices: Record<string, ClientFuelPrice> | null;
  dispute: ClientDispute | null;
};

// Единая сериализация станции для клиента: даты → ISO (в т. ч. время
// каждой цены). Используется страницей карты и /api/stations.
export function serializeStation(s: StationDTO): ClientStationDTO {
  return {
    ...s,
    updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
    dispute: s.dispute
      ? { ...s.dispute, at: s.dispute.at.toISOString() }
      : null,
    prices: s.prices
      ? Object.fromEntries(
          Object.entries(s.prices).map(([fuel, p]) => [
            fuel,
            { ...p, updatedAt: p.updatedAt.toISOString() },
          ])
        )
      : null,
  };
}

// Метки за 7 дней: статус (TTL 3 ч/сутки), «данные недели» (синие пины)
// и счётчик доверия. Старые данные ≠ нет данных (решение владельца).
export async function loadStations(city = 'Москва'): Promise<StationDTO[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const stations = await prisma.station.findMany({
    where: { city },
    include: {
      marks: {
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return stations.map((s) => ({
    id: s.id,
    name: s.name,
    network: s.network,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    fuelStatuses: computeFuelStatuses(s.marks as MarkLite[]),
    ...computeState(s.marks as MarkLite[]),
  }));
}

// Карта грузит станции по видимой области, а не по имени города: база
// общероссийская, и водитель между городами должен видеть заправки там,
// куда смотрит. Лимит защищает от «вся Россия одним запросом».
const BBOX_LIMIT = 3000;

export async function loadStationsByBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number
): Promise<StationDTO[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const stations = await prisma.station.findMany({
    where: {
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
    },
    take: BBOX_LIMIT,
    include: {
      marks: {
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return stations.map((s) => ({
    id: s.id,
    name: s.name,
    network: s.network,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    fuelStatuses: computeFuelStatuses(s.marks as MarkLite[]),
    ...computeState(s.marks as MarkLite[]),
  }));
}

export async function loadStation(id: string): Promise<StationDTO | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const s = await prisma.station.findUnique({
    where: { id },
    include: {
      marks: {
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    network: s.network,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    fuelStatuses: computeFuelStatuses(s.marks as MarkLite[]),
    ...computeState(s.marks as MarkLite[]),
  };
}

// Данные для SEO-страниц «топливо × город» (пилот): в контенте
// участвуют ТОЛЬКО реальные отметки водителей (source='user') —
// seed-слой сюда не попадает никогда (правило владельца, 20.07).
export type FuelPageData = {
  totalStations: number;
  networks: { name: string; count: number }[];
  userMarked: {
    id: string;
    name: string;
    network: string | null;
    address: string;
    lat: number;
    lng: number;
    status: string;
    markedAt: Date;
    price: number | null;
  }[];
  lastUserMarkAt: Date | null;
  topNoData: {
    id: string;
    name: string;
    network: string | null;
    address: string;
    lat: number;
    lng: number;
  }[];
};

export const loadFuelPageData = cache(async function loadFuelPageData(
  city: string,
  fuelCode: string
): Promise<FuelPageData> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const stations = await prisma.station.findMany({
    where: { city },
    include: {
      marks: {
        where: {
          createdAt: { gte: since },
          source: 'user',
          fuelTypes: { has: fuelCode },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const networksMap = new Map<string, number>();
  for (const s of stations) {
    if (s.network) networksMap.set(s.network, (networksMap.get(s.network) ?? 0) + 1);
  }
  const networks = [...networksMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  const userMarked = stations
    .filter((s) => s.marks.length > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      network: s.network,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      status: s.marks[0].status as string,
      markedAt: s.marks[0].createdAt,
      price:
        (s.marks[0].prices as Record<string, number> | null)?.[fuelCode] ?? null,
    }))
    .sort((a, b) => b.markedAt.getTime() - a.markedAt.getTime())
    .slice(0, 15);

  const lastUserMarkAt = userMarked.length ? userMarked[0].markedAt : null;

  // крупные сети без свежих user-данных — честно помечаются на странице
  const markedIds = new Set(userMarked.map((s) => s.id));
  const topNoData = stations
    .filter((s) => !markedIds.has(s.id) && s.network)
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      name: s.name,
      network: s.network,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
    }));

  return { totalStations: stations.length, networks, userMarked, lastUserMarkAt, topNoData };
});

// Гейт индексации SEO-сетки «город × топливо» (заменяет статичный
// whitelist пилота, отменённый владельцем 23.08.2026): страница
// индексируется, только если в городе достаточно АЗС и марку хотя бы
// раз реально отмечал водитель — иначе получаем пустую комбинацию без
// собственных данных («малоценная страница» в терминах Яндекса).
const GATE_MIN_STATIONS = 3;

// Один проход по городам + маркам за весь запрос (react cache): дешевле,
// чем N+1 запрос на каждую страницу/на каждую комбинацию в sitemap.
export const loadIndexableFuelMap = cache(async function loadIndexableFuelMap(): Promise<
  Map<string, Set<string>>
> {
  const stationCounts = await prisma.station.groupBy({
    by: ['city'],
    _count: { _all: true },
  });
  const eligibleCities = new Set(
    stationCounts.filter((c) => c._count._all >= GATE_MIN_STATIONS).map((c) => c.city)
  );

  const marks = await prisma.mark.findMany({
    where: { source: 'user' },
    select: { fuelTypes: true, station: { select: { city: true } } },
  });

  const map = new Map<string, Set<string>>();
  for (const m of marks) {
    if (!eligibleCities.has(m.station.city)) continue;
    const set = map.get(m.station.city) ?? new Set<string>();
    for (const f of m.fuelTypes) set.add(f);
    map.set(m.station.city, set);
  }
  return map;
});

export async function loadIndexableFuelsForCity(city: string): Promise<FuelSlug[]> {
  const map = await loadIndexableFuelMap();
  const codes = map.get(city);
  if (!codes) return [];
  return [...codes]
    .map((code) => FUEL_SLUG_BY_CODE[code])
    .filter((s): s is FuelSlug => Boolean(s));
}

export async function isFuelPageIndexable(city: string, fuelCode: string): Promise<boolean> {
  const map = await loadIndexableFuelMap();
  return map.get(city)?.has(fuelCode) ?? false;
}
