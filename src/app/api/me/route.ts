import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashId } from '@/lib/analytics';
import { SITE_URL } from '@/lib/site';

// Право на удаление (ст. 14, 21 ФЗ-152): пользователь удаляет данные
// своего устройства сам. Удаляются ВСЕ пользовательские записи —
// Mark, AnalyticsEvent, AnalyticsSession, AnalyticsVisitor. В журнале
// согласий остаётся только запись факта удаления (доказательство
// исполнения обязанности) — о чём пользователь предупреждён в UI.
const SECRET = process.env.ANALYTICS_HASH_SECRET ?? '';

// Персистентный лимит (переживает рестарт, не обходится сменой префикса,
// т.к. ключ — хеш ПОЛНОГО deviceId): 5 удалений на устройство за сутки.
async function allowErase(deviceId: string): Promise<boolean> {
  const key = 'erase:' + createHmac('sha256', SECRET).update(deviceId).digest('hex').slice(0, 24);
  const since = new Date(Date.now() - 24 * 3600_000);
  try {
    const n = await prisma.adminLoginAttempt.count({
      where: { key, createdAt: { gte: since } },
    });
    if (n >= 5) return false;
    await prisma.adminLoginAttempt.create({ data: { key } });
    return true;
  } catch {
    return false;
  }
}

export async function DELETE(req: Request) {
  // защита от CSRF/чужих сайтов: удаление только с нашего Origin
  const origin = req.headers.get('origin');
  if (origin && origin !== SITE_URL && !origin.startsWith('http://localhost')) {
    return NextResponse.json({ error: 'bad origin' }, { status: 403 });
  }
  try {
    const body = (await req.json()) as { deviceId?: string };
    const deviceId = body.deviceId;
    if (typeof deviceId !== 'string' || deviceId.length < 16) {
      return NextResponse.json({ error: 'bad deviceId' }, { status: 400 });
    }
    if (!(await allowErase(deviceId))) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 });
    }

    const anon = hashId(deviceId);
    // все пользовательские записи одной транзакцией
    const ops = [prisma.mark.deleteMany({ where: { deviceId } })];
    if (anon) {
      ops.push(
        prisma.analyticsEvent.deleteMany({ where: { anonymousIdHash: anon } }),
        prisma.analyticsSession.deleteMany({ where: { anonymousIdHash: anon } }),
        prisma.analyticsVisitor.deleteMany({ where: { anonymousIdHash: anon } })
      );
    }
    const r = await prisma.$transaction(ops);
    // запись факта удаления в журнал (хранится ограниченный срок как
    // доказательство исполнения — пользователь предупреждён в UI)
    await prisma.consentLog.create({
      data: {
        anonymousIdHash: anon || null,
        action: 'erasure',
        policyVersion: '2026-07-25',
      },
    });
    return NextResponse.json({
      ok: true,
      deleted: {
        marks: r[0]?.count ?? 0,
        events: r[1]?.count ?? 0,
        sessions: r[2]?.count ?? 0,
        visitors: r[3]?.count ?? 0,
      },
    });
  } catch {
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
