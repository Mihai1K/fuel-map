// Интеграционные проверки юридического P0 (запускать на сервере, где
// есть ANALYTICS_HASH_SECRET). Использование:
//   tsx prisma/legal-selftest.ts erase-setup   — создать тестовые записи
//   tsx prisma/legal-selftest.ts erase-check    — счётчики по тест-хешу
//   tsx prisma/legal-selftest.ts retention-setup — состарить копии записей
// Тест-устройство фиксировано; все записи помечены deviceId 'selftest-*'.
import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const SECRET = process.env.ANALYTICS_HASH_SECRET ?? '';
const DEVICE = 'selftest-device-0000000001';
const hash = (raw: string) =>
  createHmac('sha256', SECRET).update(raw).digest('hex').slice(0, 32);
const ANON = hash(DEVICE);

async function eraseSetup() {
  const st = await prisma.station.findFirst({ select: { id: true } });
  if (!st) throw new Error('нет станций');
  await prisma.mark.create({
    data: { stationId: st.id, status: 'AVAILABLE', fuelTypes: ['ai95'], source: 'user', deviceId: DEVICE },
  });
  await prisma.analyticsVisitor.upsert({
    where: { anonymousIdHash: ANON },
    update: {},
    create: { anonymousIdHash: ANON, lastCity: 'Тест' },
  });
  await prisma.analyticsSession.create({
    data: { sessionIdHash: hash(DEVICE + ':sess'), anonymousIdHash: ANON, city: 'Тест' },
  });
  await prisma.analyticsEvent.create({
    data: { eventName: 'map_open', anonymousIdHash: ANON, sessionIdHash: hash(DEVICE + ':sess'), city: 'Тест' },
  });
  console.log('erase-setup: созданы Mark/Visitor/Session/Event для тест-устройства');
  console.log('DEVICE_ID=' + DEVICE);
}

async function eraseCheck() {
  const [marks, visitors, sessions, events] = await Promise.all([
    prisma.mark.count({ where: { deviceId: DEVICE } }),
    prisma.analyticsVisitor.count({ where: { anonymousIdHash: ANON } }),
    prisma.analyticsSession.count({ where: { anonymousIdHash: ANON } }),
    prisma.analyticsEvent.count({ where: { anonymousIdHash: ANON } }),
  ]);
  console.log('erase-check:', JSON.stringify({ marks, visitors, sessions, events }));
}

async function retentionSetup() {
  const twoYears = new Date(Date.now() - 2 * 365 * 24 * 3600_000);
  const st = await prisma.station.findFirst({ select: { id: true } });
  if (!st) throw new Error('нет станций');
  const A = hash('selftest-aged-0000000002');
  await prisma.mark.create({
    data: { stationId: st.id, status: 'AVAILABLE', fuelTypes: ['ai95'], source: 'user', deviceId: 'selftest-aged-mark', createdAt: twoYears },
  });
  await prisma.analyticsVisitor.upsert({
    where: { anonymousIdHash: A }, update: { lastSeenAt: twoYears, firstSeenAt: twoYears },
    create: { anonymousIdHash: A, lastSeenAt: twoYears, firstSeenAt: twoYears, lastCity: 'Тест' },
  });
  await prisma.analyticsSession.create({
    data: { sessionIdHash: hash('selftest-aged:sess'), anonymousIdHash: A, city: 'Тест', startedAt: twoYears },
  });
  await prisma.analyticsEvent.create({
    data: { eventName: 'map_open', anonymousIdHash: A, sessionIdHash: hash('selftest-aged:sess'), city: 'Тест', createdAt: twoYears },
  });
  // осиротевший посетитель: свежий по дате, но без сессий
  await prisma.analyticsVisitor.upsert({
    where: { anonymousIdHash: hash('selftest-orphan-0003') }, update: {},
    create: { anonymousIdHash: hash('selftest-orphan-0003'), lastCity: 'Тест' },
  });
  console.log('retention-setup: созданы состаренные записи (2 года) + осиротевший посетитель');
}

const cmd = process.argv[2];
const run =
  cmd === 'erase-setup' ? eraseSetup
  : cmd === 'erase-check' ? eraseCheck
  : cmd === 'retention-setup' ? retentionSetup
  : async () => { console.log('команды: erase-setup | erase-check | retention-setup'); };

run()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
