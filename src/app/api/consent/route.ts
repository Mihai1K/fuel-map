import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashId } from '@/lib/analytics';

// Журнал согласий (ФЗ-152, доказательная база): каждый выбор в баннере
// cookies фиксируется с версией политики. Персональных данных не
// содержит — только HMAC-хеш устройства (или null) и само действие.
export const POLICY_VERSION = '2026-07-25';

const ACTIONS = new Set(['granted', 'denied', 'revoked']);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { action?: string; deviceId?: string };
    if (!body.action || !ACTIONS.has(body.action)) {
      return NextResponse.json({ error: 'bad action' }, { status: 400 });
    }
    const anonymousIdHash =
      typeof body.deviceId === 'string' && body.deviceId.length >= 8
        ? hashId(body.deviceId) || null
        : null;
    await prisma.consentLog.create({
      data: {
        anonymousIdHash,
        action: body.action,
        policyVersion: POLICY_VERSION,
      },
    });
  } catch {
    // журнал не должен ломать интерфейс — но и молча терять нельзя:
    // при сбое клиент получит ok:false и повторит при следующем выборе
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true });
}
