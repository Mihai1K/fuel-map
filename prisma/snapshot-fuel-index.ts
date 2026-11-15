// Ежедневный снапшот индекса топлива — для графика на /indeks за 30 дней.
// computeFuelIndex() сам историю не хранит (считает на лету по меткам за
// 1–2 суток), поэтому один раз в день сохраняем те же цифры в
// FuelIndexSnapshot. Идемпотентен: upsert по (scope, date), повторный
// прогон за тот же день просто перезаписывает значение свежим расчётом.
// Запускается кроном (см. docs/DEPLOY.md).
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { computeFuelIndex } from '../src/lib/fuel-index';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function main() {
  const { russia, cities } = await computeFuelIndex();
  const date = todayUtcMidnight();
  const rows = [russia, ...cities];

  for (const r of rows) {
    await prisma.fuelIndexSnapshot.upsert({
      where: { scope_date: { scope: r.scope, date } },
      create: { scope: r.scope, date, pct: r.pct, alive: r.alive, withData: r.withData },
      update: { pct: r.pct, alive: r.alive, withData: r.withData },
    });
  }

  console.log(`✓ snapshot-fuel-index: сохранено ${rows.length} строк за ${date.toISOString().slice(0, 10)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
