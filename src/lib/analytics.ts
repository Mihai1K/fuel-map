import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';

// Собственная аналитика (админка /admin). Anonymous-first:
// в базу попадают только HMAC-хеши идентификаторов — сырой deviceId,
// IP, координаты и любые персональные данные не сохраняются.
// Ошибка аналитики никогда не ломает продукт: все записи best-effort.

const HASH_SECRET = process.env.ANALYTICS_HASH_SECRET ?? '';

export function hashId(raw: string): string {
  // без секрета аналитика молча выключена (dev без .env) — не роняем прод
  if (!HASH_SECRET) return '';
  return createHmac('sha256', HASH_SECRET).update(raw).digest('hex').slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Белый список событий — сервер не принимает произвольные названия
export const ALLOWED_EVENTS = new Set([
  'app_open',
  'map_open',
  'nearest_open',
  'geolocation_prompted',
  'geolocation_allowed',
  'geolocation_denied',
  'station_search',
  'station_found',
  'station_open',
  'route_click',
  'mark_started',
  'mark_completed',
  'fuel_selected',
  'queue_selected',
  'limit_selected',
  'price_added',
  'share_click',
  'install_clicked',
  'install_completed',
  'telegram_click',
  'max_click',
  'vk_click',
  'community_click',
  'city_switch_suggested',
  'city_switch_confirmed',
  'filters_open',
  'route_return_prompt',
  'mark_sent', // легаси-двойник mark_completed
  'web_vitals', // технические метрики браузера (LCP/INP/CLS)
]);

// Белый список полей metadata — ничего персонального
const ALLOWED_META = new Set(['fuel', 'status', 'queue', 'ui', 'lcp', 'inp', 'cls']);

export function sanitizeMeta(
  meta: unknown
): Record<string, string> | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (ALLOWED_META.has(k) && typeof v === 'string' && v.length <= 40) {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const UTM_MAX = 80;
const clip = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, UTM_MAX) : null;

export type IngestPayload = {
  deviceId: string;
  sessionId: string;
  events?: { name: string; stationId?: string; meta?: unknown }[];
  heartbeat?: boolean;
  city?: string;
  referrerDomain?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  yclid?: string;
};

// Единая точка записи: upsert посетителя/сессии + пачка событий.
export async function ingest(p: IngestPayload): Promise<void> {
  if (!HASH_SECRET) return; // аналитика не настроена — тихий no-op
  const anon = hashId(p.deviceId);
  const sess = hashId(p.sessionId);
  if (!anon || !sess) return;
  const now = new Date();
  const city = clip(p.city);
  const utmSource = clip(p.utmSource);
  const utmMedium = clip(p.utmMedium);
  const utmCampaign = clip(p.utmCampaign);
  const utmContent = clip(p.utmContent);
  const yclid = clip(p.yclid);
  const referrerDomain = clip(p.referrerDomain);

  await prisma.analyticsVisitor.upsert({
    where: { anonymousIdHash: anon },
    update: { lastSeenAt: now, ...(city ? { lastCity: city } : {}) },
    create: {
      anonymousIdHash: anon,
      firstSeenAt: now,
      lastSeenAt: now,
      firstUtmSource: utmSource,
      firstUtmMedium: utmMedium,
      firstUtmCampaign: utmCampaign,
      lastCity: city,
    },
  });

  await prisma.analyticsSession.upsert({
    where: { sessionIdHash: sess },
    update: { lastSeenAt: now, ...(city ? { city } : {}) },
    create: {
      sessionIdHash: sess,
      anonymousIdHash: anon,
      startedAt: now,
      lastSeenAt: now,
      referrerDomain,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      yclid,
      city,
    },
  });

  const events = (p.events ?? [])
    .filter((e) => ALLOWED_EVENTS.has(e.name))
    .slice(0, 20) // защита от пачек-простыней
    .map((e) => ({
      eventName: e.name === 'mark_sent' ? 'mark_completed' : e.name,
      anonymousIdHash: anon,
      sessionIdHash: sess,
      stationId:
        typeof e.stationId === 'string' ? e.stationId.slice(0, 40) : null,
      city,
      metadata: sanitizeMeta(e.meta),
      createdAt: now,
    }));
  // mark_sent и mark_completed шлются парой — не дублируем в базе
  const dedup = events.filter(
    (e, i) =>
      e.eventName !== 'mark_completed' ||
      events.findIndex((x) => x.eventName === 'mark_completed') === i
  );
  if (dedup.length) {
    await prisma.analyticsEvent.createMany({ data: dedup });
  }
}
