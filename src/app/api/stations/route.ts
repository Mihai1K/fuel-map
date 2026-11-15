import { NextResponse } from 'next/server';
import {
  loadStations,
  loadStationsByBbox,
  serializeStation,
} from '@/lib/stations';
import { withMetrics } from '@/lib/api-metrics';

// Живое обновление карты: клиент опрашивает раз в 60 секунд и при
// перемещении карты. bbox=minLng,minLat,maxLng,maxLat — основной режим;
// city оставлен для страниц городов и старых клиентов.
async function handler(req: Request) {
  const params = new URL(req.url).searchParams;
  const bbox = params.get('bbox');

  let stations;
  if (bbox) {
    const parts = bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return NextResponse.json({ error: 'bad bbox' }, { status: 400 });
    }
    const [minLng, minLat, maxLng, maxLat] = parts;
    stations = await loadStationsByBbox(minLat, minLng, maxLat, maxLng);
  } else {
    stations = await loadStations(params.get('city') ?? 'Москва');
  }

  return NextResponse.json({ stations: stations.map(serializeStation) });
}

export const GET = withMetrics('/api/stations', handler);
