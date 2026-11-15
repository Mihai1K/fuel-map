import { NextResponse } from 'next/server';
import { ingest, type IngestPayload } from '@/lib/analytics';

// Приём событий и heartbeat собственной аналитики.
// Ошибки глотаем: аналитика никогда не ломает продукт и не блокирует UI.

// Простой rate limit в памяти процесса: на один инстанс приложения
// этого достаточно (масштаб — один контейнер), Redis не заводим.
const buckets = new Map<string, { n: number; resetAt: number }>();
const LIMIT = 60; // запросов в минуту с устройства
function allow(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { n: 1, resetAt: now + 60_000 });
    return true;
  }
  b.n++;
  return b.n <= LIMIT;
}
// не даём карте расти бесконечно
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}, 300_000).unref?.();

export async function POST(req: Request) {
  try {
    // жёсткий лимит размера тела — не принимаем простыни
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > 8_192) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    const body = (await req.json()) as IngestPayload;
    if (
      typeof body?.deviceId !== 'string' ||
      typeof body?.sessionId !== 'string' ||
      body.deviceId.length > 80 ||
      body.sessionId.length > 80
    ) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // seed-скрипты и боты не считаются: серверные задачи сюда не ходят,
    // а явные боты отсекаются по user-agent
    const ua = req.headers.get('user-agent') ?? '';
    if (/bot|crawler|spider|yandex\.com\/bots|curl|python/i.test(ua)) {
      return NextResponse.json({ ok: true });
    }
    if (!allow(body.deviceId)) {
      return NextResponse.json({ ok: false }, { status: 429 });
    }
    await ingest(body);
    return NextResponse.json({ ok: true });
  } catch {
    // не роняем клиент из-за аналитики
    return NextResponse.json({ ok: true });
  }
}
