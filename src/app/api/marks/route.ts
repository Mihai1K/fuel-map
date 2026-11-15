import { NextResponse } from 'next/server';
import { withMetrics } from '@/lib/api-metrics';
import { prisma } from '@/lib/db';
import { loadStation, serializeStation } from '@/lib/stations';

const STATUSES = ['AVAILABLE', 'LOW', 'QUEUE', 'OUT', 'CLOSED'] as const;
const QUEUES = [
  'NONE',
  'UNDER_5',
  'FIVE_TO_20',
  'M15_30',
  'OVER_30',
  'OVER_20',
] as const;
const FUELS = ['ai92', 'ai95', 'ai98', 'ai100', 'diesel', 'gas'];
const LIMITS = ['NONE', 'FULL_TANK', 'L10', 'L20', 'L30', 'L40', 'L50'];

function cleanFuels(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((f): f is string => typeof f === 'string' && FUELS.includes(f))
    : [];
}

// Цены: { fuel: ₽/л }. Принимаем только известные марки и вменяемый
// диапазон 10–200 ₽/л (отсекаем опечатки и мусор), округляем до копеек.
function cleanPrices(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== 'object') return null;
  const out: Record<string, number> = {};
  for (const [fuel, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!FUELS.includes(fuel)) continue;
    // клиент шлёт число, но на всякий случай принимаем и строку с запятой
    const n =
      typeof raw === 'number'
        ? raw
        : Number(String(raw).replace(',', '.').trim());
    if (Number.isFinite(n) && n >= 10 && n <= 200) {
      out[fuel] = Math.round(n * 100) / 100;
    }
  }
  return Object.keys(out).length ? out : null;
}

// Простейшая защита от накрутки: не чаще одной метки на станцию
// с устройства за 10 минут (см. ASSUMPTIONS.md).
const RATE_LIMIT_MIN = 10;

async function postHandler(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { stationId, status, fuelTypes, fuelsOut, limitInfo, queueSize, prices, deviceId } =
    (body ?? {}) as Record<string, unknown>;

  if (
    typeof stationId !== 'string' ||
    typeof deviceId !== 'string' ||
    deviceId.length < 8 ||
    deviceId.length > 64 ||
    !STATUSES.includes(status as (typeof STATUSES)[number])
  ) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const fuels = cleanFuels(fuelTypes);
  const outFuels = cleanFuels(fuelsOut).filter((f) => !fuels.includes(f));
  const queue = QUEUES.includes(queueSize as (typeof QUEUES)[number])
    ? (queueSize as (typeof QUEUES)[number])
    : null;
  const limit =
    typeof limitInfo === 'string' && LIMITS.includes(limitInfo)
      ? limitInfo
      : null;
  // цену принимаем только для реально имеющихся марок (fuels) и только
  // когда топливо есть: у OUT/CLOSED цен быть не должно (ревью 25.07)
  const priceMap = cleanPrices(prices);
  const priceForFuels = priceMap
    ? Object.fromEntries(Object.entries(priceMap).filter(([f]) => fuels.includes(f)))
    : null;
  const priceValue =
    status !== 'OUT' &&
    status !== 'CLOSED' &&
    priceForFuels &&
    Object.keys(priceForFuels).length
      ? priceForFuels
      : null;

  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) {
    return NextResponse.json({ error: 'station not found' }, { status: 404 });
  }

  const recent = await prisma.mark.findFirst({
    where: {
      stationId,
      deviceId,
      createdAt: { gte: new Date(Date.now() - RATE_LIMIT_MIN * 60_000) },
    },
  });
  if (recent) {
    // Метку уже приняли недавно — не ругаемся, просто отдаём свежее
    // состояние (и id той метки — уточнение всё ещё возможно).
    const dto = await loadStation(stationId);
    return NextResponse.json({
      station: dto ? serializeStation(dto) : null,
      markId: recent.id,
      deduplicated: true,
    });
  }

  const mark = await prisma.mark.create({
    data: {
      stationId,
      status: status as (typeof STATUSES)[number],
      fuelTypes: fuels,
      fuelsOut: outFuels,
      limitInfo: limit,
      queueSize: queue,
      ...(priceValue ? { prices: priceValue } : {}),
      deviceId,
      // реальная метка; seed пишут только prisma/seed.ts и drip.ts
      source: 'user',
    },
  });

  const dto = await loadStation(stationId);
  return NextResponse.json({
    station: dto ? serializeStation(dto) : null,
    markId: mark.id,
  });
}

