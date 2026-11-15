import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { driverName } from '@/lib/status';

// История станции: последние метки для ленты-чата в карточке.
// Имя — стабильный псевдоним из deviceId (сырой deviceId наружу не отдаём).
export async function GET(req: Request) {
  const stationId = new URL(req.url).searchParams.get('stationId');
  if (!stationId) {
    return NextResponse.json({ error: 'stationId required' }, { status: 400 });
  }
  const rows = await prisma.mark.findMany({
    where: { stationId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      status: true,
      fuelTypes: true,
      fuelsOut: true,
      limitInfo: true,
      queueSize: true,
      prices: true,
      createdAt: true,
      deviceId: true,
      source: true,
    },
  });
  // цены в истории показываем только из реальных отметок водителей
  const marks = rows.map(({ deviceId, source, prices, ...m }) => ({
    ...m,
    prices: source === 'seed' ? null : prices,
    name: driverName(deviceId),
  }));
  return NextResponse.json({ marks });
}
