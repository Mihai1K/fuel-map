import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withMetrics } from '@/lib/api-metrics';

// Живой пульс сервиса: последняя метка, счётчики активности, лента.
// Ощущение «здесь кто-то есть» — главный актив первых секунд, а
// «я не первый» — главный триггер поставить свою метку (решение владельца).
async function handler() {
  const now = Date.now();
  const tenMinAgo = new Date(now - 10 * 60_000);
  // «сейчас» = 15 минут: часовое окно давало сотни «помогающих» из
  // демо-слоя — неправдоподобно; десятки выглядят честно
  const hourAgo = new Date(now - 15 * 60_000);
  const dayAgo = new Date(now - 24 * 3600_000);
  const monthAgo = new Date(now - 30 * 24 * 3600_000);

  // Пульс сервиса («метка N назад», «сейчас помогают N водителей»,
  // лента) считает ТОЛЬКО реальные отметки водителей (source='user'):
  // seed-слой нельзя выдавать за активность водителей (аудит 21.07).
  const [last, last10min, driversNow, driversToday, drivers30d, recent] =
    await Promise.all([
      prisma.mark.findFirst({
        where: { source: 'user' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.mark.count({
        where: { createdAt: { gte: tenMinAgo }, source: 'user' },
      }),
      prisma.mark
        .findMany({
          where: { createdAt: { gte: hourAgo }, source: 'user' },
          select: { deviceId: true },
          distinct: ['deviceId'],
        })
        .then((r) => r.length),
      prisma.mark
        .findMany({
          where: { createdAt: { gte: dayAgo }, source: 'user' },
          select: { deviceId: true },
          distinct: ['deviceId'],
        })
        .then((r) => r.length),
      prisma.mark
        .findMany({
          where: { createdAt: { gte: monthAgo }, source: 'user' },
          select: { deviceId: true },
          distinct: ['deviceId'],
        })
        .then((r) => r.length),
      prisma.mark.findMany({
        where: { source: 'user' },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          createdAt: true,
          status: true,
          fuelTypes: true,
          station: { select: { city: true, network: true, name: true } },
        },
      }),
    ]);

  return NextResponse.json({
    lastMarkAt: last?.createdAt.toISOString() ?? null,
    last10min,
    driversNow,
    driversToday,
    drivers30d,
    recent: recent.map((m) => ({
      createdAt: m.createdAt.toISOString(),
      status: m.status,
      fuelTypes: m.fuelTypes,
      city: m.station.city,
      network: m.station.network ?? m.station.name,
    })),
  });
}

export const GET = withMetrics('/api/activity', handler);
