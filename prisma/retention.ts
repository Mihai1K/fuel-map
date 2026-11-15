// Автоматическое удаление данных по срокам хранения (ФЗ-152,
// политика от 21.07.2026): отметки и внутренняя аналитика — 1 год,
// журнал согласий — 3 года. Удаляет также AnalyticsVisitor (по
// lastSeenAt) и осиротевших посетителей без свежих связанных данных.
// Запускается кроном ежедневно; идемпотентен. Флаг --report печатает
// состояние базы до и после (для приёмки).
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function counts() {
  const [marks, events, sessions, visitors, consents] = await Promise.all([
    prisma.mark.count(),
    prisma.analyticsEvent.count(),
    prisma.analyticsSession.count(),
    prisma.analyticsVisitor.count(),
    prisma.consentLog.count(),
  ]);
  return { marks, events, sessions, visitors, consents };
}

async function main() {
  const report = process.argv.includes('--report');
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60_000);
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60_000);

  if (report) console.log('ДО:', JSON.stringify(await counts()));

  const marks = await prisma.mark.deleteMany({
    where: { createdAt: { lt: yearAgo } },
  });
  const events = await prisma.analyticsEvent.deleteMany({
    where: { createdAt: { lt: yearAgo } },
  });
  const sessions = await prisma.analyticsSession.deleteMany({
    where: { startedAt: { lt: yearAgo } },
  });
  // посетители старше года по последней активности
  const visitors = await prisma.analyticsVisitor.deleteMany({
    where: { lastSeenAt: { lt: yearAgo } },
  });
  // осиротевшие посетители: нет ни одной сессии с их хешем (независимо
  // от возраста — сессии могли уйти по ретеншену/удалению раньше)
  const liveHashes = await prisma.analyticsSession.findMany({
    distinct: ['anonymousIdHash'],
    select: { anonymousIdHash: true },
  });
  const keep = new Set(liveHashes.map((s) => s.anonymousIdHash));
  const allVisitors = await prisma.analyticsVisitor.findMany({
    select: { anonymousIdHash: true },
  });
  const orphanHashes = allVisitors
    .map((v) => v.anonymousIdHash)
    .filter((h) => !keep.has(h));
  let orphans = { count: 0 };
  if (orphanHashes.length) {
    orphans = await prisma.analyticsVisitor.deleteMany({
      where: { anonymousIdHash: { in: orphanHashes } },
    });
  }
  const consents = await prisma.consentLog.deleteMany({
    where: { createdAt: { lt: threeYearsAgo } },
  });

  console.log(
    `✓ retention: метки −${marks.count}, события −${events.count}, ` +
      `сессии −${sessions.count}, посетители −${visitors.count} ` +
      `(+осиротевшие −${orphans.count}), журнал согласий −${consents.count}`
  );
  if (report) console.log('ПОСЛЕ:', JSON.stringify(await counts()));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