// Уточнение СВОЕЙ свежей метки: какое топливо есть (или какого нет)
// и какая очередь. Не создаёт новую метку — дополняет существующую,
// поэтому rate-limit не мешает.
export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { markId, deviceId, fuelTypes, fuelsOut, limitInfo, queueSize, prices } =
    (body ?? {}) as Record<string, unknown>;

  if (
    typeof markId !== 'string' ||
    typeof deviceId !== 'string' ||
    deviceId.length < 8 ||
    deviceId.length > 64
  ) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const mark = await prisma.mark.findUnique({ where: { id: markId } });
  // уточнять можно только свою метку и только пока она свежая
  if (
    !mark ||
    mark.deviceId !== deviceId ||
    Date.now() - mark.createdAt.getTime() > RATE_LIMIT_MIN * 60_000
  ) {
    return NextResponse.json({ error: 'mark not found' }, { status: 404 });
  }

  const fuels = Array.isArray(fuelTypes) ? cleanFuels(fuelTypes) : undefined;
  const outFuels = Array.isArray(fuelsOut) ? cleanFuels(fuelsOut) : undefined;
  const queue = QUEUES.includes(queueSize as (typeof QUEUES)[number])
    ? (queueSize as (typeof QUEUES)[number])
    : undefined;
  const limit =
    typeof limitInfo === 'string' && LIMITS.includes(limitInfo)
      ? limitInfo
      : undefined;
  // семантика уточнения «какого топлива нет» у OUT-метки — в fuelsOut
  const refinedOut =
    mark.status === 'OUT' && fuels !== undefined && outFuels === undefined
      ? fuels
      : outFuels;
  const refinedFuels =
    mark.status === 'OUT' && fuels !== undefined && outFuels === undefined
      ? []
      : fuels;

  // Реконсиляция цен: цена привязана к НАЛИЧИЮ марки (ревью 25.07).
  // Итоговый набор доступных марок: закрыто → пусто; уточнили список → он;
  // иначе — что было у метки. Присланные цены накладываются на сохранённые,
  // затем цены убранных марок вычищаются из JSON, а у OUT/CLOSED цен нет.
  const priceMap = cleanPrices(prices);
  const existingPrices = (mark.prices as Record<string, number> | null) ?? {};
  const availableAfter =
    mark.status === 'CLOSED'
      ? []
      : refinedFuels !== undefined
        ? refinedFuels
        : mark.fuelTypes;
  let priceUpdate: Record<string, number> | undefined = undefined;
  if (
    priceMap ||
    refinedFuels !== undefined ||
    mark.status === 'OUT' ||
    mark.status === 'CLOSED'
  ) {
    const merged: Record<string, number> = {
      ...existingPrices,
      ...(priceMap ?? {}),
    };
    const cleaned: Record<string, number> = {};
    for (const [f, v] of Object.entries(merged)) {
      if (availableAfter.includes(f)) cleaned[f] = v;
    }
    priceUpdate = cleaned; // пустой объект = цен нет (валидный JSON, без DbNull)
  }

  await prisma.mark.update({
    where: { id: markId },
    data: {
      ...(refinedFuels !== undefined ? { fuelTypes: refinedFuels } : {}),
      ...(refinedOut !== undefined ? { fuelsOut: refinedOut } : {}),
      ...(queue !== undefined ? { queueSize: queue } : {}),
      ...(limit !== undefined ? { limitInfo: limit } : {}),
      ...(priceUpdate !== undefined ? { prices: priceUpdate } : {}),
    },
  });

  const dto = await loadStation(mark.stationId);
  return NextResponse.json({ station: dto });
}

export const POST = withMetrics('/api/marks', postHandler);
